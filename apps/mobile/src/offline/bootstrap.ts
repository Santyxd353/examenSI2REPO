import { api } from '../api';
import { BootstrapResponseSchema } from '@lumina/contracts';
import { captureSessionScope, assertCurrentSessionScope } from '../api';
import type { Identity } from '../types';
import { getOfflineDeviceId } from './device';
import { openOfflineDatabase } from './db';
import type { OfflineScope } from './scope';
import { createIntentRepository, createPrivateRecords } from './nativeStorage';
import { syncOfflineQueue } from './syncQueue';
import { storeActiveDek } from './vault';

export async function bootstrapOfflineVault(identity: Identity): Promise<OfflineScope> {
  const session = captureSessionScope();
  if (!identity.tenant)
    throw new Error('La sesión no contiene la tienda requerida para el modo offline.');
  const scope: OfflineScope = {
    tenantId: identity.tenant.id,
    actorId: identity.id,
    deviceId: await getOfflineDeviceId(),
  };
  assertCurrentSessionScope(session);
  const reply = BootstrapResponseSchema.parse(
    await api<unknown>('/offline/bootstrap', {
      method: 'POST',
      body: JSON.stringify({ deviceId: scope.deviceId }),
    }),
  );
  assertCurrentSessionScope(session);
  if (
    reply.tenantId !== scope.tenantId ||
    reply.actorId !== scope.actorId ||
    reply.deviceId !== scope.deviceId
  )
    throw new Error('La clave recibida pertenece a otra cuenta o dispositivo.');
  await storeActiveDek(scope, reply.keyBase64);
  assertCurrentSessionScope(session);
  // El fallo de red no invalida el desbloqueo local: se conservará la cola para el próximo inicio.
  const database = await openOfflineDatabase();
  assertCurrentSessionScope(session);
  await createPrivateRecords(database).put(scope, 'bootstrap', 'current', reply);
  assertCurrentSessionScope(session);
  void syncOfflineQueue(createIntentRepository(database), scope).catch(() => {});
  return scope;
}
