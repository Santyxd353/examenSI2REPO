import assert from 'node:assert/strict';
import test from 'node:test';
import { placeOrderAndRefresh } from '../src/checkoutFlow';

test('un fallo al actualizar el catálogo no deshace una compra creada', async () => {
  const result = await placeOrderAndRefresh(
    async () => ({ numero: 'APP-123' }),
    async () => {
      throw new Error('Sin conexión durante la actualización');
    },
  );
  assert.deepEqual(result, { order: { numero: 'APP-123' }, refreshFailed: true });
});

test('si crear el pedido falla, no se intenta actualizar el catálogo', async () => {
  let refreshed = false;
  await assert.rejects(
    placeOrderAndRefresh(
      async () => {
        throw new Error('Stock insuficiente');
      },
      async () => {
        refreshed = true;
      },
    ),
    /Stock insuficiente/,
  );
  assert.equal(refreshed, false);
});
