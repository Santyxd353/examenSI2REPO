import assert from 'node:assert/strict';
import test from 'node:test';
import { availableStock, projectDelta, stockCountIntent } from '../src/modules/inventory/stockProjection';

const stock = { physical: 10, reserved: 2, committed: 1, version: 4 };
test('delta se aplica al físico y no reemplaza el saldo global', () => {
  assert.equal(projectDelta(stock, 3).physical, 13);
  assert.equal(availableStock(projectDelta(stock, 3)), 10);
});
test('bloquea ajustes con disponible negativo y conserva versión para conteo', () => {
  assert.throws(() => projectDelta(stock, -8));
  assert.deepEqual(stockCountIntent(stock, 9), { kind: 'STOCK_COUNT', baseVersion: 4, observedPhysical: 9 });
});
