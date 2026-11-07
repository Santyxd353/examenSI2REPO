import { tenantSlug } from './tenant';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}
let accessToken = '';
let authRevision = 0;
let closingSession = false;
const signoutKey = () => 'lumina.local-signout:' + tenantSlug();
export function setLocalSignout(signedOut: boolean) {
  try {
    if (signedOut) localStorage.setItem(signoutKey(), '1');
    else localStorage.removeItem(signoutKey());
  } catch {
    /* Local storage can be disabled. */
  }
}
export function locallySignedOut() {
  try {
    return localStorage.getItem(signoutKey()) === '1';
  } catch {
    return false;
  }
}
export const setToken = (value: string) => {
  authRevision++;
  accessToken = value;
};
let refreshPromise: Promise<any> | null = null;
export async function refresh() {
  if (closingSession) throw new Error('La sesión se está cerrando.');
  if (locallySignedOut()) throw new ApiError(401, 'Inicia sesión para continuar.');
  const revision = authRevision;
  if (!refreshPromise)
    refreshPromise = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Tenant-Slug': tenantSlug() },
    })
      .then(async (r) => {
        if (revision !== authRevision || closingSession) throw new Error('La sesión cambió.');
        if (!r.ok) {
          accessToken = '';
          throw new ApiError(r.status, 'Inicia sesión para continuar.');
        }
        const data = await r.json();
        if (revision !== authRevision || closingSession) throw new Error('La sesión cambió.');
        setToken(data.accessToken);
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}
export async function logoutSession() {
  closingSession = true;
  authRevision++;
  try {
    await refreshPromise?.catch(() => {});
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Tenant-Slug': tenantSlug() },
    });
    if (!response.ok) throw new Error('No se pudo cerrar la sesión. Vuelve a intentarlo.');
    setToken('');
  } finally {
    closingSession = false;
  }
}
export async function api(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  if (closingSession && !path.startsWith('/auth/')) throw new Error('La sesión se está cerrando.');
  const headers = new Headers(options.headers);
  headers.set('X-Tenant-Slug', tenantSlug());
  if (accessToken) headers.set('Authorization', 'Bearer ' + accessToken);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch('/api' + path, { ...options, headers, credentials: 'include' });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    await refresh();
    return api(path, options, false);
  }
  if (!response.ok) {
    const d = await response.json().catch(() => ({}));
    throw new Error(d.message || 'No se pudo conectar. Intenta nuevamente.');
  }
  if (response.headers.get('Content-Type')?.includes('model/')) return response.blob();
  return response.json();
}
export async function privateModel(path: string) {
  const blob = await api(path);
  return URL.createObjectURL(blob);
}
type NetworkIdentity = { slug: string; actorId: string };
function tokenScope(token: string) {
  try {
    const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
    return JSON.parse(atob(payload)) as { sub: string; tenant: string; sid: string };
  } catch {
    return null;
  }
}
// Use the captured scope through refresh and retry. The API independently verifies the token.
export async function offlineResponse(
  identity: NetworkIdentity,
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !url.pathname.startsWith('/api/') ||
    identity.slug !== tenantSlug()
  )
    throw new Error('La solicitud no pertenece a esta tienda.');
  options.signal?.throwIfAborted();
  if (closingSession) throw new Error('La sesión se está cerrando.');
  if (!accessToken) await refresh();
  const token = tokenScope(accessToken);
  if (!token || token.sub !== identity.actorId || token.tenant !== identity.slug)
    throw new ApiError(
      403,
      'Inicia sesión con la cuenta propietaria de la copia.',
      'OFFLINE_IDENTITY_CHANGED',
    );
  const headers = new Headers(options.headers);
  headers.set('X-Tenant-Slug', identity.slug);
  headers.set('X-Client-Channel', 'WEB');
  headers.set('Authorization', 'Bearer ' + accessToken);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, cache: 'no-store', redirect: 'error' });
  const current = tokenScope(accessToken);
  if (
    closingSession ||
    current?.sid !== token.sid ||
    current.sub !== token.sub ||
    current.tenant !== token.tenant
  )
    throw new Error('La sesión cambió durante la solicitud.');
  if (response.status === 401 && retry) {
    await refresh();
    if (tokenScope(accessToken)?.sid !== token.sid)
      throw new Error('La sesión cambió durante la solicitud.');
    return offlineResponse(identity, path, options, false);
  }
  if (!response.ok) {
    const issue = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      issue.message || 'No se pudo completar la solicitud.',
      issue.code,
    );
  }
  return response;
}
