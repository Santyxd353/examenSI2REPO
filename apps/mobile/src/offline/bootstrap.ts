import { api } from '../api';
import type { Identity } from '../types';
import { getOfflineDeviceId } from './device';
import { openOfflineDatabase } from './db';
import type { OfflineScope } from './scope';
import { SQLiteIntentRepository } from './sqliteIntentRepository';
import { syncOfflineQueue } from './syncQueue';
import { storeActiveDek } from './vault';

type BootstrapReply = { dek: string; keyVersion: number; rotated: boolean };

export async function bootstrapOfflineVault(identity: Identity): Promise<OfflineScope> {
  if (!identity.tenant) throw new Error('La sesión no contiene la tienda requerida para el modo offline.');
  const scope: OfflineScope = {
    tenantId: identity.tenant.id,
    actorId: identity.id,
    deviceId: await getOfflineDeviceId(),
  };
  const reply = await api<BootstrapReply>('/offline/key/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ deviceId: scope.deviceId }),
  });
  await storeActiveDek(scope, reply.dek);
  // El fallo de red no invalida el desbloqueo local: se conservará la cola para el próximo inicio.
  void syncOfflineQueue(new SQLiteIntentRepository(await openOfflineDatabase()), scope).catch(() => {});
  return scope;
}
