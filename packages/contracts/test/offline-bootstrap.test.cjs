const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../dist');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('bootstrap portable tipa identidad, DEK32bytes y plan; rechaza otra tienda', () => {
  const payload = {
    schemaVersion: '1.0',
    tenantId: uuid(1),
    actorId: uuid(2),
    deviceId: uuid(3),
    keyVersion: 1,
    keyBase64: Buffer.alloc(32).toString('base64'),
    permissions: ['inventario:gestionar'],
    locationIds: [uuid(4)],
    issuedAt: '2026-11-04T12:00:00.000Z',
    entitlements: {
      schemaVersion: '1.0',
      tenantId: uuid(1),
      planCode: 'esencial',
      status: 'TRIAL',
      periodFrom: '2026-11-01T04:00:00.000Z',
      periodTo: '2026-11-15T04:00:00.000Z',
      readOnly: false,
      cancelAtPeriodEnd: false,
      currency: 'BOB',
      priceMinor: 14900,
      billingMode: null,
      limits: c.PLAN_CATALOG.esencial.limits,
      features: c.PLAN_CATALOG.esencial.features,
      usage: {
        locations: 1,
        staff: 1,
        products: 0,
        avatarsCommitted: 0,
        avatarsReserved: 0,
        savedReports: 0,
        aiCommitted: 0,
        aiReserved: 0,
      },
    },
  };
  assert.equal(c.BootstrapResponseSchema.parse(payload).keyVersion, 1);
  assert.throws(() => c.BootstrapResponseSchema.parse({ ...payload, keyBase64: 'corta' }));
  assert.throws(() => c.BootstrapResponseSchema.parse({ ...payload, tenantId: uuid(9) }));
  assert.throws(() => c.BootstrapResponseSchema.parse({ ...payload, masterKey: 'no-debe-salir' }));
});
