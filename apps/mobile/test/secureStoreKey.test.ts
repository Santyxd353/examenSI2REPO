import assert from 'node:assert/strict';
import test from 'node:test';
import { secureStoreKey } from '../src/auth/secureStoreKey';

test('convierte ámbitos con separadores en una clave compatible con SecureStore Android', () => {
  const key = secureStoreKey('lumina', 'offline', 'dek', 'tenant-01:user@example.com:device-01');
  assert.match(key, /^[A-Za-z0-9]+$/);
  assert.ok(key.length > 0);
});

test('mantiene separados tokens y datos de tiendas distintas', () => {
  const first = secureStoreKey('lumina', 'session', 'refresh', 'tienda-a');
  const second = secureStoreKey('lumina', 'session', 'refresh', 'tienda-b');
  const access = secureStoreKey('lumina', 'session', 'access', 'tienda-a');
  assert.notEqual(first, second);
  assert.notEqual(first, access);
});
