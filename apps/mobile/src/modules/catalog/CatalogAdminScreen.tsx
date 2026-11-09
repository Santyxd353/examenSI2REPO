import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../api';
import { ApiProblem } from '../../errors/ApiProblem';
import { bootstrapOfflineVault } from '../../offline/bootstrap';
import { getOfflineDeviceId } from '../../offline/device';
import { openOfflineDatabase } from '../../offline/db';
import { SQLiteIntentRepository } from '../../offline/sqliteIntentRepository';
import type { OfflineScope } from '../../offline/scope';
import { syncOfflineQueue } from '../../offline/syncQueue';
import { readActiveDek } from '../../offline/vault';
import type { Identity } from '../../types';
import { ProductEditor } from './ProductEditor';
import {
  listCatalogAttachments,
  stageCatalogGalleryImage,
  syncCatalogAttachments,
  type StagedCatalogAttachment,
} from './attachmentStaging';
import { readCatalogSnapshot, saveCatalogSnapshot } from './catalogSnapshot';
import {
  archiveProduct,
  catalogIntent,
  catalogProductFromIntent,
  latestCatalogDependency,
  projectCatalog,
  type CatalogOperationState,
  type OfflineCatalogItem,
  type OfflineProduct,
} from './offlineCatalog';

type Category = Readonly<{ id: string; nombre: string }>;
type CatalogReply = Readonly<{ categories: Category[]; products: OfflineProduct[] }>;
type Editor = Readonly<{ product: OfflineProduct; isNew: boolean }>;

const stateLabel: Record<CatalogOperationState, string> = {
  CONFIRMED: 'Confirmada',
  PENDING: 'Pendiente',
  SENDING: 'Enviando',
  APPLIED: 'Aplicada',
  CONFLICT: 'Conflicto',
  REJECTED: 'Rechazada',
  BLOCKED: 'Bloqueada',
  SUPERSEDED: 'Reemplazada',
};

