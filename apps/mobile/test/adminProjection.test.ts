import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { projectAdminEntities } from '../src/offline/adminProjection';

test('proyecta stock pendiente sin duplicar recibos anteriores al corte ni aplicar conflictos', () => {
  const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() },
    id = randomUUID();
  const stock = {
    kind: 'STOCK' as const,
    id,
    version: 1,
    variantId: randomUUID(),
    locationId: randomUUID(),
    physical: 10,
    reserved: 1,
    committed: 0,
    available: 9,
  };
  const make = (
    delta: number,
    state: 'PENDING' | 'APPLIED' | 'CONFLICT',
    confirmedAt?: string,
  ) => ({
    operationId: randomUUID(),
    scope,
    kind: 'STOCK_DELTA',
    baseVersion: 1,
    dependsOn: [],
    state,
    confirmedAt,
    payload: JSON.stringify({
      kind: 'STOCK_DELTA',
      entityId: id,
      payload: {
        variantId: stock.variantId,
        locationId: stock.locationId,
        deltaFisico: delta,
        reason: 'QA',
      },
    }),
  });
  const rows = projectAdminEntities({ asOf: '2026-11-07T12:00:00Z', entities: [stock] } as any, [
    make(3, 'PENDING'),
    make(-2, 'APPLIED', '2026-11-07T11:00:00Z'),
    make(99, 'CONFLICT'),
  ]);
  assert.equal((rows[0] as typeof stock).physical, 13);
  assert.equal((rows[0] as typeof stock).available, 12);
});
