import { tenantSlug } from './tenant';
let accessToken = '';
let authRevision = 0;
let closingSession = false;
export const setToken = (value: string) => {
  authRevision++;
  accessToken = value;
};
let refreshPromise: Promise<any> | null = null;
export async function refresh() {
  if (closingSession) throw new Error('La sesión se está cerrando.');
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
          throw new Error('Inicia sesión para continuar.');
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
