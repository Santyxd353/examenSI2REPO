import * as SecureStore from 'expo-secure-store';
import { createOfflineIdentity, canRestoreOfflineIdentity, type OfflineIdentity } from './auth/offlineIdentity';
import { createSessionScope, type ScopeKey } from './auth/sessionScope';
import { ApiProblem, type ApiProblemPayload } from './errors/ApiProblem';
import { createApiHeaders } from './transport/headers';
import type { Identity } from './types';

type AuthReply = { accessToken: string; refreshToken: string; user: Identity; message?: string; code?: string };

const TENANT_KEY = 'vestidor18.tenant';
const OFFLINE_IDENTITY_KEY = (tenant: string) => `vestidor18.${tenant}.identity`;
const sessionKey = (kind: 'access' | 'refresh', tenant: string) =>
  tenant === 'lumina' ? `vestidor18.${kind}` : `vestidor18.${tenant}.${kind}`;
const scope = createSessionScope('lumina');

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://172-191-104-91.sslip.io/api').replace(/\/$/, '');
export const REALTIME_URL = API_URL.replace(/\/api$/, '');

let accessToken = '';
let refreshToken = '';
let refreshPending: { scope: ScopeKey; promise: Promise<void> } | null = null;
let clearPromise: Promise<void> | null = null;

export const getTenantSlug = () => scope.current().tenantSlug;
export const getAccessToken = () => accessToken;
export const captureSessionScope = () => scope.capture();
export const isCurrentSessionScope = (value: ScopeKey) => scope.isCurrent(value);
export const assertCurrentSessionScope = (value: ScopeKey) => scope.assertCurrent(value);

function assertValidTenant(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63)
    throw new Error('El identificador de tienda no es válido.');
}

async function responsePayload(response: Response): Promise<ApiProblemPayload> {
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? ((await response.json().catch(() => ({}))) as ApiProblemPayload)
    : {};
  return {
    ...body,
    correlationId: body.correlationId || response.headers.get('x-correlation-id') || undefined,
  };
}

async function scopedFetch(url: string, init: RequestInit, requestScope: ScopeKey) {
  try {
    const response = await fetch(url, init);
    scope.assertCurrent(requestScope);
    return response;
  } catch (reason) {
    if (!scope.isCurrent(requestScope)) scope.assertCurrent(requestScope);
    throw ApiProblem.network(reason);
  }
}

async function persistOfflineIdentity(identity: Identity, requestScope: ScopeKey) {
  scope.assertCurrent(requestScope);
  const record = createOfflineIdentity(identity, requestScope);
  await SecureStore.setItemAsync(OFFLINE_IDENTITY_KEY(requestScope.tenantSlug), JSON.stringify(record));
  scope.assertCurrent(requestScope);
}

async function readOfflineIdentity(requestScope: ScopeKey): Promise<OfflineIdentity | null> {
  const raw = await SecureStore.getItemAsync(OFFLINE_IDENTITY_KEY(requestScope.tenantSlug));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OfflineIdentity;
    return canRestoreOfflineIdentity(parsed, requestScope) ? parsed : null;
  } catch {
    return null;
  }
}

async function saveTokens(access: string, refresh: string, requestScope: ScopeKey) {
  scope.assertCurrent(requestScope);
  accessToken = access;
  refreshToken = refresh;
  await Promise.all([
    SecureStore.setItemAsync(sessionKey('access', requestScope.tenantSlug), access),
    SecureStore.setItemAsync(sessionKey('refresh', requestScope.tenantSlug), refresh),
  ]);
  scope.assertCurrent(requestScope);
}

export async function clearSession() {
  if (clearPromise) return clearPromise;
  const requestScope = scope.capture();
  scope.invalidate();
  accessToken = '';
  refreshToken = '';
  const pending = Promise.all([
    SecureStore.deleteItemAsync(sessionKey('access', requestScope.tenantSlug)),
    SecureStore.deleteItemAsync(sessionKey('refresh', requestScope.tenantSlug)),
    SecureStore.deleteItemAsync(OFFLINE_IDENTITY_KEY(requestScope.tenantSlug)),
  ])
    .then(() => undefined)
    .finally(() => {
      if (clearPromise === pending) clearPromise = null;
    });
  clearPromise = pending;
  return pending;
}

export async function selectTenant(slug: string) {
  assertValidTenant(slug);
  if (slug === getTenantSlug()) return;
  await refreshPending?.promise.catch(() => {});
  await clearSession();
  scope.switchTenant(slug);
  await SecureStore.setItemAsync(TENANT_KEY, slug);
}

