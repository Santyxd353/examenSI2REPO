const mockSecure = new Map<string, string>();
const mockDelete = jest.fn(async (key: string) => {
  mockSecure.delete(key);
});
jest.mock(
  'expo-secure-store',
  () => ({
    getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) || null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      mockSecure.set(key, value);
    }),
    deleteItemAsync: (key: string) => mockDelete(key),
  }),
  { virtual: true },
);

const originalFetch = global.fetch;
const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
const session = (store: string) => ({
  accessToken: `access-${store}`,
  refreshToken: `refresh-${store}`,
  user: { tenant: { slug: store } },
});

beforeEach(() => {
  jest.resetModules();
  mockSecure.clear();
  mockDelete.mockImplementation(async (key: string) => {
    mockSecure.delete(key);
  });
  process.env.EXPO_PUBLIC_API_URL = 'http://invalid.test/api';
});
afterAll(() => {
  global.fetch = originalFetch;
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
