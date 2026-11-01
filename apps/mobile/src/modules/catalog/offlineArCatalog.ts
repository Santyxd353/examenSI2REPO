export type ArResourceManifest = Readonly<{
  id: string;
  variantId: string;
  estado: 'BORRADOR' | 'PUBLICADO';
  imagePath: string;
  checksum: string;
}>;

export type ArDownload = Readonly<{
  resourceId: string;
  variantId: string;
  sourceUrl: string;
  checksum: string;
}>;

const MAX_OFFLINE_AR_GARMENTS = 10;

/** Construye una descarga acotada y del mismo origen que el API autenticado. */
export function planOfflineArDownloads(
  apiUrl: string,
  resources: readonly ArResourceManifest[],
  cachedResourceIds: ReadonlySet<string>,
): ArDownload[] {
  const apiOrigin = new URL(apiUrl).origin;
  const selected: ArDownload[] = [];
  const variants = new Set<string>();

  for (const resource of resources) {
    if (selected.length === MAX_OFFLINE_AR_GARMENTS) break;
    if (resource.estado !== 'PUBLICADO' || cachedResourceIds.has(resource.id)) continue;
    if (!/^[a-f0-9]{64}$/i.test(resource.checksum))
      throw new Error('El recurso AR no incluye una suma SHA-256 válida.');
    const source = new URL(resource.imagePath, apiUrl);
    if (
      source.origin !== apiOrigin ||
      !/^(?:\/assets|\/stores\/[^/]+\/assets)\/catalog-ar\//.test(source.pathname)
    )
      throw new Error('El recurso AR debe pertenecer a los archivos públicos de esta tienda.');
    // Una variante solo debe ocupar una de las diez plazas del equipo.
    if (variants.has(resource.variantId)) continue;
    variants.add(resource.variantId);
    selected.push({
      resourceId: resource.id,
      variantId: resource.variantId,
      sourceUrl: source.toString(),
      checksum: resource.checksum.toLowerCase(),
    });
  }
  return selected;
}

export { MAX_OFFLINE_AR_GARMENTS };
