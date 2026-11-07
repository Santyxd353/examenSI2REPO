import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';
import {
  CatalogVariantSchema,
  UnsignedIntentSchema,
  moneyToMinor,
  type SnapshotDocument,
  type SnapshotEntity,
  type UnsignedIntent,
} from '@lumina/contracts';
import { captureSessionScope, isCurrentSessionScope } from '../api';
import type { Identity } from '../types';
import type { OfflineIntent } from '../offline/intentRepository';
import { bootstrapOfflineVault } from '../offline/bootstrap';
import {
  openAdminWorkspace,
  readAdminSnapshot,
  refreshAdminSnapshot,
  requireOfflinePermission,
} from '../offline/adminWorkspace';
import { projectAdminEntities } from '../offline/adminProjection';
import { syncOfflineQueue } from '../offline/syncQueue';

type Row<K extends SnapshotEntity['kind']> = Extract<SnapshotEntity, { kind: K }>;
const pending = (item: OfflineIntent) => ['PENDING', 'SENDING', 'BLOCKED'].includes(item.state);
function useWorkspace(user: Identity) {
  const [snapshot, setSnapshot] = useState<SnapshotDocument | null>(null),
    [queue, setQueue] = useState<OfflineIntent[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const revision = useRef(0);
  const load = useCallback(
    async (download = false) => {
      const token = ++revision.current,
        session = captureSessionScope();
      setBusy(true);
      setError('');
      const current = () => token === revision.current && isCurrentSessionScope(session);
      try {
        if (download) {
          await bootstrapOfflineVault(user);
          const work = await openAdminWorkspace();
          await syncOfflineQueue(work.repository, work.scope);
        }
        const cut = download ? await refreshAdminSnapshot() : await readAdminSnapshot();
        const work = await openAdminWorkspace(),
          items = await work.repository.listIntents(work.scope);
        if (current()) {
          setSnapshot(cut);
          setQueue(items);
          if (download) setMessage('Corte descargado y verificado. Disponible sin conexión.');
        }
      } catch (reason) {
        if (current()) setError((reason as Error).message);
      } finally {
        if (current()) setBusy(false);
      }
    },
    [user],
  );
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  const entities = useMemo(
    () => (snapshot ? projectAdminEntities(snapshot, queue) : []),
    [snapshot, queue],
  );
  const save = async (
    raw: Omit<
      UnsignedIntent,
      'schemaVersion' | 'operationId' | 'tenantId' | 'actorId' | 'deviceId' | 'createdAt'
    >,
    permission: string,
    projection: unknown,
  ) => {
    const session = captureSessionScope();
    setError('');
    setMessage('');
    setBusy(true);
    try {
      const work = await requireOfflinePermission(permission);
      if (!snapshot)
        throw new Error('Descarga primero el catálogo y el inventario de esta tienda.');
      const wire = UnsignedIntentSchema.parse({
        ...raw,
        schemaVersion: '1.0',
        operationId: randomUUID(),
        ...work.scope,
        createdAt: new Date().toISOString(),
      });
      await work.repository.enqueue(
        {
          operationId: wire.operationId,
          scope: work.scope,
          kind: wire.kind,
          entityId: wire.entityId,
          createdAt: wire.createdAt,
          baseVersion: wire.baseVersion,
          dependsOn: wire.dependsOn,
          state: 'PENDING',
          payload: JSON.stringify(wire.payload),
        },
        {
          scope: work.scope,
          entityId: wire.entityId,
          version: wire.baseVersion,
          payload: JSON.stringify(projection),
        },
      );
      if (isCurrentSessionScope(session)) {
        setMessage('Guardado en el dispositivo. Pendiente de sincronización.');
        await load();
      }
      return true;
    } catch (reason) {
      if (isCurrentSessionScope(session)) setError((reason as Error).message);
      return false;
    } finally {
      if (isCurrentSessionScope(session)) setBusy(false);
    }
  };
  return { snapshot, queue, entities, busy, error, message, setError, load, save };
}
type Workspace = ReturnType<typeof useWorkspace>;
function Header({ work }: { work: Workspace }) {
  return (
    <View style={s.block}>
      <Text style={s.title}>Trabajo sin conexión</Text>
      <Text style={s.copy}>
        Descarga un corte mientras tengas conexión. Las altas, ediciones, retiros y ajustes se
        guardan cifrados y se envían desde Sincronización.
      </Text>
      <Button
        label={work.busy ? 'Preparando…' : 'Sincronizar y descargar corte'}
        disabled={work.busy}
        onPress={() => void work.load(true)}
      />
      {work.snapshot ? (
        <Text style={s.copy}>
          Corte: {new Date(work.snapshot.asOf).toLocaleString('es-BO')} ·{' '}
          {work.snapshot.coverage.complete
            ? 'Completo'
            : 'Parcial: ' + work.snapshot.coverage.omissions.join(', ')}{' '}
          · {work.queue.filter(pending).length} pendientes
        </Text>
      ) : (
        <Text style={s.copy}>Todavía no hay un corte descargado para esta cuenta.</Text>
      )}
      {work.error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {work.error}
        </Text>
      ) : null}
      {work.message ? <Text style={s.notice}>{work.message}</Text> : null}
      {work.busy ? <ActivityIndicator color="#173e2a" /> : null}
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  change,
  numeric = false,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        keyboardType={numeric ? 'numeric' : 'default'}
        style={s.input}
      />
    </View>
  );
}
function Chips({
  items,
  value,
  change,
}: {
  items: { id: string; name: string }[];
  value: string;
  change: (id: string) => void;
}) {
  return (
    <ScrollView horizontal contentContainerStyle={s.chips}>
      {items.map((item) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: item.id === value }}
          key={item.id}
          onPress={() => change(item.id)}
          style={[s.chip, item.id === value && s.selected]}
        >
          <Text style={item.id === value ? s.selectedText : s.copy}>{item.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

export function OfflineCatalogModule({ user }: { user: Identity }) {
  const work = useWorkspace(user);
  const products = work.entities.filter((row): row is Row<'PRODUCT'> => row.kind === 'PRODUCT');
  const categories = work.entities.filter(
    (row): row is Row<'CATEGORY'> => row.kind === 'CATEGORY' && row.active,
  );
  const [id, setId] = useState(''),
    [variantId, setVariantId] = useState('');
  const [name, setName] = useState(''),
    [description, setDescription] = useState(''),
    [material, setMaterial] = useState(''),
    [brand, setBrand] = useState(''),
    [category, setCategory] = useState('');
  const [sku, setSku] = useState(''),
    [size, setSize] = useState(''),
    [color, setColor] = useState(''),
    [web, setWeb] = useState(''),
    [app, setApp] = useState(''),
    [store, setStore] = useState('');
  const [reason, setReason] = useState('');
  const product = products.find((row) => row.id === id);
  const variants = work.entities.filter(
    (row): row is Row<'VARIANT'> => row.kind === 'VARIANT' && row.productId === id,
  );
  const existingVariant = variants.find((row) => row.id === variantId);
  const blocked = work.queue.some((row) => row.entityId === id && pending(row));
  const selectVariant = (row?: Row<'VARIANT'>) => {
    setVariantId(row?.id ?? '');
    setSku(row?.sku ?? '');
    setSize(row?.size ?? '');
    setColor(row?.color ?? '');
    const price = (channel: 'WEB' | 'APP' | 'TIENDA') => {
      const rule = row?.prices
        .filter(
          (rule) =>
            rule.channel === channel &&
            rule.startsAt <= new Date().toISOString() &&
            (!rule.endsAt || rule.endsAt > new Date().toISOString()),
        )
        .at(-1);
      return rule ? (rule.baseMinor / 100).toFixed(2) : '';
    };
    setWeb(price('WEB'));
    setApp(price('APP'));
    setStore(price('TIENDA'));
  };
  const select = (selected: string) => {
    setId(selected);
    const item = products.find((row) => row.id === selected);
    setName(item?.name ?? '');
    setDescription(item?.description ?? '');
    setMaterial(item?.material ?? '');
    setBrand(item?.brand ?? '');
    setCategory(item?.categoryId ?? categories[0]?.id ?? '');
    selectVariant(
      work.entities.find(
        (row): row is Row<'VARIANT'> => row.kind === 'VARIANT' && row.productId === selected,
      ),
    );
  };
  useEffect(() => {
    if (!category && categories[0]) setCategory(categories[0].id);
  }, [category, categories]);
  const save = async () => {
    try {
      const entityId = id || randomUUID();
      const variant = CatalogVariantSchema.parse({
        id: variantId || randomUUID(),
        sku,
        talla: size,
        color,
        prices: { WEB: moneyToMinor(web), APP: moneyToMinor(app), TIENDA: moneyToMinor(store) },
        active: existingVariant?.active ?? true,
        baseVersion: existingVariant?.version ?? null,
      });
      const fields = {
        nombre: name,
        descripcion: description,
        material,
        marca: brand,
        categoriaId: category,
        variants: [variant],
      };
      const saved = await work.save(
        id
          ? {
              kind: 'CATALOG_UPDATE',
              entityId,
              baseVersion: product!.version,
              dependsOn: [],
              payload: { patch: fields },
            }
          : {
              kind: 'CATALOG_CREATE',
              entityId,
              baseVersion: null,
              dependsOn: [],
              payload: { product: { id: entityId, ...fields, resources: [] } },
            },
        'catalogo:gestionar',
        { kind: 'PRODUCT', ...fields, id: entityId },
      );
      if (saved && !id) select('');
    } catch (error) {
      work.setError((error as Error).message);
    }
  };
  return (
    <>
      <Header work={work} />
      <View style={s.block}>
        <Text style={s.title}>{id ? 'Editar prenda' : 'Nueva prenda femenina'}</Text>
        <Chips
          value={id}
          change={select}
          items={[
            { id: '', name: 'Crear prenda' },
            ...products.map((row) => ({
              id: row.id,
              name: row.name + (row.state === 'RETIRADO' ? ' · Retirada' : ''),
            })),
          ]}
        />
        <Field label="Nombre" value={name} change={setName} />
        <Field label="Marca" value={brand} change={setBrand} />
        <Field label="Descripción" value={description} change={setDescription} />
        <Field label="Material" value={material} change={setMaterial} />
        <Text style={s.label}>Categoría</Text>
        <Chips
          items={categories.map((row) => ({ id: row.id, name: row.name }))}
          value={category}
          change={setCategory}
        />
        {id ? (
          <>
            <Text style={s.label}>Variante a editar o agregar</Text>
            <Chips
              items={[
                ...variants.map((row) => ({ id: row.id, name: row.sku })),
                { id: '', name: 'Agregar variante' },
              ]}
              value={variantId}
              change={(selected) => selectVariant(variants.find((row) => row.id === selected))}
            />
          </>
        ) : null}
        <Field label="SKU" value={sku} change={setSku} />
        <Field label="Talla" value={size} change={setSize} />
        <Field label="Color" value={color} change={setColor} />
        <Field label="Precio web (Bs)" value={web} change={setWeb} numeric />
        <Field label="Precio app (Bs)" value={app} change={setApp} numeric />
        <Field label="Precio mostrador (Bs)" value={store} change={setStore} numeric />
        <Button
          label="Guardar en cola offline"
          onPress={() => void save()}
          disabled={
            work.busy ||
            !work.snapshot ||
            blocked ||
            !user.permissions.includes('catalogo:gestionar')
          }
        />
        {blocked ? (
          <Text style={s.notice}>
            Esta prenda tiene una operación pendiente. Sincronízala o revisa su bloqueo antes de
            volver a editarla.
          </Text>
        ) : null}
        {id ? (
          <>
            <Field label="Motivo del retiro" value={reason} change={setReason} />
            <Button
              label="Retirar prenda del catálogo"
              disabled={
                work.busy ||
                blocked ||
                reason.trim().length < 3 ||
                !user.permissions.includes('catalogo:gestionar')
              }
              onPress={() =>
                void work.save(
                  {
                    kind: 'CATALOG_ARCHIVE',
                    entityId: id,
                    baseVersion: product!.version,
                    dependsOn: [],
                    payload: { reason },
                  },
                  'catalogo:gestionar',
                  { ...product, state: 'RETIRADO' },
                )
              }
            />
            <Text style={s.copy}>
              El retiro conserva ventas e historial. La publicación y los recursos se revisan en la
              administración del catálogo.
            </Text>
          </>
        ) : null}
      </View>
    </>
  );
}

export function OfflineInventoryModule({ user }: { user: Identity }) {
  const work = useWorkspace(user),
    [location, setLocation] = useState(''),
    [variantId, setVariantId] = useState('');
  const [mode, setMode] = useState<'STOCK_DELTA' | 'STOCK_COUNT'>('STOCK_DELTA'),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState('');
  const locations = work.entities.filter(
    (row): row is Row<'LOCATION'> => row.kind === 'LOCATION' && row.active,
  );
  const variants = work.entities.filter(
    (row): row is Row<'VARIANT'> => row.kind === 'VARIANT' && row.active,
  );
  const stocks = work.entities.filter(
    (row): row is Row<'STOCK'> => row.kind === 'STOCK' && row.locationId === location,
  );
  const selected = stocks.find((row) => row.variantId === variantId);
  useEffect(() => {
    if (!location && locations[0]) setLocation(locations[0].id);
  }, [location, locations]);
  const save = async () => {
    try {
      if (!/^-?\d+$/.test(amount.trim())) throw new Error('Ingresa una cantidad entera.');
      const value = Number(amount),
        entityId = selected?.id ?? randomUUID();
      if (!Number.isSafeInteger(value)) throw new Error('La cantidad no es válida.');
      if (mode === 'STOCK_COUNT' && !selected)
        throw new Error('Descarga un saldo confirmado antes de registrar un conteo.');
      const physical = mode === 'STOCK_DELTA' ? (selected?.physical ?? 0) + value : value;
      if (physical - (selected?.reserved ?? 0) - (selected?.committed ?? 0) < 0)
        throw new Error('El ajuste dejaría saldo disponible negativo.');
      const create = work.queue.find(
        (row) =>
          row.kind === 'CATALOG_CREATE' &&
          pending(row) &&
          JSON.parse(row.payload).payload.product.variants.some(
            (variant: { id: string }) => variant.id === variantId,
          ),
      );
      const raw =
        mode === 'STOCK_DELTA'
          ? {
              kind: mode,
              entityId,
              baseVersion: selected?.version ?? null,
              dependsOn: create ? [create.operationId] : [],
              payload: { variantId, locationId: location, deltaFisico: value, reason },
            }
          : {
              kind: mode,
              entityId,
              baseVersion: selected!.version,
              dependsOn: [],
              payload: { variantId, locationId: location, observedPhysical: value, reason },
            };
      if (
        await work.save(raw, 'inventario:gestionar', {
          kind: 'STOCK',
          ...selected,
          id: entityId,
          variantId,
          locationId: location,
          physical,
        })
      ) {
        setAmount('');
        setReason('');
      }
    } catch (error) {
      work.setError((error as Error).message);
    }
  };
  return (
    <>
      <Header work={work} />
      <View style={s.block}>
        <Text style={s.title}>Inventario por ubicación</Text>
        <Chips
          items={locations.map((row) => ({ id: row.id, name: row.name }))}
          value={location}
          change={(id) => {
            setLocation(id);
            setVariantId('');
          }}
        />
        <Text style={s.label}>Selecciona una variante</Text>
        <Chips
          items={variants.map((row) => ({
            id: row.id,
            name: row.sku + ' · ' + row.size + '/' + row.color,
          }))}
          value={variantId}
          change={setVariantId}
        />
        {variantId ? (
          <Text style={s.notice}>
            Físico proyectado: {selected?.physical ?? 0} · Reservado: {selected?.reserved ?? 0} ·
            Comprometido: {selected?.committed ?? 0} · Disponible: {selected?.available ?? 0}
          </Text>
        ) : null}
        <Chips
          items={[
            { id: 'STOCK_DELTA', name: 'Aumentar / disminuir' },
            { id: 'STOCK_COUNT', name: 'Conteo físico' },
          ]}
          value={mode}
          change={(value) => setMode(value as typeof mode)}
        />
        <Field
          label={
            mode === 'STOCK_DELTA' ? 'Cambio de unidades (ej. 3 o -2)' : 'Unidades físicas contadas'
          }
          value={amount}
          change={setAmount}
          numeric
        />
        <Field label="Motivo del movimiento" value={reason} change={setReason} />
        <Button
          label="Guardar movimiento offline"
          onPress={() => void save()}
          disabled={
            work.busy ||
            !work.snapshot ||
            !location ||
            !variantId ||
            reason.trim().length < 3 ||
            !user.permissions.includes('inventario:gestionar')
          }
        />
        <Text style={s.copy}>
          El conteo compara la versión descargada. Si el stock cambió por una venta, queda en
          conflicto para revisión y no reemplaza ese saldo.
        </Text>
        {stocks.map((row) => (
          <View key={row.id} style={s.row}>
            <Text style={s.label}>
              {variants.find((variant) => variant.id === row.variantId)?.sku ?? row.variantId}
            </Text>
            <Text style={s.copy}>
              Físico {row.physical} · Disponible {row.available} · v{row.version}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}
const s = StyleSheet.create({
  block: {
    padding: 15,
    borderWidth: 1,
    borderColor: '#e3e7e1',
    backgroundColor: '#fff',
    borderRadius: 16,
    gap: 11,
  },
  title: { fontSize: 15, fontWeight: '900', color: '#173e2a' },
  copy: { fontSize: 11, lineHeight: 17, color: '#627166' },
  field: { gap: 5 },
  label: { fontSize: 11, fontWeight: '700', color: '#294332' },
  input: {
    minHeight: 45,
    borderWidth: 1,
    borderColor: '#dbe1da',
    borderRadius: 9,
    paddingHorizontal: 11,
    color: '#1c2b20',
  },
  button: {
    minHeight: 44,
    backgroundColor: '#173e2a',
    borderRadius: 10,
    padding: 12,
    alignSelf: 'flex-start',
  },
  buttonText: { fontSize: 11, color: '#fff', fontWeight: '800' },
  disabled: { opacity: 0.4 },
  chips: { gap: 8 },
  chip: { padding: 10, borderWidth: 1, borderColor: '#dbe1da', borderRadius: 12 },
  selected: { backgroundColor: '#173e2a' },
  selectedText: { color: '#fff', fontSize: 11 },
  notice: {
    padding: 10,
    backgroundColor: '#eef5ed',
    borderRadius: 9,
    color: '#46634b',
    fontSize: 11,
    lineHeight: 17,
  },
  error: {
    padding: 10,
    color: '#9a2e2e',
    backgroundColor: '#fff0ec',
    borderRadius: 9,
    fontSize: 11,
  },
  row: { borderTopWidth: 1, borderTopColor: '#e3e7e1', paddingVertical: 10 },
});
