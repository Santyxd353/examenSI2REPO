const mockSecure = new Map<string, string>();
const mockDelete = jest.fn(async (key: string) => {
  mockSecure.delete(key);
});
const mockSet = jest.fn(async (key: string, value: string) => {
  mockSecure.set(key, value);
});
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000009' }), {
  virtual: true,
});
jest.mock(
  'expo-secure-store',
  () => ({
    getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) || null),
    setItemAsync: (key: string, value: string) => mockSet(key, value),
    deleteItemAsync: (key: string) => mockDelete(key),
  }),
  { virtual: true },
);

const originalFetch = global.fetch;
const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
const session = (store: string) => ({
  accessToken: `access-${store}`,
  refreshToken: `refresh-${store}`,
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    nombres: 'Ana',
    apellidos: 'QA',
    correo: 'ana@qa.test',
    roles: ['Administrador'],
    permissions: [],
    tenant: {
      id: '00000000-0000-4000-8000-000000000002',
      slug: 'tienda-' + store,
      name: 'Tienda QA',
    },
  },
});

beforeEach(() => {
  jest.resetModules();
  mockSecure.clear();
  mockSet.mockImplementation(async (key: string, value: string) => {
    mockSecure.set(key, value);
  });
  mockDelete.mockImplementation(async (key: string) => {
    mockSecure.delete(key);
  });
  process.env.EXPO_PUBLIC_API_URL = 'http://invalid.test/api';
});
afterAll(() => {
  global.fetch = originalFetch;
});

test('los archivos privados usan la sesión APP y una lectura tardía no llega a otra tienda', async () => {
  let finish!: (value: ArrayBuffer) => void;
  const pending = new Promise<ArrayBuffer>((resolve) => {
    finish = resolve;
  });
  global.fetch = jest.fn(async (url) =>
    String(url).endsWith('/private.png')
      ? ({
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'image/png' }),
          arrayBuffer: () => pending,
        } as Response)
      : reply(session('a')),
  ) as typeof fetch;
  const client = require('../../mobile/src/api') as typeof import('../../mobile/src/api');
  await client.selectTenant('tienda-a');
  await client.login('a@ejemplo.test', 'PruebaSegura2026!');
  const reading = client.apiBytes('/private.png');
  await new Promise((resolve) => setImmediate(resolve));
  const call = (global.fetch as jest.Mock).mock.calls.find(([url]: [string]) =>
    url.endsWith('/private.png'),
  );
  expect(call[1].headers.get('X-Client-Channel')).toBe('APP');
  expect(call[1].headers.get('X-Tenant-Slug')).toBe('tienda-a');
  await client.selectTenant('tienda-b');
  finish(new Uint8Array([137, 80, 78, 71]).buffer);
  await expect(reading).rejects.toThrow(/cambió/);
});

test('logout durante la persistencia no restaura tokens al terminar las escrituras antiguas', async () => {
  global.fetch = jest.fn(async () => reply(session('a'))) as typeof fetch;
  const client = require('../../mobile/src/api') as typeof import('../../mobile/src/api');
  await client.selectTenant('tienda-a');
  let started!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockSet.mockImplementation(async (key: string, value: string) => {
    started();
    await pause;
    mockSecure.set(key, value);
  });
  const login = client.login('a@ejemplo.test', 'PruebaSegura2026!');
  await waiting;
  const logout = client.logout();
  release();
  await expect(login).rejects.toThrow(/cambió/);
  await logout;
  expect(
    [...mockSecure.values()].filter(
      (value) => value.startsWith('access-') || value.startsWith('refresh-'),
    ),
  ).toEqual([]);
  expect(client.getAccessToken()).toBe('');
});

test('una revocación confirmada por el servidor cierra la sesión y bloquea las claves offline', async () => {
  global.fetch = jest.fn(async (url) =>
    String(url).endsWith('/login')
      ? reply(session('a'))
      : ({
          ...reply({ message: 'Sesión revocada' }),
          ok: false,
          status: 401,
          headers: new Headers({ 'Content-Type': 'application/json' }),
        } as Response),
  ) as typeof fetch;
  const client = require('../../mobile/src/api') as typeof import('../../mobile/src/api');
  await client.selectTenant('tienda-a');
  await client.login('a@ejemplo.test', 'PruebaSegura2026!');
  const access = require('../../mobile/src/offline/access').offlineAccess;
  const vault = require('../../mobile/src/offline/vault');
  const scope = access.current();
  await vault.storeActiveDek(scope, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  await expect(client.api('/reports/summary')).rejects.toThrow('Sesión revocada');
  expect(client.getAccessToken()).toBe('');
  expect(access.current()).toBeNull();
  await expect(vault.readActiveDek(scope)).rejects.toThrow(/bloqueado/);
});

test('logout revoca en su tienda de origen aunque se seleccione otra mientras borra las claves', async () => {
  global.fetch = jest.fn(async () => reply(session('a'))) as typeof fetch;
  const client = require('../../mobile/src/api') as typeof import('../../mobile/src/api');
  await client.selectTenant('tienda-a');
  await client.login('a@ejemplo.test', 'PruebaSegura2026!');
  let release!: () => void;
  const deletes = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockDelete.mockImplementation(async (key: string) => {
    await deletes;
    mockSecure.delete(key);
  });
  const logout = client.logout();
  const change = client.selectTenant('tienda-b');
  await Promise.resolve();
  release();
  await Promise.all([logout, change]);
  const call = (global.fetch as jest.Mock).mock.calls.find(([url]: [string]) =>
    url.endsWith('/logout'),
  );
  expect(call[1].headers['X-Tenant-Slug']).toBe('tienda-a');
  expect(JSON.parse(call[1].body).refreshToken).toBe('refresh-a');
  expect(client.getTenantSlug()).toBe('tienda-b');
});

test('una respuesta pendiente de la tienda anterior no se entrega a la nueva sesión', async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  global.fetch = jest.fn(async (url) =>
    String(url).endsWith('/profile') ? pending : reply(session('a')),
  ) as typeof fetch;
  const client = require('../../mobile/src/api') as typeof import('../../mobile/src/api');
  await client.selectTenant('tienda-a');
  await client.login('a@ejemplo.test', 'PruebaSegura2026!');
  const profile = client.api('/profile');
  await client.selectTenant('tienda-b');
  finish(reply({ nombre: 'Datos de A' }));
  await expect(profile).rejects.toThrow(/cambió/);
});

test('un login que termina después de cambiar de tienda no guarda sus tokens en la tienda nueva', async () => {
  let finish!: (value: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  ) as typeof fetch;
  const client = require('../../mobile/src/api') as typeof import('../../mobile/src/api');
  await client.selectTenant('tienda-a');
  const login = client.login('a@ejemplo.test', 'PruebaSegura2026!');
  await client.selectTenant('tienda-b');
  finish(reply(session('a')));
  await expect(login).rejects.toThrow(/cambió/);
  expect(mockSecure.get('vestidor18.tienda-b.access')).toBeUndefined();
});