async function rotate(requestScope: ScopeKey) {
  scope.assertCurrent(requestScope);
  if (!refreshToken) throw ApiProblem.fromHttp(401, { message: 'Inicia sesión para continuar.' });
  if (!refreshPending || !scope.isCurrent(refreshPending.scope)) {
    const token = refreshToken;
    const promise = scopedFetch(
      `${API_URL}/auth/mobile/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': requestScope.tenantSlug },
        body: JSON.stringify({ refreshToken: token }),
      },
      requestScope,
    )
      .then(async (response) => {
        if (!response.ok) throw ApiProblem.fromHttp(response.status, await responsePayload(response));
        const data = (await response.json()) as AuthReply;
        await saveTokens(data.accessToken, data.refreshToken, requestScope);
        await persistOfflineIdentity(data.user, requestScope);
      })
      .finally(() => {
        if (refreshPending?.promise === promise) refreshPending = null;
      });
    refreshPending = { scope: requestScope, promise };
  }
  return refreshPending.promise;
}

// Las rutas existentes aún no declaran todos sus DTO. Las nuevas rutas deben usar
// `api<T>()`; el valor por defecto conserva compatibilidad durante la migración.
export async function api<T = any>(path: string, options: RequestInit = {}, retry = true): Promise<T> {
  const requestScope = scope.capture();
  const headers = createApiHeaders(options.headers, requestScope, accessToken, options.body);

  const response = await scopedFetch(`${API_URL}${path}`, { ...options, headers }, requestScope);
  if (response.status === 401 && retry && !path.startsWith('/auth/mobile/')) {
    await rotate(requestScope);
    scope.assertCurrent(requestScope);
    return api<T>(path, options, false);
  }
  if (!response.ok) throw ApiProblem.fromHttp(response.status, await responsePayload(response));
  const data = (await response.json().catch(() => undefined)) as T;
  scope.assertCurrent(requestScope);
  return data;
}

export async function restoreSession(): Promise<Identity | null> {
  const persistedTenant = (await SecureStore.getItemAsync(TENANT_KEY)) || 'lumina';
  assertValidTenant(persistedTenant);
  scope.switchTenant(persistedTenant);
  const requestScope = scope.capture();
  const [savedAccess, savedRefresh] = await Promise.all([
    SecureStore.getItemAsync(sessionKey('access', requestScope.tenantSlug)),
    SecureStore.getItemAsync(sessionKey('refresh', requestScope.tenantSlug)),
  ]);
  accessToken = savedAccess || '';
  refreshToken = savedRefresh || '';
  if (!refreshToken) return null;
  try {
    const identity = await api<Identity>('/auth/me');
    await persistOfflineIdentity(identity, requestScope);
    return identity;
  } catch (reason) {
    if (ApiProblem.isNetwork(reason)) {
      const offline = await readOfflineIdentity(requestScope);
      if (offline && scope.isCurrent(requestScope)) return offline.identity;
      throw reason;
    }
    if (scope.isCurrent(requestScope)) await clearSession();
    return null;
  }
}

async function authenticate(path: string, payload: Record<string, string>): Promise<Identity> {
  await clearPromise;
  const requestScope = scope.capture();
  const response = await scopedFetch(
    `${API_URL}${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': requestScope.tenantSlug },
      body: JSON.stringify(payload),
    },
    requestScope,
  );
  const data = (await response.json().catch(() => ({}))) as AuthReply;
  if (!response.ok) throw ApiProblem.fromHttp(response.status, data);
  await saveTokens(data.accessToken, data.refreshToken, requestScope);
  await persistOfflineIdentity(data.user, requestScope);
  return data.user;
}

export const login = (correo: string, clave: string) => authenticate('/auth/mobile/login', { correo, clave });

export const registerClient = (nombres: string, apellidos: string, correo: string, clave: string) =>
  authenticate('/auth/mobile/register', { nombres, apellidos, correo, clave });

export async function logout() {
  const tenantSlug = getTenantSlug();
  const currentRefresh = refreshToken;
  await clearSession();
  if (!currentRefresh) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    await fetch(`${API_URL}/auth/mobile/logout`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': tenantSlug },
      body: JSON.stringify({ refreshToken: currentRefresh }),
    });
  } catch {
    // El cierre local ya revocó el acceso local; el servidor expira el token restante.
  } finally {
    clearTimeout(timeout);
  }
}
