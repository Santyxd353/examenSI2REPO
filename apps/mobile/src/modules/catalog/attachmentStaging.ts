import type { OfflineScope } from '../../offline/scope';

export type CatalogAttachment = Readonly<{
  resourceId: string;
  sha256: string;
  mimeType: string;
  usage: 'GALLERY' | 'AR_PNG' | 'MODEL_GLB';
  state: 'PENDING' | 'UPLOADING' | 'STAGED' | 'FAILED';
}>;

export type StagedCatalogAttachment = CatalogAttachment & Readonly<{
  productId: string;
  localUri: string;
  message?: string | null;
}>;

export function validateCatalogAttachment(item: CatalogAttachment) {
  if (!/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('El adjunto requiere SHA-256.');
  const valid =
    (item.usage === 'GALLERY' && /^image\/(jpeg|png|webp)$/.test(item.mimeType)) ||
    (item.usage === 'AR_PNG' && item.mimeType === 'image/png') ||
    (item.usage === 'MODEL_GLB' && item.mimeType === 'model/gltf-binary');
  if (!valid) throw new Error('El MIME no corresponde al uso declarado del recurso.');
  return item;
}

const extensionFor = (mimeType: string) => mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function stageCatalogGalleryImage(
  scope: OfflineScope,
  productId: string,
  sourceUri: string,
  mimeType: string,
) {
  const [{ CryptoDigestAlgorithm, digest, randomUUID }, { Directory, File, Paths }, { openOfflineDatabase }] = await Promise.all([
    import('expo-crypto'),
    import('expo-file-system'),
    import('../../offline/db'),
  ]);
  const resourceId = randomUUID();
  const draft = validateCatalogAttachment({
    resourceId,
    sha256: '0'.repeat(64),
    mimeType,
    usage: 'GALLERY',
    state: 'PENDING',
  });
  const storage = new Directory(Paths.document, 'lumina-catalog-staging');
  storage.create({ intermediates: true, idempotent: true });
  const target = new File(storage, `${resourceId}.${extensionFor(mimeType)}`);
  await new File(sourceUri).copy(target, { overwrite: true });
  if (target.size > 5 * 1024 * 1024) {
    target.delete();
    throw new Error('La imagen supera el límite de 5 MB.');
  }
  const sha256 = hex(await digest(CryptoDigestAlgorithm.SHA256, await target.bytes()));
  const database = await openOfflineDatabase();
  await database.runAsync(
    `INSERT INTO offline_catalog_attachment
      (resource_id,tenant_id,actor_id,device_id,product_id,sha256,mime_type,local_uri,state,message,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    resourceId, scope.tenantId, scope.actorId, scope.deviceId, productId, sha256,
    draft.mimeType, target.uri, 'PENDING', null, new Date().toISOString(),
  );
  return { ...draft, sha256, productId, localUri: target.uri } satisfies StagedCatalogAttachment;
}

export async function listCatalogAttachments(scope: OfflineScope, productId?: string) {
  const { openOfflineDatabase } = await import('../../offline/db');
  const database = await openOfflineDatabase();
  const rows = await database.getAllAsync<{
    resource_id: string; product_id: string; sha256: string; mime_type: string;
    local_uri: string; state: StagedCatalogAttachment['state']; message: string | null;
  }>(
    `SELECT resource_id,product_id,sha256,mime_type,local_uri,state,message
     FROM offline_catalog_attachment
     WHERE tenant_id=? AND actor_id=? AND device_id=?${productId ? ' AND product_id=?' : ''}
     ORDER BY created_at ASC`,
    ...(productId
      ? [scope.tenantId, scope.actorId, scope.deviceId, productId]
      : [scope.tenantId, scope.actorId, scope.deviceId]),
  );
  return rows.map((row) => ({
    resourceId: row.resource_id,
    productId: row.product_id,
    sha256: row.sha256,
    mimeType: row.mime_type,
    localUri: row.local_uri,
    usage: 'GALLERY' as const,
    state: row.state,
    message: row.message,
  }));
}

export async function syncCatalogAttachments(scope: OfflineScope, productId?: string) {
  const [{ api }, { openOfflineDatabase }] = await Promise.all([
    import('../../api'),
    import('../../offline/db'),
  ]);
  const database = await openOfflineDatabase();
  const pending = (await listCatalogAttachments(scope, productId))
    .filter((item) => item.state === 'PENDING' || item.state === 'FAILED');
  for (const item of pending) {
    await database.runAsync(`UPDATE offline_catalog_attachment SET state='UPLOADING',message=NULL WHERE resource_id=?`, item.resourceId);
    try {
      const body = new FormData();
      body.append('clientResourceId', item.resourceId);
      body.append('productId', item.productId);
      body.append('sha256', item.sha256);
      body.append('usage', 'GALLERY');
      body.append('license', 'Carga autorizada por la administradora');
      body.append('file', { uri: item.localUri, type: item.mimeType, name: `${item.resourceId}.${extensionFor(item.mimeType)}` } as never);
      await api('/offline/resources', { method: 'POST', body });
      await database.runAsync(`UPDATE offline_catalog_attachment SET state='STAGED',message=NULL WHERE resource_id=?`, item.resourceId);
    } catch (reason) {
      await database.runAsync(
        `UPDATE offline_catalog_attachment SET state='FAILED',message=? WHERE resource_id=?`,
        (reason as Error).message.slice(0, 400), item.resourceId,
      );
      throw reason;
    }
  }
  return listCatalogAttachments(scope, productId);
}
