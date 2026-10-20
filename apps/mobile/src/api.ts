import * as SecureStore from 'expo-secure-store';
import type { Identity } from './types';
type AuthReply = { accessToken: string; refreshToken: string; user: Identity; message?: string };

const TENANT_KEY = 'vestidor18.tenant';
let selectedTenant = 'lumina';
const sessionKey = (kind: 'access' | 'refresh', store = selectedTenant) =>
  store === 'lumina' ? `vestidor18.${kind}` : `vestidor18.${store}.${kind}`;
let sessionEpoch = 0;
const captureSession = () => ({ store: selectedTenant, epoch: sessionEpoch });
function assertSession(scope: ReturnType<typeof captureSession>) {
  if (scope.store !== selectedTenant || scope.epoch !== sessionEpoch)
    throw new Error('La tienda o la sesión cambió.');
}
export const getTenantSlug = () => selectedTenant;
export async function selectTenant(slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63)
    throw new Error('El identificador de tienda no es válido.');
  if (slug === selectedTenant) return;
  await refreshPromise?.catch(() => {});
  await clearPromise;
  sessionEpoch++;
  selectedTenant = slug;
  accessToken = '';
  refreshToken = '';
  await SecureStore.setItemAsync(TENANT_KEY, slug);
}
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || 'https://172-191-104-91.sslip.io/api'
).replace(/\/$/, '');
export const REALTIME_URL = API_URL.replace(/\/api$/, '');

let accessToken = '';
let refreshToken = '';
let refreshPromise: Promise<void> | null = null;
let clearPromise: Promise<void> | null = null;

async function saveTokens(access: string, refresh: string, scope = captureSession()) {
  assertSession(scope);
  accessToken = access;
  refreshToken = refresh;
  await Promise.all([
    SecureStore.setItemAsync(sessionKey('access', scope.store), access),
    SecureStore.setItemAsync(sessionKey('refresh', scope.store), refresh),
  ]);
  assertSession(scope);
}

export function clearSession() {
  if (clearPromise) return clearPromise;
  const store = selectedTenant;
  sessionEpoch++;
  accessToken = '';
  refreshToken = '';
  const pending = Promise.all([
    SecureStore.deleteItemAsync(sessionKey('access', store)),
    SecureStore.deleteItemAsync(sessionKey('refresh', store)),
  ])
    .then(() => undefined)
    .finally(() => {
      if (clearPromise === pending) clearPromise = null;
    });
  clearPromise = pending;
  return pending;
}

async function rotate() {
  const scope = captureSession();
  if (!refreshToken) throw new Error('Inicia sesión para continuar.');
  if (!refreshPromise)
    refreshPromise = fetch(`${API_URL}/auth/mobile/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': scope.store },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('La sesión venció.');
        const data = (await response.json()) as AuthReply;
        await saveTokens(data.accessToken, data.refreshToken, scope);
      })
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}

export async function api(path: string, options: RequestInit = {}, retry = true): Promise<any> {
  const scope = captureSession();
  const headers = new Headers(options.headers);
  headers.set('X-Client-Channel', 'APP');
  headers.set('X-Tenant-Slug', scope.store);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  assertSession(scope);
  if (response.status === 401 && retry && !path.startsWith('/auth/mobile/')) {
    await rotate();
    assertSession(scope);
    return api(path, options, false);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message || 'No se pudo conectar con el servidor.');
  }
  const data = await response.json();
  assertSession(scope);
  return data;
}

export async function restoreSession(): Promise<Identity | null> {
  selectedTenant = (await SecureStore.getItemAsync(TENANT_KEY)) || 'lumina';
  const [savedAccess, savedRefresh] = await Promise.all([
    SecureStore.getItemAsync(sessionKey('access')),
    SecureStore.getItemAsync(sessionKey('refresh')),
  ]);
  accessToken = savedAccess || '';
  refreshToken = savedRefresh || '';
  if (!refreshToken) return null;
  try {
    return await api('/auth/me');
  } catch {
    await clearSession();
    return null;
  }
}

export async function login(correo: string, clave: string): Promise<Identity> {
  await clearPromise;
  const scope = captureSession();
  const response = await fetch(`${API_URL}/auth/mobile/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': scope.store },
    body: JSON.stringify({ correo, clave }),
  });
  const data = (await response.json().catch(() => ({}))) as AuthReply;
  if (!response.ok) throw new Error(data.message || 'Correo o contraseña incorrectos.');
  await saveTokens(data.accessToken, data.refreshToken, scope);
  return data.user;
}

export async function registerClient(
  nombres: string,
  apellidos: string,
  correo: string,
  clave: string,
): Promise<Identity> {
  await clearPromise;
  const scope = captureSession();
  const response = await fetch(`${API_URL}/auth/mobile/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': scope.store },
    body: JSON.stringify({ nombres, apellidos, correo, clave }),
  });
  const data = (await response.json().catch(() => ({}))) as AuthReply;
  if (!response.ok) throw new Error(data.message || 'No se pudo crear la cuenta.');
  await saveTokens(data.accessToken, data.refreshToken, scope);
  return data.user;
}

export async function logout() {
  const store = selectedTenant;
  const currentRefresh = refreshToken;
  await clearSession();
  if (currentRefresh) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    await fetch(`${API_URL}/auth/mobile/logout`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': store },
      body: JSON.stringify({ refreshToken: currentRefresh }),
    })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }
}

export const getAccessToken = () => accessToken;
