export type CatalogAttachment = Readonly<{ resourceId: string; sha256: string; mimeType: string; usage: 'GALLERY' | 'AR_PNG' | 'MODEL_GLB'; state: 'PENDING' | 'STAGED' | 'FAILED' }>;

export function validateCatalogAttachment(item: CatalogAttachment) {
  if (!/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('El adjunto requiere SHA-256.');
  const valid =
    (item.usage === 'GALLERY' && /^image\/(jpeg|png|webp)$/.test(item.mimeType)) ||
    (item.usage === 'AR_PNG' && item.mimeType === 'image/png') ||
    (item.usage === 'MODEL_GLB' && item.mimeType === 'model/gltf-binary');
  if (!valid) throw new Error('El MIME no corresponde al uso declarado del recurso.');
  return item;
}
