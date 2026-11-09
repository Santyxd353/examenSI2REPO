import type { Catalog } from '../../types';
import { openJson, sealJson, type VaultEnvelope } from '../../offline/crypto';
import { openOfflineDatabase } from '../../offline/db';
import { offlineScopeKey, type OfflineScope } from '../../offline/scope';
import { readActiveDek } from '../../offline/vault';

const aadFor = (scope: OfflineScope) => `customer-catalog:${offlineScopeKey(scope)}`;

export async function saveCustomerCatalogSnapshot(scope: OfflineScope, catalog: Catalog) {
  const dek = await readActiveDek(scope);
  if (!dek) throw new Error('El catálogo offline está bloqueado.');
  const payload = JSON.stringify(await sealJson(catalog, dek, aadFor(scope)));
  const database = await openOfflineDatabase();
  await database.runAsync(
    `INSERT INTO offline_customer_catalog (tenant_id,actor_id,device_id,payload,updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(tenant_id,actor_id,device_id)
     DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`,
    scope.tenantId, scope.actorId, scope.deviceId, payload, new Date().toISOString(),
  );
}

export async function readCustomerCatalogSnapshot(scope: OfflineScope) {
  const dek = await readActiveDek(scope);
  if (!dek) return null;
  const database = await openOfflineDatabase();
  const row = await database.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM offline_customer_catalog
     WHERE tenant_id=? AND actor_id=? AND device_id=?`,
    scope.tenantId, scope.actorId, scope.deviceId,
  );
  return row ? openJson<Catalog>(JSON.parse(row.payload) as VaultEnvelope, dek, aadFor(scope)) : null;
}
