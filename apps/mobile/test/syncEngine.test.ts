import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { runSyncBatch } from '../src/offline/syncEngine';
import { prepareWireIntent } from '../src/offline/protocol';

const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() };
const item = () => ({
  operationId: randomUUID(),
  scope,
  kind: 'STOCK_DELTA',
  entityId: randomUUID(),
  createdAt: '2026-11-07T12:00:00Z',
  baseVersion: 1,
  dependsOn: [] as string[],
  state: 'PENDING' as const,
  payload: JSON.stringify({
    variantId: randomUUID(),
    locationId: randomUUID(),
    deltaFisico: 3,
    reason: 'Entrada registrada',
  }),
});
const receipt = (wire: any) => ({
  operationId: wire.operationId,
  receipt: {
    operationId: wire.operationId,
    ...scope,
    payloadHash: wire.payloadHash,
    status: 'APPLIED',
    result: { fisico: 13 },
    entityId: wire.entityId,
    confirmedVersion: 2,
    committedAt: '2026-11-07T12:01:00Z',
    correlationId: wire.operationId,
  },
});
test('la pérdida de respuesta conserva intención idéntica; un recibo ajeno nunca confirma la cola', async () => {
  const wire = await prepareWireIntent(item(), digest);
  let rows: any[] = [
    {
      ...item(),
      operationId: wire.operationId,
      entityId: wire.entityId,
      payload: JSON.stringify(wire),
    },
  ];
  let committed = 0;
  let requests: any[] = [];
  const repository = {
    listIntents: async () => rows,
    reconcile: async (_scope: any, next: any[]) => {
      rows = next;
      committed++;
    },
  };
  const send = async (body: any) => {
    requests.push(body);
    if (requests.length === 1) throw new Error('Conexión perdida');
    return { results: [receipt(body.operations[0])] };
  };
  await assert.rejects(runSyncBatch(repository, scope, { digest, send, guard: () => () => {} }));
  assert.equal(committed, 0);
  await runSyncBatch(repository, scope, { digest, send, guard: () => () => {} });
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].schemaVersion, '1.0');
  assert.equal(rows[0].state, 'APPLIED');
  assert.equal(committed, 1);
  rows = [{ ...rows[0], state: 'PENDING' }];
  await assert.rejects(
    runSyncBatch(repository, scope, {
      digest,
      guard: () => () => {},
      send: async (body: any) => ({
        results: [
          {
            ...receipt(body.operations[0]),
            receipt: { ...receipt(body.operations[0]).receipt, actorId: randomUUID() },
          },
        ],
      }),
    }),
  );
  assert.equal(committed, 1);
});
test('sincroniza operaciones independientes aunque otra esté bloqueada, y conserva bloqueos transitorios pendientes', async () => {
  const bad = { ...item(), state: 'CONFLICT' },
    child = { ...item(), dependsOn: [bad.operationId] },
    good = item();
  let persisted: any[] = [];
  const repository = {
    listIntents: async () => [child, bad, good] as any,
    reconcile: async (_scope: any, next: any[]) => {
      persisted = next;
    },
  };
  await runSyncBatch(repository, scope, {
    digest,
    guard: () => () => {},
    send: async (body: any) => {
      assert.deepEqual(
        body.operations.map((row: any) => row.operationId),
        [good.operationId],
      );
      return {
        results: [
          {
            operationId: good.operationId,
            blocked: {
              code: 'TEMPORARY',
              message: 'Intenta después',
              retryable: true,
              correlationId: good.operationId,
            },
          },
        ],
      };
    },
  });
  assert.equal(persisted.find((row) => row.operationId === child.operationId).state, 'BLOCKED');
  assert.equal(persisted.find((row) => row.operationId === good.operationId).state, 'PENDING');
});
