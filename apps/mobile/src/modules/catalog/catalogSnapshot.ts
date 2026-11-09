import { openJson, sealJson, type VaultEnvelope } from '../../offline/crypto';
import { openOfflineDatabase } from '../../offline/db';
import { offlineScopeKey, type OfflineScope } from '../../offline/scope';
import { readActiveDek } from '../../offline/vault';

const aadFor = (scope: OfflineScope) => `catalog:${offlineScopeKey(scope)}`;

export async function saveCatalogSnapshot<T>(scope: OfflineScope, value: T) {
  const dek = await readActiveDek(scope);
  if (!dek) throw new Error('Desbloquea el almacén offline antes de descargar el catálogo.');
  const payload = JSON.stringify(await sealJson(value, dek, aadFor(scope)));
  const database = await openOfflineDatabase();
  await database.runAsync(
    `INSERT INTO offline_catalog_snapshot
       (tenant_id,actor_id,device_id,payload,updated_at) VALUES (?,?,?,?,?)
     ON CONFLICT(tenant_id,actor_id,device_id)
     DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`,
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
    payload,
    new Date().toISOString(),
  );
}

export async function readCatalogSnapshot<T>(scope: OfflineScope): Promise<T | null> {
  const dek = await readActiveDek(scope);
  if (!dek) throw new Error('El almacén offline está bloqueado para esta sesión.');
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM offline_catalog_snapshot
     WHERE tenant_id=? AND actor_id=? AND device_id=?`,
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
  );
  return row ? openJson<T>(JSON.parse(row.payload) as VaultEnvelope, dek, aadFor(scope)) : null;
}
