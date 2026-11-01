import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { OfflineScope } from '../../offline/scope';
import type { ArDownload } from './offlineArCatalog';

export type CachedArResource = Readonly<{
  resourceId: string;
  variantId: string;
  checksum: string;
  localUri: string;
}>;

const storage = new Directory(Paths.document, 'lumina-offline-ar');

function safeFileName(resourceId: string) {
  if (!/^[a-z0-9-]{1,80}$/i.test(resourceId)) throw new Error('El identificador del recurso AR no es válido.');
  return `${resourceId}.png`;
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Descarga a almacenamiento durable y verifica la suma entregada por el servidor antes de usarla. */
export async function downloadVerifiedArResource(
  resource: ArDownload,
  headers: Record<string, string> = {},
): Promise<CachedArResource> {
  storage.create({ intermediates: true, idempotent: true });
  const target = new File(storage, safeFileName(resource.resourceId));
  const downloaded = await File.downloadFileAsync(resource.sourceUrl, target, { headers, idempotent: true });
  const actual = hex(await digest(CryptoDigestAlgorithm.SHA256, await downloaded.bytes()));
  if (actual !== resource.checksum.toLowerCase()) {
    downloaded.delete();
    throw new Error('La verificación SHA-256 del recurso AR falló.');
  }
  return {
    resourceId: resource.resourceId,
    variantId: resource.variantId,
    checksum: actual,
    localUri: downloaded.uri,
  };
}

export async function saveCachedArResource(
  database: SQLiteDatabase,
  scope: OfflineScope,
  resource: CachedArResource,
) {
  await database.runAsync(
    `INSERT INTO offline_ar_resource
      (tenant_id, actor_id, device_id, resource_id, variant_id, checksum, local_uri, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, actor_id, device_id, resource_id)
     DO UPDATE SET variant_id=excluded.variant_id, checksum=excluded.checksum,
       local_uri=excluded.local_uri, downloaded_at=excluded.downloaded_at`,
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
    resource.resourceId,
    resource.variantId,
    resource.checksum,
    resource.localUri,
    new Date().toISOString(),
  );
}
