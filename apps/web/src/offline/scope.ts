import { BootstrapResponseSchema, UuidSchema, type Entitlements } from '@lumina/contracts';
import { request, withTransaction } from './database';

export type OfflineSession = {
  slug: string;
  tenantId: string;
  actorId: string;
  deviceId: string;
  leaseId: string;
  keyVersion: number;
  key: CryptoKey;
};
export type LocalAuthorization = {
  permissions: string[];
  locationIds: string[];
  entitlements: Entitlements;
  issuedAt: string;
};
export const scopeKey = (session: Pick<OfflineSession, 'tenantId' | 'actorId' | 'deviceId'>) =>
  [session.tenantId, session.actorId, session.deviceId].join(':');
const CHANNEL = 'lumina-offline-session';
const tabId = Math.random().toString(36).slice(2);
function publishChange(slug: string) {
  if (!('BroadcastChannel' in globalThis)) return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ slug, tabId });
  channel.close();
}
export function onSessionChange(listener: (slug: string) => void) {
  if (!('BroadcastChannel' in globalThis)) return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event) => {
    if (event.data?.tabId !== tabId && typeof event.data?.slug === 'string')
      listener(event.data.slug);
  };
  return () => channel.close();
}
const tenantSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function checkedSlug(slug: string) {
  if (slug.length > 63 || !tenantSlug.test(slug)) throw new Error('Selecciona una tienda válida.');
  return slug;
}

export async function getDeviceId() {
  return withTransaction(['settings'], 'readwrite', async ({ settings }) => {
    const old = await request(settings.get('deviceId'));
    if (old) return UuidSchema.parse(old.value);
    const value = crypto.randomUUID();
    await request(settings.add({ key: 'deviceId', value }));
    return value;
  });
}

export async function restoreSession(slug: string): Promise<OfflineSession | null> {
  return withTransaction(['sessions'], 'readonly', async ({ sessions }) => {
    const row = (await request(sessions.get(checkedSlug(slug)))) as OfflineSession | undefined;
    return row?.key?.type === 'secret' && !row.key.extractable ? row : null;
  });
}

export async function assertSession(sessions: IDBObjectStore, session: OfflineSession) {
  const active = (await request(sessions.get(session.slug))) as OfflineSession | undefined;
  if (!active || active.leaseId !== session.leaseId || scopeKey(active) !== scopeKey(session))
    throw new Error('La copia local está bloqueada. Abre la sesión de origen.');
}

export async function assertActive(session: OfflineSession) {
  return withTransaction(['sessions'], 'readonly', ({ sessions }) =>
    assertSession(sessions, session),
  );
}

export async function activateSession(
  slug: string,
  expectedActorId: string,
  expectedDeviceId: string,
  raw: unknown,
  signal?: AbortSignal,
) {
  const bootstrap = BootstrapResponseSchema.parse(raw);
  if (
    bootstrap.actorId !== UuidSchema.parse(expectedActorId) ||
    bootstrap.deviceId !== UuidSchema.parse(expectedDeviceId)
  )
    throw new Error('La autorización offline pertenece a otra identidad.');
  if (bootstrap.deviceId !== (await getDeviceId()))
    throw new Error('La autorización pertenece a otro dispositivo.');
  const keyBytes = Uint8Array.from(atob(bootstrap.keyBase64), (char) => char.charCodeAt(0));
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    keyBytes.fill(0);
  }
  const session: OfflineSession = {
    slug: checkedSlug(slug),
    tenantId: bootstrap.tenantId,
    actorId: bootstrap.actorId,
    deviceId: bootstrap.deviceId,
    leaseId: crypto.randomUUID(),
    keyVersion: bootstrap.keyVersion,
    key,
  };
  const { sealJson } = await import('./vault');
  const authorization = await sealJson(session, 'authorization', {
    permissions: bootstrap.permissions,
    locationIds: bootstrap.locationIds,
    entitlements: bootstrap.entitlements,
    issuedAt: bootstrap.issuedAt,
  } satisfies LocalAuthorization);
  await withTransaction(['sessions', 'vault'], 'readwrite', async ({ sessions, vault }) => {
    signal?.throwIfAborted();
    await request(sessions.put(session));
    await request(vault.put(authorization));
    signal?.throwIfAborted();
  });
  publishChange(session.slug);
  return session;
}

export async function lockSession(session: OfflineSession, choice: 'keep' | 'discard') {
  await withTransaction(['sessions', 'vault'], 'readwrite', async ({ sessions, vault }) => {
    await assertSession(sessions, session);
    if (choice === 'discard') {
      const keys = await request(
        vault.index('scope').getAllKeys(IDBKeyRange.only(scopeKey(session))),
      );
      for (const key of keys) await request(vault.delete(key));
    }
    await request(sessions.delete(session.slug));
  });
  publishChange(session.slug);
}
