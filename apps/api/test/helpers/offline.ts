import { createHash, randomUUID } from 'crypto';
import { canonicalIntentJson, UnsignedIntentSchema } from '@lumina/contracts';
import { commerceFixture } from './commerce';
export type Fixture = Awaited<ReturnType<typeof commerceFixture>>;
export function signedIntent(raw: unknown) {
  const { payloadHash: _ignored, ...unsigned } = raw as Record<string, unknown>;
  const value = UnsignedIntentSchema.parse(unsigned);
  return {
    ...value,
    payloadHash: createHash('sha256').update(canonicalIntentJson(value)).digest('hex'),
  };
}
export function stockIntent(
  f: Fixture,
  deviceId: string,
  item: { inventoryId: string; variantId: string; locationId: string },
  extra: object = {},
) {
  return signedIntent({
    schemaVersion: '1.0',
    tenantId: f.tenant.id,
    actorId: f.actorId,
    deviceId,
    operationId: randomUUID(),
    entityId: item.inventoryId,
    kind: 'STOCK_DELTA',
    baseVersion: 1,
    dependsOn: [],
    createdAt: new Date().toISOString(),
    payload: {
      variantId: item.variantId,
      locationId: item.locationId,
      deltaFisico: 2,
      reason: 'Ajuste offline QA',
    },
    ...extra,
  });
}
export const sendOffline = (f: Fixture, operations: unknown[]) =>
  f.http('post', '/offline/sync', { schemaVersion: '1.0', operations });
