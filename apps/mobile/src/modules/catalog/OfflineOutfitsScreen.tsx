import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNetworkState } from 'expo-network';
import { OutfitPreferencesSchema, type OutfitManifest } from '@lumina/contracts';
import { api, captureSessionScope, isCurrentSessionScope } from '../../api';
import { ApiProblem } from '../../errors/ApiProblem';
import { bootstrapOfflineVault } from '../../offline/bootstrap';
import { useSystemBars } from '../../systemBars';
import type { Catalog, Identity, Product, Variant } from '../../types';
import { openNativeOutfitCache } from './nativeOutfitStorage';
import { outfitSelection, type OutfitCacheStatus, type LocalOutfit } from './nativeOutfits';

type Preferences = ReturnType<typeof OutfitPreferencesSchema.parse>;
type Storage = Awaited<ReturnType<typeof openNativeOutfitCache>>;
type Garment = OutfitManifest['garments'][number];
const split = (value: string) =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export function OfflineOutfitsScreen({
  user,
  catalog,
  onBack,
  onTry,
}: {
  user: Identity;
  catalog: Catalog;
  onBack: () => void;
  onTry: (product: Product, variant: Variant) => void;
}) {
  const insets = useSystemBars(),
    network = useNetworkState(),
    online = network.isConnected !== false && network.isInternetReachable !== false;
  const [status, setStatus] = useState<OutfitCacheStatus>({ active: null, pending: null }),
    [prefs, setPrefs] = useState<Preferences>(() => OutfitPreferencesSchema.parse({}));
  const [brands, setBrands] = useState(''),
    [sizes, setSizes] = useState(''),
    [colors, setColors] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const life = useRef<AbortController | null>(null),
    running = useRef(false);
  const showPrefs = (value: Preferences) => {
    setPrefs(value);
    setBrands(value.brands.join(', '));
    setSizes(value.sizes.join(', '));
    setColors(value.colors.join(', '));
  };
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const session = captureSessionScope();
    void (async () => {
      if (online) {
        try {
          await bootstrapOfflineVault(user);
        } catch (reason) {
          if (!ApiProblem.isNetwork(reason)) throw reason;
        }
      }
      const storage = await openNativeOutfitCache(controller.signal),
        saved = await storage.records.get<Preferences>(
          storage.scope,
          'outfit-preferences',
          'current',
        );
      const local = await storage.cache.status();
      storage.check();
      if (controller.signal.aborted || !isCurrentSessionScope(session)) return;
      setStatus(local);
      if (saved) showPrefs(OutfitPreferencesSchema.parse(saved.value));
      if (online) {
        try {
          const profile = await api<{ preferencias: { vestidor?: unknown } }>('/profile', {
            signal: controller.signal,
          });
          const value = OutfitPreferencesSchema.parse(profile.preferencias.vestidor ?? {});
          await storage.records.put(storage.scope, 'outfit-preferences', 'current', value);
          storage.check();
          if (!controller.signal.aborted && isCurrentSessionScope(session)) showPrefs(value);
        } catch (reason) {
          if (!ApiProblem.isNetwork(reason)) throw reason;
        }
      }
    })().catch((reason) => {
      if (!controller.signal.aborted && isCurrentSessionScope(session))
        setError((reason as Error).message);
    });
    return () => {
      controller.abort();
      life.current = null;
    };
  }, [user.id, user.tenant?.id]);
  const run = async (
    label: string,
    task: (storage: Storage, signal: AbortSignal, current: () => boolean) => Promise<void>,
  ) => {
    const controller = life.current;
    if (!controller || running.current) return;
    const session = captureSessionScope(),
      current = () =>
        life.current === controller && !controller.signal.aborted && isCurrentSessionScope(session);
    running.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const storage = await openNativeOutfitCache(controller.signal);
      await task(storage, controller.signal, current);
    } catch (reason) {
      if (current()) setError((reason as Error).message);
    } finally {
      running.current = false;
      if (current()) setBusy('');
    }
  };
  const values = () => {
    try {
      return OutfitPreferencesSchema.parse({
        ...prefs,
        brands: split(brands),
        sizes: split(sizes),
        colors: split(colors),
      });
    } catch {
      throw new Error('Revisa tus gustos: hasta veinte marcas, diez tallas y veinte colores.');
    }
  };
  const savePreferences = async (storage: Storage, signal: AbortSignal) => {
    const value = values();
    await api('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ preferences: value }),
      signal,
    });
    storage.check();
    await storage.records.put(storage.scope, 'outfit-preferences', 'current', value);
    return value;
  };
  const prepare = () =>
    run('Preparando tus prendas…', async (storage, signal, current) => {
      await bootstrapOfflineVault(user);
      await savePreferences(storage, signal);
      const manifest = await api<unknown>('/offline/outfits', {
        method: 'POST',
        body: JSON.stringify({
          deviceId: storage.scope.deviceId,
          platform: 'ANDROID_AR',
          includeOwnAvatar: false,
        }),
        signal,
      });
      const downloaded = await storage.cache.download(manifest, (progress) => {
        if (current()) {
          setStatus(progress);
          const pack = progress.pending ?? progress.active;
          setBusy(
            'Verificadas ' +
              (pack?.readyIds.length ?? 0) +
              ' de ' +
              (pack?.manifest.garmentCount ?? 0) +
              ' prendas',
          );
        }
      });
      if (current()) {
        setStatus(downloaded);
        setNotice(
          downloaded.pending
            ? 'La descarga quedó parcial. Puedes continuarla cuando tengas conexión.'
            : 'Tus prendas están listas para probar sin conexión.',
        );
      }
    });
  const resume = (manifest: OutfitManifest) =>
    run('Completando descarga…', async (storage, _signal, current) => {
      await bootstrapOfflineVault(user);
      const downloaded = await storage.cache.download(manifest, (progress) => {
        if (current()) setStatus(progress);
      });
      if (current()) {
        setStatus(downloaded);
        setNotice(
          downloaded.pending
            ? 'Algunos recursos siguen pendientes. Puedes preparar un paquete nuevo si el anterior venció.'
            : 'Descarga verificada y lista.',
        );
      }
    });
  const play = (pack: LocalOutfit, garment: Garment) =>
    run('Abriendo prenda…', async (storage, _signal, current) => {
      const uri = await storage.cache.image(pack.manifest.packageId, garment.resourceId),
        selected = outfitSelection(garment, uri);
      storage.check();
      if (current()) onTry(selected.product, selected.variant);
    });
  const clear = () =>
    Alert.alert(
      'Eliminar descargas',
      'Se borrarán los paquetes guardados en este dispositivo. Podrás descargarlos otra vez cuando tengas conexión.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () =>
            void run('Eliminando descarga…', async (storage, _signal, current) => {
              await storage.cache.clear();
              if (current()) setStatus(await storage.cache.status());
            }),
        },
      ],
    );
  return (
    <SafeAreaView style={[s.safe, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={onBack} style={s.back}>
          <Text style={s.backText}>← Volver a la tienda</Text>
        </Pressable>
        <Text style={s.eyebrow}>LÚMINA · TU VESTIDOR</Text>
        <Text style={s.title}>Sin conexión</Text>
        <Text style={s.copy}>
          Guarda hasta diez prendas compatibles según tus gustos y pruébalas con la cámara cuando no
          tengas internet. La superposición AR es una vista orientativa.
        </Text>
        <Text style={s.connection}>
          {online ? 'Con conexión' : 'Sin conexión · tus descargas listas siguen disponibles'}
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
        ) : null}
        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {busy ? (
          <View style={s.loading}>
            <ActivityIndicator color="#633f56" />
            <Text style={s.copy}>{busy}</Text>
          </View>
        ) : null}
        <View style={s.card}>
          <Text style={s.cardTitle}>Tus gustos</Text>
          <Text style={s.copy}>
            Se guardan en tu perfil con conexión. Puedes separar varios valores con comas.
          </Text>
          <Field label="Marcas preferidas" value={brands} change={setBrands} />
          <Field label="Tallas preferidas" value={sizes} change={setSizes} />
          <Field label="Colores preferidos" value={colors} change={setColors} />
          <Text style={s.label}>Categorías preferidas</Text>
          <View style={s.chips}>
            {catalog.categories
              .filter((row) => row.activa)
              .map((row) => (
                <Pressable
                  key={row.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: prefs.categoryIds.includes(row.id) }}
                  style={[s.chip, prefs.categoryIds.includes(row.id) && s.selected]}
                  onPress={() =>
                    setPrefs((value) => ({
                      ...value,
                      categoryIds: value.categoryIds.includes(row.id)
                        ? value.categoryIds.filter((id) => id !== row.id)
                        : [...value.categoryIds, row.id],
                    }))
                  }
                >
                  <Text style={prefs.categoryIds.includes(row.id) ? s.selectedText : s.copy}>
                    {row.nombre}
                  </Text>
                </Pressable>
              ))}
          </View>
          <Button
            label="Guardar gustos"
            disabled={!!busy || !online}
            press={() =>
              void run('Guardando gustos…', async (storage, signal, current) => {
                const value = await savePreferences(storage, signal);
                if (current()) {
                  setPrefs(value);
                  setNotice('Tus gustos quedaron guardados.');
                }
              })
            }
          />
          <Button
            label="Preparar hasta diez prendas"
            disabled={!!busy || !online}
            press={() => void prepare()}
          />
        </View>
        {status.active ? (
          <PackageCard
            label="Descarga guardada"
            pack={status.active}
            busy={!!busy}
            online={online}
            play={(garment) => void play(status.active!, garment)}
            resume={() => void resume(status.active!.manifest)}
          />
        ) : null}
        {status.pending ? (
          <PackageCard
            label="Descarga nueva por completar"
            pack={status.pending}
            busy={!!busy}
            online={online}
            play={(garment) => void play(status.pending!, garment)}
            resume={() => void resume(status.pending!.manifest)}
          />
        ) : null}
        {!status.active && !status.pending ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>Tu vestidor todavía no tiene descargas</Text>
            <Text style={s.copy}>
              Conéctate, guarda tus gustos y prepara un paquete para usarlo después sin internet.
            </Text>
          </View>
        ) : null}
        <Button
          label="Verificar mis descargas"
          disabled={!!busy}
          press={() =>
            void run('Verificando recursos…', async (storage, _signal, current) => {
              const local = await storage.cache.status();
              if (current()) setStatus(local);
            })
          }
        />
        {status.active || status.pending ? (
          <Button label="Eliminar descargas del dispositivo" disabled={!!busy} press={clear} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
function Field({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={change} style={s.input} />
    </View>
  );
}
function Button({
  label,
  disabled,
  press,
}: {
  label: string;
  disabled: boolean;
  press: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={press}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function PackageCard({
  label,
  pack,
  busy,
  online,
  play,
  resume,
}: {
  label: string;
  pack: LocalOutfit;
  busy: boolean;
  online: boolean;
  play: (garment: Garment) => void;
  resume: () => void;
}) {
  const complete =
    pack.readyIds.length === pack.manifest.garmentCount && pack.manifest.garmentCount > 0;
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{label}</Text>
      <Text style={s.copy}>
        {pack.readyIds.length} de {pack.manifest.garmentCount} prendas verificadas ·{' '}
        {(pack.bytesVerified / 1000000).toFixed(2)} MB{'\n'}Preparado el{' '}
        {new Date(pack.manifest.createdAt).toLocaleString('es-BO')}
      </Text>
      <Text style={s.copy}>{pack.manifest.preferencesBasis}</Text>
      {pack.manifest.limitations?.map((text, index) => (
        <Text key={index} style={s.copy}>
          {text}
        </Text>
      ))}
      {pack.manifest.state === 'PARCIAL' ? (
        <Text style={s.notice}>
          El catálogo tiene menos de diez prendas compatibles para este paquete.
        </Text>
      ) : null}
      {pack.manifest.garments.map((garment) => {
        const ready = pack.readyIds.includes(garment.resourceId);
        return (
          <Pressable
            key={garment.resourceId}
            accessibilityRole="button"
            accessibilityLabel={'Probar ' + (garment.productName ?? 'prenda descargada')}
            disabled={!ready || busy}
            onPress={() => play(garment)}
            style={[s.garment, !ready && s.disabled]}
          >
            <Text style={s.garmentTitle}>{garment.productName ?? 'Prenda descargada'}</Text>
            <Text style={s.copy}>
              {garment.size} · {garment.color}
            </Text>
            <Text style={s.copy}>
              {ready
                ? 'Lista · Toca para probar con la cámara'
                : (pack.failures[garment.resourceId] ?? 'Pendiente de descarga')}
            </Text>
          </Pressable>
        );
      })}
      {!complete ? (
        <Button label="Continuar o reparar descarga" disabled={busy || !online} press={resume} />
      ) : null}
    </View>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fbf8f7' },
  page: { padding: 20, gap: 14, paddingBottom: 40 },
  back: { minHeight: 44, justifyContent: 'center' },
  backText: { color: '#633f56', fontSize: 12, fontWeight: '800' },
  eyebrow: { color: '#9a617f', fontSize: 10, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: '#342733', fontSize: 30, fontWeight: '900' },
  copy: { color: '#71626c', fontSize: 12, lineHeight: 18 },
  connection: { color: '#567359', fontSize: 11, fontWeight: '700' },
  card: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#eadde5',
    borderRadius: 16,
    backgroundColor: '#fff',
  },
  cardTitle: { fontSize: 17, color: '#342733', fontWeight: '800' },
  label: { fontSize: 12, color: '#633f56', fontWeight: '700' },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e4d4df',
    padding: 11,
    color: '#342733',
  },
  button: {
    minHeight: 46,
    padding: 13,
    backgroundColor: '#633f56',
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  buttonText: { fontSize: 12, color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.45 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#e4d4df' },
  selected: { backgroundColor: '#633f56' },
  selectedText: { fontSize: 12, color: '#fff' },
  garment: {
    padding: 13,
    gap: 5,
    borderWidth: 1,
    borderColor: '#eadde5',
    borderRadius: 11,
    backgroundColor: '#fcf8fb',
  },
  garmentTitle: { fontSize: 13, fontWeight: '800', color: '#342733' },
  error: {
    padding: 12,
    color: '#9a2e2e',
    backgroundColor: '#fff0ec',
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  notice: {
    padding: 12,
    color: '#633f56',
    backgroundColor: '#f4eaf0',
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 18,
  },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center' },
});
