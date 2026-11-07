import { ArPlacementSchema, OutfitManifestSchema, type OutfitManifest } from '@lumina/contracts';
import { fromBase64, toBase64 } from '../../offline/base64';
import type { OfflineScope } from '../../offline/scope';
import type { Product, Variant } from '../../types';

type Garment = OutfitManifest['garments'][number];
export type OutfitCacheIO = {
  read(key: string): Promise<unknown | null>;
  write(key: string, value: unknown): Promise<void>;
  remove(keys: string[]): Promise<void>;
  get(path: string): Promise<{ bytes: Uint8Array; contentType: string | null }>;
  digest(bytes: Uint8Array): Promise<string>;
  guard(): void;
};
type Pointer = { manifest: OutfitManifest; failures: Record<string, string> };
export type LocalOutfit = {
  manifest: OutfitManifest;
  readyIds: string[];
  bytesVerified: number;
  failures: Record<string, string>;
};
export type OutfitCacheStatus = { active: LocalOutfit | null; pending: LocalOutfit | null };
const current = 'outfit:current',
  pending = 'outfit:pending';
const asset = (packageId: string, resourceId: string) =>
  'outfit:asset:' + packageId + ':' + resourceId;

export function arGarmentImageUrl(apiUrl: string, path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith('data:image/png;base64,')) return path;
  return apiUrl.replace(/\/api\/?$/, '') + path;
}

export function privateOutfitPath(
  apiUrl: string,
  scope: OfflineScope,
  manifest: OutfitManifest,
  garment: Garment,
) {
  const base = new URL(apiUrl),
    url = new URL(garment.privateDownloadUrl, base);
  const path =
    base.pathname.replace(/\/$/, '') +
    '/offline/outfits/' +
    manifest.packageId +
    '/files/' +
    garment.resourceId;
  if (
    url.origin !== base.origin ||
    url.pathname !== path ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.get('deviceId') !== scope.deviceId ||
    [...url.searchParams.keys()].length !== 1
  )
    throw new Error('El archivo no pertenece al paquete privado de esta sesión.');
  return url.pathname.slice(base.pathname.replace(/\/$/, '').length) + url.search;
}

