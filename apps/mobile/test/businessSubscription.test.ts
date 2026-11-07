import assert from 'node:assert/strict';
import test from 'node:test';
import { businessSubscriptionView } from '../src/modules/businessSubscription';
import { PLAN_CATALOG } from '@lumina/contracts';
test('Mi negocio muestra precios BOB, cuotas comprometidas y reservadas, y vencimiento real del plan', () => {
  const plan = PLAN_CATALOG.pro;
  const view = businessSubscriptionView({
    schemaVersion: '1.0',
    tenantId: '00000000-0000-4000-8000-000000000001',
    planCode: 'pro',
    status: 'EXPIRED',
    periodFrom: '2026-10-01T00:00:00Z',
    periodTo: '2026-11-01T00:00:00Z',
    readOnly: true,
    cancelAtPeriodEnd: false,
    currency: 'BOB',
    priceMinor: 29900,
    billingMode: null,
    limits: plan.limits,
    features: plan.features,
    usage: {
      locations: 2,
      products: 12,
      staff: 4,
      avatarsCommitted: 3,
      avatarsReserved: 1,
      savedReports: 2,
      aiCommitted: 5,
      aiReserved: 2,
    },
  });
  assert.equal(view.subscription.planName, 'Profesional');
  assert.equal(view.subscription.status, 'Vencido');
  assert.equal(view.usage.avatars, 4);
  assert.equal(view.usage.ai, 7);
  assert.equal(view.readOnly, true);
});
