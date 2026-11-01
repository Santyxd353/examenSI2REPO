import assert from 'node:assert/strict';
import test from 'node:test';
import { canRestoreOfflineIdentity, createOfflineIdentity } from '../src/auth/offlineIdentity';
import { createSessionScope } from '../src/auth/sessionScope';

const identity = {
  id: 'user-001',
  nombres: 'Juana',
  apellidos: 'Vega',
  correo: 'juana@example.com',
  roles: ['Administrador'],
  permissions: ['inventario:consultar'],
  tenant: { id: 'tenant-001', slug: 'lumina', name: 'Lúmina' },
};

test('una identidad offline solo se restaura en su propia tienda', () => {
  const session = createSessionScope('lumina');
  const record = createOfflineIdentity(identity, session.capture());
  assert.equal(canRestoreOfflineIdentity(record, session.capture()), true);
  session.switchTenant('otra-tienda');
  assert.equal(canRestoreOfflineIdentity(record, session.capture()), false);
});
