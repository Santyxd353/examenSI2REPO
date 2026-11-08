import { openJson, sealJson, type VaultEnvelope } from './crypto';
import { openOfflineDatabase } from './db';
import { offlineScopeKey, type OfflineScope } from './scope';
import { readActiveDek } from './vault';

const aadFor = (scope: OfflineScope, locationId: string) =>
  `inventory:${offlineScopeKey(scope)}:${locationId}`;

export async function saveInventorySnapshot<T>(scope: OfflineScope, locationId: string, rows: T[]) {
  const dek = await readActiveDek(scope);
  if (!dek) throw new Error('Desbloquea el almacén offline antes de descargar inventario.');
  const payload = JSON.stringify(await sealJson(rows, dek, aadFor(scope, locationId)));
  const db = await openOfflineDatabase();
  await db.runAsync(
    `INSERT INTO offline_inventory_snapshot
       (tenant_id,actor_id,device_id,location_id,payload,updated_at) VALUES (?,?,?,?,?,?)
     ON CONFLICT(tenant_id,actor_id,device_id,location_id)
     DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at`,
    scope.tenantId, scope.actorId, scope.deviceId, locationId, payload, new Date().toISOString(),
  );
}

export async function readInventorySnapshot<T>(scope: OfflineScope, locationId: string): Promise<T[] | null> {
  const dek = await readActiveDek(scope);
  if (!dek) throw new Error('El almacén offline está bloqueado para esta sesión.');
  const db = await openOfflineDatabase();
  const row = await db.getFirstAsync<{ payload: string }>(
    `SELECT payload FROM offline_inventory_snapshot
     WHERE tenant_id=? AND actor_id=? AND device_id=? AND location_id=?`,
    scope.tenantId, scope.actorId, scope.deviceId, locationId,
  );
  return row ? openJson<T[]>(JSON.parse(row.payload) as VaultEnvelope, dek, aadFor(scope, locationId)) : null;
}
