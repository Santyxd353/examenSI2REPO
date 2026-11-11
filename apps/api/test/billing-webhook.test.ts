import 'dotenv/config';
import request from 'supertest';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { billingFixture } from './helpers/billing';
import { StripeAdapter } from '../src/billing/stripe.adapter';

let f: Awaited<ReturnType<typeof billingFixture>>;
const secret = 'whsec_fixture_local_sin_cobros';
const sdk = new Stripe('sk_test_fixture');
const oldKey = process.env.STRIPE_SECRET_KEY,
  oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  f = await billingFixture();
}, 60000);
beforeEach(async () => f.reset());
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await f?.close();
  if (oldKey) process.env.STRIPE_SECRET_KEY = oldKey;
  else delete process.env.STRIPE_SECRET_KEY;
  if (oldSecret) process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
  else delete process.env.STRIPE_WEBHOOK_SECRET;
}, 30000);
async function prepare() {
  const sessionId = `cs_test_${randomUUID().replaceAll('-', '')}`;
  jest
    .spyOn(f.app.get(StripeAdapter), 'createCheckout')
    .mockResolvedValue({
      id: sessionId,
      url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      livemode: false,
    });
  const response = await request(f.app.getHttpServer())
    .post('/api/tenant/subscription/checkout')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' })
    .send({
      provider: 'STRIPE_TEST',
      planCode: 'pro',
      operationId: randomUUID(),
      acceptCycleTerms: true,
    });
  expect(response.status).toBe(201);
  return {
    id: `evt_${randomUUID()}`,
    object: 'event',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        status: 'complete',
        payment_status: 'paid',
        livemode: false,
        currency: 'usd',
        amount_total: 1999,
        client_reference_id: response.body.id,
        metadata: { intentId: response.body.id, tenantId: f.tenant.id },
      },
    },
  };
}
function deliver(event: object, signature?: string, body?: string) {
  const raw = body || JSON.stringify(event, null, 2);
  return request(f.app.getHttpServer())
    .post('/api/billing/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set(
      'Stripe-Signature',
      signature || sdk.webhooks.generateTestHeaderString({ payload: raw, secret }),
    )
    .send(raw);
}
test('firma bytes originales y sin cabecera tienda, con Lúmina suspendida; reenvío no renueva dos veces', async () => {
  const event = await prepare();
  await f.registry.pool.query("UPDATE platform.tenant SET state='SUSPENDED' WHERE slug='lumina'");
  try {
    const first = await deliver(event),
      second = await deliver(event);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.status).toBe('APPLIED');
    expect(second.body).toEqual(first.body);
    expect(
      (
        await f.registry.pool.query(
          'SELECT version FROM platform.subscription WHERE tenant_id=$1',
          [f.tenant.id],
        )
      ).rows[0].version,
    ).toBe(2);
  } finally {
    await f.registry.pool.query("UPDATE platform.tenant SET state='ACTIVE' WHERE slug='lumina'");
  }
});
test('firma inválida o reserialización, LIVE, moneda o importe erróneos no activan', async () => {
  const event = await prepare();
  const raw = JSON.stringify(event, null, 2),
    signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret });
  expect((await deliver(event, 't=1,v1=incorrecta')).status).toBe(400);
  expect((await deliver(event, signature, JSON.stringify(event))).status).toBe(400);
  expect((await deliver({ ...event, livemode: true })).status).toBe(400);
  expect(
    (await deliver({ ...event, data: { object: { ...event.data.object, currency: 'bob' } } }))
      .status,
  ).toBe(400);
  expect(
    (await deliver({ ...event, data: { object: { ...event.data.object, amount_total: 1 } } }))
      .status,
  ).toBe(400);
  expect(
    (
      await f.registry.pool.query('SELECT version FROM platform.subscription WHERE tenant_id=$1', [
        f.tenant.id,
      ])
    ).rows[0].version,
  ).toBe(1);
});
test('dos eventos concurrentes por una sesión aplican una vez; evento viejo no restaura versión anterior', async () => {
  const event = await prepare();
  const results = await Promise.all([
    deliver(event),
    deliver({ ...event, id: `evt_${randomUUID()}` }),
  ]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
  expect(
    (
      await f.registry.pool.query('SELECT version FROM platform.subscription WHERE tenant_id=$1', [
        f.tenant.id,
      ])
    ).rows[0].version,
  ).toBe(2);
  await f.reset();
  jest.restoreAllMocks();
  const old = await prepare();
  await f.registry.pool.query(
    'UPDATE platform.subscription SET version=version+1 WHERE tenant_id=$1',
    [f.tenant.id],
  );
  const stale = await deliver(old);
  expect(stale.status).toBe(200);
  expect(stale.body.status).toBe('STALE');
  expect(
    (
      await f.registry.pool.query(
        'SELECT plan_code FROM platform.subscription WHERE tenant_id=$1',
        [f.tenant.id],
      )
    ).rows[0].plan_code,
  ).toBe('esencial');
});
