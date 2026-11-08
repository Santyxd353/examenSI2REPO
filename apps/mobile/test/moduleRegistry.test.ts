import assert from 'node:assert/strict';
import test from 'node:test';
import { canOpenSales, canOpenOrders } from '../src/modules/registry';

test('ventas y pedidos admite permisos independientes sin mostrar acciones no autorizadas', () => {
  const orderUser = { permissions: ['pedidos:gestionar'] } as any;
  const seller = { permissions: ['ventas:registrar'] } as any;
  assert.equal(canOpenOrders(orderUser), true);
  assert.equal(canOpenSales(orderUser), false);
  assert.equal(canOpenSales(seller), true);
  assert.equal(canOpenOrders(seller), false);
  assert.ok(modulesForIdentity(orderUser).some((row) => row.id === 'sales-orders'));
});
import {
  modulesForIdentity,
  canUseBusinessWorkspace,
  activeBusinessModule,
} from '../src/modules/registry';
import type { Identity } from '../src/types';

const identity = (permissions: string[]): Identity => ({
  id: 'one',
  nombres: 'Ana',
  apellidos: 'QA',
  correo: 'ana@qa.test',
  roles: ['Analista'],
  permissions,
  tenant: { id: 'tenant', slug: 'tienda', name: 'Tienda' },
});

test('vendedor y analista ingresan al espacio de trabajo según permisos; la clienta queda en el catálogo', () => {
  assert.equal(canUseBusinessWorkspace(identity(['ventas:registrar'])), true);
  assert.equal(canUseBusinessWorkspace(identity(['reportes:consultar'])), true);
  assert.equal(
    canUseBusinessWorkspace(identity(['catalogo:consultar', 'compras:realizar'])),
    false,
  );
});
test('Mi negocio requiere el permiso de suscripción y un módulo revocado vuelve al inicio', () => {
  assert.ok(
    modulesForIdentity(identity(['suscripcion:gestionar'])).some(
      (module) => module.id === 'business',
    ),
  );
  assert.ok(
    !modulesForIdentity(identity(['usuarios:gestionar'])).some(
      (module) => module.id === 'business',
    ),
  );
  assert.equal(activeBusinessModule(identity(['ventas:registrar']), 'analysis'), 'home');
  assert.equal(activeBusinessModule(identity(['reportes:consultar']), 'analysis'), 'analysis');
});

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
