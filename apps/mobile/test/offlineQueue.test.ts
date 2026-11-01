import assert from 'node:assert/strict';
import test from 'node:test';
import { IntentRepository, MemoryOfflineStore } from '../src/offline/intentRepository';

const scope = { tenantId: 'tenant-1', actorId: 'actor-1', deviceId: 'device-1' } as const;

test('enqueue inserta intención y proyección bajo una transacción', async () => {
  const store = new MemoryOfflineStore();
  const repository = new IntentRepository(store);
  await repository.enqueue(
    { operationId: 'op-1', scope, kind: 'STOCK_DELTA', payload: 'cipher', baseVersion: 4, dependsOn: [], state: 'PENDING' },
    { scope, entityId: 'variant-1', version: 4, payload: 'cipher-projection' },
  );
  assert.equal(store.intents(scope).length, 1);
  assert.equal(store.projections(scope).length, 1);
});

test('no mezcla ni expone datos de otro ámbito', async () => {
  const store = new MemoryOfflineStore();
  const repository = new IntentRepository(store);
  const other = { tenantId: 'tenant-2', actorId: 'actor-2', deviceId: 'device-1' } as const;
  await assert.rejects(
    repository.enqueue(
      { operationId: 'op-2', scope, kind: 'STOCK_DELTA', payload: 'cipher', baseVersion: 4, dependsOn: [], state: 'PENDING' },
      { scope: other, entityId: 'variant-1', version: 4, payload: 'cipher' },
    ),
  );
  assert.equal(store.intents(scope).length, 0);
  assert.equal(store.projections(other).length, 0);
});