/** El último paquete íntegro permanece utilizable mientras se prepara su reemplazo. */
export class NativeOutfitCache {
  constructor(
    private apiUrl: string,
    private scope: OfflineScope,
    private io: OutfitCacheIO,
  ) {}
  private checked(raw: unknown) {
    this.io.guard();
    const manifest = OutfitManifestSchema.parse(raw);
    if (
      manifest.tenantId !== this.scope.tenantId ||
      manifest.ownerId !== this.scope.actorId ||
      manifest.platform !== 'ANDROID_AR'
    )
      throw new Error('El paquete pertenece a otra cuenta o plataforma.');
    for (const garment of manifest.garments) {
      ArPlacementSchema.parse(garment.placement);
      privateOutfitPath(this.apiUrl, this.scope, manifest, garment);
    }
    return manifest;
  }
  private async pointer(key: string): Promise<Pointer | null> {
    this.io.guard();
    const raw = await this.io.read(key);
    this.io.guard();
    if (!raw) return null;
    const value = raw as { manifest?: unknown; failures?: Record<string, string> };
    return { manifest: this.checked(value.manifest), failures: value.failures ?? {} };
  }
  private async verified(manifest: OutfitManifest, garment: Garment) {
    this.io.guard();
    const saved = await this.io.read(asset(manifest.packageId, garment.resourceId));
    this.io.guard();
    const value = saved as { base64?: unknown; bytes?: unknown } | null;
    if (!value || typeof value.base64 !== 'string' || value.bytes !== garment.bytes)
      throw new Error('El archivo todavía no está descargado o está dañado.');
    const bytes = fromBase64(value.base64);
    await this.verifyBytes(bytes, garment);
    this.io.guard();
    return value.base64;
  }
  private async verifyBytes(bytes: Uint8Array, garment: Garment) {
    const png = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.length !== garment.bytes ||
      bytes.length > 50 * 1024 * 1024 ||
      png.some((byte, index) => bytes[index] !== byte) ||
      (await this.io.digest(bytes)) !== garment.sha256
    )
      throw new Error('El archivo no coincide con el recurso verificado del paquete.');
    this.io.guard();
  }
  private async inspect(value: Pointer | null): Promise<LocalOutfit | null> {
    if (!value) return null;
    const readyIds: string[] = [],
      failures = { ...value.failures };
    let bytesVerified = 0;
    for (const garment of value.manifest.garments) {
      try {
        await this.verified(value.manifest, garment);
        readyIds.push(garment.resourceId);
        bytesVerified += garment.bytes;
        delete failures[garment.resourceId];
      } catch {
        this.io.guard();
        failures[garment.resourceId] ??= 'Pendiente de descarga o verificación.';
      }
    }
    return { manifest: value.manifest, readyIds, bytesVerified, failures };
  }
  async status(): Promise<OutfitCacheStatus> {
    const a = await this.pointer(current),
      p = await this.pointer(pending);
    return {
      active: await this.inspect(a),
      pending: p?.manifest.packageId === a?.manifest.packageId ? null : await this.inspect(p),
    };
  }
  async download(
    raw: unknown,
    progress?: (status: OutfitCacheStatus) => void,
  ): Promise<OutfitCacheStatus> {
    const manifest = this.checked(raw),
      previous = await this.pointer(pending);
    const oldActive = await this.pointer(current);
    if (
      previous &&
      previous.manifest.packageId !== manifest.packageId &&
      previous.manifest.packageId !== oldActive?.manifest.packageId
    )
      await this.io.remove(
        previous.manifest.garments.map((g) => asset(previous.manifest.packageId, g.resourceId)),
      );
    const value: Pointer = { manifest, failures: {} };
    await this.io.write(pending, value);
    this.io.guard();
    for (const garment of manifest.garments) {
      try {
        try {
          await this.verified(manifest, garment);
          continue;
        } catch {
          this.io.guard();
        }
        const response = await this.io.get(
          privateOutfitPath(this.apiUrl, this.scope, manifest, garment),
        );
        this.io.guard();
        if (response.contentType !== 'image/png')
          throw new Error('El recurso recibido no es una imagen PNG compatible.');
        await this.verifyBytes(response.bytes, garment);
        await this.io.write(asset(manifest.packageId, garment.resourceId), {
          base64: toBase64(response.bytes),
          bytes: response.bytes.length,
        });
        this.io.guard();
      } catch (error) {
        this.io.guard();
        value.failures[garment.resourceId] = (error as Error).message;
      }
      await this.io.write(pending, value);
      this.io.guard();
      progress?.(await this.status());
    }
    const ready = await this.inspect(value);
    this.io.guard();
    if (manifest.garments.length && ready?.readyIds.length === manifest.garments.length) {
      await this.io.write(current, { manifest, failures: {} });
      this.io.guard();
      await this.io.remove([pending]);
      if (oldActive && oldActive.manifest.packageId !== manifest.packageId)
        await this.io.remove(
          oldActive.manifest.garments.map((g) => asset(oldActive.manifest.packageId, g.resourceId)),
        );
    }
    this.io.guard();
    return this.status();
  }
  async image(packageId: string, resourceId: string) {
    const pointers = [await this.pointer(current), await this.pointer(pending)];
    const manifest = pointers.find((value) => value?.manifest.packageId === packageId)?.manifest;
    const garment = manifest?.garments.find((g) => g.resourceId === resourceId);
    if (!manifest || !garment) throw new Error('La prenda no pertenece a tu descarga.');
    return 'data:image/png;base64,' + (await this.verified(manifest, garment));
  }
  async clear() {
    const pointers = [await this.pointer(current), await this.pointer(pending)];
    const keys = [
      current,
      pending,
      ...pointers.flatMap((value) =>
        value
          ? value.manifest.garments.map((g) => asset(value.manifest.packageId, g.resourceId))
          : [],
      ),
    ];
    this.io.guard();
    await this.io.remove([...new Set(keys)]);
    this.io.guard();
  }
}

export function outfitSelection(
  garment: Garment,
  uri: string,
): { product: Product; variant: Variant } {
  const placement = ArPlacementSchema.parse(garment.placement);
  const variant: Variant = {
    id: garment.variantId,
    talla: garment.size ?? '',
    color: garment.color ?? '',
    color_hex: garment.colorHex ?? undefined,
    precio: 0,
    disponible: 0,
    ubicaciones: [],
    arImagePath: uri,
  };
  return {
    variant,
    product: {
      id: garment.productId,
      categoria_id: 'offline',
      nombre: garment.productName ?? 'Prenda descargada',
      descripcion: 'Recurso disponible sin conexión. ' + garment.license,
      material: '',
      tipoPrenda:
        placement.kind === 'dress' ? 'Vestido' : placement.kind === 'skirt' ? 'Falda' : 'Top',
      variantes: [variant],
    },
  };
}