export function CatalogAdminScreen({ user }: { user: Identity }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [confirmed, setConfirmed] = useState<OfflineProduct[]>([]);
  const [products, setProducts] = useState<OfflineCatalogItem[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [attachments, setAttachments] = useState<StagedCatalogAttachment[]>([]);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const scope = useCallback(async (): Promise<OfflineScope> => {
    if (!user.tenant) throw new Error('La sesión no tiene una tienda asignada.');
    return { tenantId: user.tenant.id, actorId: user.id, deviceId: await getOfflineDeviceId() };
  }, [user.id, user.tenant?.id]);
  const readyScope = useCallback(async () => {
    const current = await scope();
    return await readActiveDek(current) ? current : bootstrapOfflineVault(user);
  }, [scope, user]);

  const loadProjected = useCallback(async (snapshot = confirmed) => {
    const current = await readyScope();
    const [intents, staged] = await Promise.all([
      new SQLiteIntentRepository(await openOfflineDatabase()).listIntents(current),
      listCatalogAttachments(current),
    ]);
    setProducts(projectCatalog(snapshot, intents));
    setAttachments(staged);
  }, [confirmed, readyScope]);

  const refresh = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const current = await readyScope();
      try {
        const reply = await api<CatalogReply>('/catalog/admin');
        setCategories(reply.categories);
        setConfirmed(reply.products);
        await saveCatalogSnapshot(current, reply);
        const [intents, staged] = await Promise.all([
          new SQLiteIntentRepository(await openOfflineDatabase()).listIntents(current),
          listCatalogAttachments(current),
        ]);
        setProducts(projectCatalog(reply.products, intents));
        setAttachments(staged);
        setNotice('');
      } catch (reason) {
        if (!ApiProblem.isNetwork(reason)) throw reason;
        const snapshot = await readCatalogSnapshot<CatalogReply>(current);
        if (!snapshot) throw new Error('Conéctate una vez para descargar el catálogo administrativo.');
        setCategories(snapshot.categories);
        setConfirmed(snapshot.products);
        const [intents, staged] = await Promise.all([
          new SQLiteIntentRepository(await openOfflineDatabase()).listIntents(current),
          listCatalogAttachments(current),
        ]);
        setProducts(projectCatalog(snapshot.products, intents));
        setAttachments(staged);
        setNotice('Sin conexión: mostrando la copia cifrada del catálogo.');
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }, [readyScope]);

  useEffect(() => { void refresh(); }, [refresh]);

  const newProduct = () => {
    if (!categories[0]) { setError('Descarga las categorías antes de crear una prenda.'); return; }
    setEditor({
      isNew: true,
      product: {
        id: randomUUID(), nombre: '', categoriaId: categories[0].id, descripcion: '', material: '',
        version: null, archived: false, variants: [],
      },
    });
  };

  const save = async (product: OfflineProduct) => {
    if (!editor) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const current = await readyScope();
      const repository = new SQLiteIntentRepository(await openOfflineDatabase());
      const intents = await repository.listIntents(current);
      const dependency = editor.isNew ? undefined : latestCatalogDependency(intents, product.id);
      const intent = catalogIntent(
        current,
        randomUUID(),
        editor.isNew ? 'CATALOG_CREATE' : 'CATALOG_UPDATE',
        product,
        dependency ? [dependency.operationId] : [],
      );
      await repository.enqueue(intent, {
        scope: current,
        entityId: `catalog:${product.id}`,
        version: product.version,
        payload: intent.payload,
      });
      setEditor(null);
      await loadProjected();
      try {
        const receipts = await syncOfflineQueue(repository, current);
        const own = receipts.find((receipt) => receipt.operationId === intent.operationId);
        setNotice(own?.status === 'APPLIED'
          ? 'La prenda se sincronizó correctamente.'
          : own?.status === 'CONFLICT'
            ? 'El catálogo cambió en el servidor. Revisa el conflicto en Sincronización.'
            : own?.status === 'REJECTED'
              ? `El servidor rechazó el cambio: ${own.message || 'revisa el plan y los datos.'}`
              : 'El cambio quedó guardado para sincronizarse después.');
        await refresh();
      } catch (reason) {
        setNotice(ApiProblem.isNetwork(reason)
          ? 'Sin conexión: el cambio quedó cifrado en el dispositivo.'
          : `El cambio quedó guardado, pero no pudo sincronizarse: ${(reason as Error).message}`);
        await loadProjected();
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const archive = async (product: OfflineCatalogItem) => {
    if (product.archived) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const current = await readyScope();
      const repository = new SQLiteIntentRepository(await openOfflineDatabase());
      const intents = await repository.listIntents(current);
      const dependency = latestCatalogDependency(intents, product.id);
      if (dependency?.kind === 'CATALOG_ARCHIVE') throw new Error('Esta prenda ya tiene un archivo pendiente.');
      const archived = archiveProduct(product);
      const intent = catalogIntent(current, randomUUID(), 'CATALOG_ARCHIVE', archived, dependency ? [dependency.operationId] : []);
      await repository.enqueue(intent, {
        scope: current, entityId: `catalog:${product.id}`, version: product.version, payload: intent.payload,
      });
      await loadProjected();
      try {
        await syncOfflineQueue(repository, current);
        setNotice('Solicitud de archivo procesada.');
        await refresh();
      } catch (reason) {
        setNotice(ApiProblem.isNetwork(reason)
          ? 'Sin conexión: el archivo quedó pendiente en el dispositivo.'
          : `El archivo quedó guardado, pero no pudo sincronizarse: ${(reason as Error).message}`);
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const retryConflict = async (product: OfflineCatalogItem) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const server = confirmed.find((entry) => entry.id === product.id);
      if (!server?.version) throw new Error('La prenda ya no existe en la copia actual del servidor.');
      const current = await readyScope();
      const repository = new SQLiteIntentRepository(await openOfflineDatabase());
      const intents = await repository.listIntents(current);
      const conflict = [...intents].reverse().find((intent) =>
        intent.state === 'CONFLICT' && catalogProductFromIntent(intent)?.id === product.id);
      if (!conflict) throw new Error('El conflicto ya fue resuelto o reemplazado.');
      await repository.rebaseCatalog(current, conflict.operationId, randomUUID(), server.version);
      await loadProjected();
      await syncOfflineQueue(repository, current);
      setNotice('El cambio se volvió a intentar con la versión actual del servidor.');
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
      await loadProjected().catch(() => {});
    } finally { setBusy(false); }
  };

  const addGalleryImage = async (product: OfflineCatalogItem) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Autoriza el acceso a tus imágenes para agregar una foto.');
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (selection.canceled || !selection.assets[0]) return;
      const asset = selection.assets[0];
      const mimeType = asset.mimeType || (/\.png$/i.test(asset.fileName || asset.uri)
        ? 'image/png'
        : /\.webp$/i.test(asset.fileName || asset.uri) ? 'image/webp' : 'image/jpeg');
      const current = await readyScope();
      await stageCatalogGalleryImage(current, product.id, asset.uri, mimeType);
      setAttachments(await listCatalogAttachments(current));
      try {
        await syncCatalogAttachments(current, product.id);
        setAttachments(await listCatalogAttachments(current));
        setNotice('La imagen quedó verificada y vinculada a la prenda.');
        await refresh();
      } catch (reason) {
        setAttachments(await listCatalogAttachments(current));
        setNotice(ApiProblem.isNetwork(reason)
          ? 'Sin conexión: la imagen quedó guardada para subirla después.'
          : `La imagen quedó pendiente: ${(reason as Error).message}`);
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const retryImages = async () => {
    setBusy(true); setError('');
    try {
      const current = await readyScope();
      setAttachments(await syncCatalogAttachments(current));
      setNotice('Las imágenes pendientes se sincronizaron.');
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
      const current = await scope().catch(() => null);
      if (current) setAttachments(await listCatalogAttachments(current));
    } finally { setBusy(false); }
  };

  return <View style={styles.container}>
    <View style={styles.heading}>
      <View><Text style={styles.title}>Catálogo offline</Text><Text style={styles.copy}>Crea, edita y archiva prendas con variantes, incluso sin conexión.</Text></View>
      <Pressable accessibilityRole="button" disabled={busy || Boolean(editor)} onPress={newProduct} style={[styles.primary, (busy || Boolean(editor)) && styles.disabled]}><Text style={styles.primaryText}>Nueva prenda</Text></Pressable>
    </View>
    {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {attachments.some((item) => item.state === 'PENDING' || item.state === 'FAILED') ? <Pressable disabled={busy} onPress={() => void retryImages()} style={styles.retryImages}><Text style={styles.retryImagesText}>Sincronizar imágenes pendientes</Text></Pressable> : null}
    {editor ? <ProductEditor key={`${editor.product.id}:${editor.isNew}`} initial={editor.product} categories={categories} busy={busy} onSave={(product) => void save(product)} onCancel={() => setEditor(null)} /> : null}
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void refresh()} tintColor="#173e2a" />}
    >
      {busy && !products.length ? <ActivityIndicator color="#173e2a" /> : null}
      {products.map((product) => <View key={product.id} style={[styles.product, product.archived && styles.archived]}>
        <View style={styles.productTop}>
          <View style={styles.productCopy}><Text style={styles.productName}>{product.nombre}</Text><Text style={styles.productMeta}>{product.marca || 'Sin marca'} · {product.variants.length} variantes · v{product.version ?? 'local'}</Text></View>
          <View style={[styles.badge, ['CONFLICT', 'REJECTED', 'BLOCKED'].includes(product.operationState) && styles.badgeWarning]}><Text style={styles.badgeText}>{stateLabel[product.operationState]}</Text></View>
        </View>
        <Text style={styles.variantSummary}>{product.variants.map((variant) => `${variant.talla}/${variant.color} · Bs ${(variant.priceCents / 100).toFixed(2)}`).join('\n')}</Text>
        {attachments.filter((item) => item.productId === product.id).map((item) => <Text key={item.resourceId} style={styles.attachment}>Imagen {item.state === 'STAGED' ? 'sincronizada' : item.state === 'FAILED' ? `pendiente · ${item.message || 'reintenta la carga'}` : item.state.toLowerCase()}</Text>)}
        <View style={styles.actions}>
          <Pressable disabled={busy || product.archived} onPress={() => setEditor({ product, isNew: false })} style={[styles.secondary, product.archived && styles.disabled]}><Text style={styles.secondaryText}>Editar</Text></Pressable>
          <Pressable disabled={busy || product.archived} onPress={() => void archive(product)} style={[styles.archive, product.archived && styles.disabled]}><Text style={styles.archiveText}>{product.archived ? 'Archivada' : 'Archivar'}</Text></Pressable>
          {product.operationState === 'CONFLICT' ? <Pressable disabled={busy} onPress={() => void retryConflict(product)} style={styles.retry}><Text style={styles.retryText}>Reintentar con versión actual</Text></Pressable> : null}
          <Pressable disabled={busy || product.archived} onPress={() => void addGalleryImage(product)} style={[styles.secondary, product.archived && styles.disabled]}><Text style={styles.secondaryText}>Agregar imagen</Text></Pressable>
        </View>
      </View>)}
      {!busy && !products.length ? <Text style={styles.empty}>No hay prendas en la copia administrativa.</Text> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { gap: 12, minHeight: 420 },
  heading: { gap: 10 },
  title: { color: '#173e2a', fontSize: 18, fontWeight: '900' },
  copy: { color: '#6a786e', fontSize: 10, lineHeight: 15, marginTop: 3 },
  primary: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 11, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: '#173e2a' },
  primaryText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  notice: { color: '#41634b', backgroundColor: '#edf5ed', padding: 10, borderRadius: 10, fontSize: 10, lineHeight: 15 },
  error: { color: '#9a2e2e', backgroundColor: '#fff0ec', padding: 10, borderRadius: 10, fontSize: 10, lineHeight: 15 },
  list: { maxHeight: 590 },
  listContent: { gap: 10, paddingBottom: 18 },
  product: { borderWidth: 1, borderColor: '#e2e6df', borderRadius: 14, padding: 13, backgroundColor: '#fff', gap: 9 },
  archived: { opacity: 0.58 },
  productTop: { flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' },
  productCopy: { flex: 1 },
  productName: { color: '#223429', fontSize: 12, fontWeight: '900' },
  productMeta: { color: '#7a847d', fontSize: 9, marginTop: 3 },
  badge: { borderRadius: 10, backgroundColor: '#e6f0e7', paddingHorizontal: 8, paddingVertical: 5 },
  badgeWarning: { backgroundColor: '#fff0dc' },
  badgeText: { color: '#48624f', fontSize: 8, fontWeight: '900' },
  variantSummary: { color: '#66736a', fontSize: 9, lineHeight: 14 },
  attachment: { color: '#55705e', fontSize: 8, lineHeight: 13 },
  actions: { flexDirection: 'row', gap: 8 },
  secondary: { minHeight: 38, borderRadius: 9, borderWidth: 1, borderColor: '#ccd7cd', justifyContent: 'center', paddingHorizontal: 12 },
  secondaryText: { color: '#31533d', fontSize: 9, fontWeight: '900' },
  archive: { minHeight: 38, borderRadius: 9, borderWidth: 1, borderColor: '#dfb8b2', justifyContent: 'center', paddingHorizontal: 12 },
  archiveText: { color: '#91443a', fontSize: 9, fontWeight: '900' },
  retry: { minHeight: 38, borderRadius: 9, backgroundColor: '#7a4b13', justifyContent: 'center', paddingHorizontal: 12 },
  retryText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  retryImages: { alignSelf: 'flex-start', borderRadius: 10, backgroundColor: '#7a4b13', paddingHorizontal: 12, paddingVertical: 10 },
  retryImagesText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  empty: { color: '#7f8a82', textAlign: 'center', padding: 24, fontSize: 11 },
});
