import assert from 'node:assert/strict';
import test from 'node:test';
import { modulesForIdentity } from '../src/modules/registry';

test('el registro muestra solamente módulos permitidos para la tienda actual', () => {
  const modules = modulesForIdentity({
    id: 'user-001',
    nombres: 'Ana',
    apellidos: 'Luz',
    correo: 'ana@example.com',
    roles: ['Vendedor'],
    permissions: ['ventas:registrar'],
    tenant: { id: 'tenant-001', slug: 'lumina', name: 'Lúmina' },
  });
  assert.deepEqual(
    modules.map((module) => module.id),
    ['home', 'sales-orders'],
  );
});
