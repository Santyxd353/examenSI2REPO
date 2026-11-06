import { BootstrapResponseSchema } from '@lumina/contracts';
import { offlineResponse } from '../api';
import { tenantSlug } from '../tenant';
import {
  activateSession,
  assertActive,
  getDeviceId,
  lockSession,
  restoreSession,
  type OfflineSession,
} from './scope';
import { putJson, readJson } from './vault';

export type OfflineIdentity = {
  id: string;
  nombres: string;
  apellidos: string;
  roles: string[];
  permissions: string[];
  tenant?: { id: string; slug: string; name: string };
};

export async function enableOffline(identity: OfflineIdentity, signal?: AbortSignal) {
  const slug = tenantSlug(),
    deviceId = await getDeviceId();
  const response = await offlineResponse({ slug, actorId: identity.id }, '/api/offline/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
    signal,
  });
  const bootstrap = BootstrapResponseSchema.parse(await response.json());
  if (
    identity.tenant &&
    (identity.tenant.slug !== slug || identity.tenant.id !== bootstrap.tenantId)
  )
    throw new Error('La autorización corresponde a otra tienda.');
  const session = await activateSession(slug, identity.id, deviceId, bootstrap, signal);
  const { id, nombres, apellidos, roles } = identity;
  await putJson(session, 'identity', {
    id,
    nombres,
    apellidos,
    roles,
    permissions: bootstrap.permissions,
    ...(identity.tenant ? { tenant: identity.tenant } : {}),
  });
  return session;
}

export async function restoreOffline() {
  const session = await restoreSession(tenantSlug());
  if (!session) return null;
  const identity = await readJson<OfflineIdentity>(session, 'identity');
  if (!identity || identity.data.id !== session.actorId) return null;
  return { session, identity: identity.data };
}

export async function verifyOfflineIdentity(identity: OfflineIdentity | null) {
  const old = await restoreSession(tenantSlug());
  if (!old) return null;
  if (old.actorId !== identity?.id || (identity.tenant && identity.tenant.id !== old.tenantId)) {
    await lockSession(old, 'keep');
    return null;
  }
  return old;
}

export async function sessionResponse(
  session: OfflineSession,
  path: string,
  options?: RequestInit,
) {
  await assertActive(session);
  const response = await offlineResponse(session, path, options);
  await assertActive(session);
  return response;
}
