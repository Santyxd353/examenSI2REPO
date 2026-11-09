import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countFitsReserved,
  hasUnresolvedCount,
  parseStockCount,
} from '../src/offline/stockCountReview';
import type { OfflineIntent } from '../src/offline/intentRepository';

const scope = { tenantId: 'tenant', actorId: 'actor', deviceId: 'device' };
const payload = JSON.stringify({
  locationId: 'north',
  variantId: 'dress',
  observedPhysical: 3,
  reason: 'Conteo físico',
});
const intent = (state: OfflineIntent['state'], value = payload): OfflineIntent => ({
  operationId: 'op',
  scope,
  kind: 'STOCK_COUNT',
  payload: value,
  baseVersion: 1,
  dependsOn: [],
  state,
});

test('no reenvía un conteo pendiente para la misma variante y ubicación', () => {
  assert.equal(hasUnresolvedCount([intent('CONFLICT')], 'north', 'dress'), true);
  assert.equal(hasUnresolvedCount([intent('PENDING')], 'south', 'dress'), false);
  assert.equal(hasUnresolvedCount([intent('DISCARDED')], 'north', 'dress'), false);
  assert.equal(hasUnresolvedCount([intent('APPLIED')], 'north', 'dress'), false);
});

test('un conflicto corrupto o un conteo bajo reservas no se reintenta', () => {
  assert.equal(parseStockCount('{'), null);
  assert.equal(
    parseStockCount(
      JSON.stringify({
        locationId: 'north',
        variantId: 'dress',
        observedPhysical: -1,
        reason: 'test',
      }),
    ),
    null,
  );
  assert.equal(hasUnresolvedCount([intent('CONFLICT', '{')], 'north', 'dress'), false);
  assert.equal(countFitsReserved(3, 2, 2), false);
  assert.equal(countFitsReserved(4, 2, 2), true);
  assert.equal(countFitsReserved(4, -1, 2), false);
});

test('detecta un conteo canónico firmado y conserva la separación entre variantes', () => {
  const canonical = JSON.stringify({ kind: 'STOCK_COUNT', payload: JSON.parse(payload) });
  assert.equal(hasUnresolvedCount([intent('CONFLICT', canonical)], 'north', 'dress'), true);
  assert.equal(hasUnresolvedCount([intent('PENDING', canonical)], 'north', 'skirt'), false);
  assert.equal(parseStockCount(canonical)?.observedPhysical, 3);
});
