import assert from 'node:assert/strict';
import test from 'node:test';
import { blockDependents, orderedPending, readyPending } from '../src/offline/dependencyGraph';
import { applySyncReceipt } from '../src/offline/syncReceipt';

const scope = { tenantId: 'tenant', actorId: 'actor', deviceId: 'device' } as const;
const intent = (operationId: string, dependsOn: string[] = []) => ({ operationId, scope, kind: 'CATALOG_CREATE', payload: '{}', baseVersion: null, dependsOn, state: 'PENDING' as const });

test('ordena padre antes de hija y bloquea hija ante conflicto', () => {
  const parent = intent('parent');
  const child = intent('child', ['parent']);
  assert.deepEqual(orderedPending([child, parent]).map((item) => item.operationId), ['parent', 'child']);
  assert.equal(blockDependents([parent, child], 'parent')[1]?.state, 'BLOCKED');
});

test('envía una edición dependiente solo después de aplicar su alta', () => {
  const parent = intent('parent');
  const child = { ...intent('child', ['parent']), kind: 'CATALOG_UPDATE' };
  assert.deepEqual(readyPending([child, parent]).map((item) => item.operationId), ['parent']);
  assert.deepEqual(
    readyPending([child, { ...parent, state: 'APPLIED' as const }]).map((item) => item.operationId),
    ['child'],
  );
});

test('rechaza ciclos de dependencias', () => {
  assert.throws(() => orderedPending([intent('a', ['b']), intent('b', ['a'])]), /ciclo/);
});

test('no programa una hija mientras la dependencia se está enviando', () => {
  const sending = { ...intent('parent'), state: 'SENDING' as const };
  assert.throws(() => orderedPending([intent('child', ['parent']), sending]), /sincronizando/);
});

test('aplica recibos idempotentes y bloquea descendientes cuando hay conflicto', () => {
  const parent = intent('parent');
  const child = intent('child', ['parent']);
  const conflicted = applySyncReceipt([parent, child], { operationId: 'parent', status: 'CONFLICT' });
  assert.deepEqual(conflicted.map((item) => item.state), ['CONFLICT', 'BLOCKED']);
  const applied = applySyncReceipt([parent], { operationId: 'parent', status: 'APPLIED' });
  assert.deepEqual(applySyncReceipt(applied, { operationId: 'parent', status: 'APPLIED' }), applied);
});

test('un rechazo del servidor no aparece como conflicto reintentable', () => {
  const result = applySyncReceipt([intent('parent'), intent('child', ['parent'])], {
    operationId: 'parent', status: 'REJECTED', message: 'Sin permiso',
  });
  assert.deepEqual(result.map((item) => item.state), ['REJECTED', 'BLOCKED']);
});
