import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { prepareWireIntent, validateSyncResults } from '../src/offline/protocol';

const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() };
const operationId = randomUUID(),
  entityId = randomUUID(),
  variantId = randomUUID(),
  locationId = randomUUID();
const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
const draft = {
  operationId,
  scope,
  kind: 'STOCK_DELTA',
  entityId,
  createdAt: '2026-11-07T12:00:00Z',
  baseVersion: 1,
  dependsOn: [],
  state: 'PENDING' as const,
  payload: JSON.stringify({
    variantId,
    locationId,
    deltaFisico: 3,
    reason: 'Entrada de inventario',
  }),
};
test('una intención persistida conserva UUID, tiempo y hash al repetir el envío', async () => {
  const first = await prepareWireIntent(draft, digest);
  const again = await prepareWireIntent({ ...draft, payload: JSON.stringify(first) }, digest);
  assert.deepEqual(again, first);
  assert.equal(first.entityId, entityId);
  assert.equal(first.createdAt, draft.createdAt);
});
test('los recibos deben pertenecer a la misma cuenta, dispositivo e intención', async () => {
  const wire = await prepareWireIntent(draft, digest);
  const receipt = {
    operationId,
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    deviceId: scope.deviceId,
    entityId,
    payloadHash: wire.payloadHash,
    status: 'APPLIED',
    result: {},
    confirmedVersion: 2,
    committedAt: '2026-11-07T12:01:00Z',
    correlationId: operationId,
  };
  assert.equal(
    validateSyncResults({ results: [{ operationId, receipt }] }, [wire])[0].status,
    'APPLIED',
  );
  assert.throws(() =>
    validateSyncResults(
      { results: [{ operationId, receipt: { ...receipt, actorId: randomUUID() } }] },
      [wire],
    ),
  );
  assert.throws(() => validateSyncResults({ results: [] }, [wire]));
});
