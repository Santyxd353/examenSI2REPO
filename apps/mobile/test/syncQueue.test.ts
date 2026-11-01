import assert from 'node:assert/strict';
import test from 'node:test';
import { applySyncReceipt } from '../src/offline/syncReceipt';

const scope = { tenantId: 'tenant', actorId: 'actor', deviceId: 'device' } as const;
const row = (operationId: string, state: 'PENDING' | 'APPLIED' = 'PENDING') => ({
  operationId, scope, kind: 'STOCK_COUNT', payload: '{}', baseVersion: 1, dependsOn: [], state,
});

test('un recibo repetido no duplica el avance de la cola', () => {
  const first = applySyncReceipt([row('op')], { operationId: 'op', status: 'APPLIED', serverVersion: 2 });
  assert.deepEqual(applySyncReceipt(first, { operationId: 'op', status: 'APPLIED', serverVersion: 2 }), first);
});
