import 'dotenv/config';
import request from 'supertest';
import Stripe from 'stripe';
import { randomBytes, randomUUID } from 'crypto';
import { Client } from 'pg';
import { createApp } from '../src/app';
import { TenantRegistry } from '../src/tenancy/platform';
import { StripeAdapter } from '../src/billing/stripe.adapter';
import { PLAN_CATALOG } from '@lumina/contracts';

let app: Awaited<ReturnType<typeof createApp>>, registry: TenantRegistry;
const ids: string[] = [];
const secret = 'whsec_public_signup_test_only';
const oldKey = process.env.STRIPE_SECRET_KEY,
  oldSecret = process.env.STRIPE_WEBHOOK_SECRET;
const sdk = new Stripe('sk_test_fixture');
beforeAll(async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  app = await createApp();
  registry = app.get(TenantRegistry);
}, 60000);
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (app) {
    const databases = (
      await registry.pool.query(
        'SELECT database_name FROM platform.tenant WHERE id=ANY($1::uuid[])',
        [ids],
      )
    ).rows;
    await registry.pool.query('DELETE FROM platform.signup WHERE id=ANY($1::uuid[])', [ids]);
    await registry.pool.query(
      'DELETE FROM platform.billing_event WHERE tenant_id=ANY($1::uuid[])',
      [ids],
    );
    await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=ANY($1::uuid[])', [
      ids,
    ]);
    await registry.pool.query('DELETE FROM platform.tenant WHERE id=ANY($1::uuid[])', [ids]);
    await app.close();
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    for (const { database_name: name } of databases) {
      if (!/^store_[a-f0-9]{32}$/.test(name)) throw new Error('Unsafe QA database');
      await client.query(`DROP DATABASE "${name}"`);
    }
    await client.end();
  }
  if (oldKey) process.env.STRIPE_SECRET_KEY = oldKey;
  else delete process.env.STRIPE_SECRET_KEY;
  if (oldSecret) process.env.STRIPE_WEBHOOK_SECRET = oldSecret;
  else delete process.env.STRIPE_WEBHOOK_SECRET;
}, 60000);
function input(planCode = 'esencial', provider = 'QR_SIMULATED') {
  const operationId = randomUUID();
  ids.push(operationId);
  return {
    operationId,
    companyName: 'Colección QA',
    slug: 'signup-' + operationId.slice(0, 8),
    ownerEmail: operationId + '@qa.test',
    firstName: 'Ana',
    lastName: 'Prueba',
    password: 'PruebaExclusiva2026!',
    planCode,
    provider,
    billingInterval: 'MONTHLY',
    acceptTerms: true,
  };
}
const token = () => randomBytes(32).toString('hex');
const create = (body: object, key: string) =>
  request(app.getHttpServer()).post('/api/public/signup').set('X-Signup-Token', key).send(body);
const complete = (id: string, key: string, simulatedPayment = false) =>
  request(app.getHttpServer())
    .post(`/api/public/signup/${id}/complete`)
    .set('X-Signup-Token', key)
    .send({ simulatedPayment });

test('public DTO rejects forged prices, invalid capability and operator fields', async () => {
  const data = input();
  expect((await create({ ...data, amountMinor: 1 }, token())).status).toBe(400);
  expect((await create({ ...data, scope: 'PLATFORM_OPERATOR' }, token())).status).toBe(400);
  expect((await create(data, 'weak')).status).toBe(400);
  expect(
    (await registry.pool.query('SELECT 1 FROM platform.signup WHERE id=$1', [data.operationId]))
      .rowCount,
  ).toBe(0);
});
test('QR registration reserves only control data; completion is isolated and idempotent', async () => {
  const data = input(),
    key = token();
  const response = await create(data, key);
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    state: 'PENDING',
    amountMinor: 999,
    currency: 'USD',
    planCode: 'esencial',
  });
  expect(response.body.password_hash).toBeUndefined();
  expect(response.body.ownerEmail).toBeUndefined();
  expect(
    (await registry.pool.query('SELECT 1 FROM platform.tenant WHERE id=$1', [data.operationId]))
      .rowCount,
  ).toBe(0);
  expect((await create(data, key)).body.id).toBe(data.operationId);
  expect((await create({ ...data, companyName: 'Changed' }, key)).status).toBe(409);
  expect((await complete(data.operationId, token(), true)).status).toBe(404);
  expect((await complete(data.operationId, key)).body.state).toBe('PENDING');
  const paid = await complete(data.operationId, key, true);
  expect(paid.status).toBe(201);
  expect(paid.body.state).toBe('ACTIVE');
  const before = (
    await registry.pool.query('SELECT * FROM platform.subscription WHERE tenant_id=$1', [
      data.operationId,
    ])
  ).rows[0];
  expect(before).toMatchObject({
    status: 'ACTIVE',
    provider: 'QR_SIMULATED',
    plan_code: 'esencial',
  });
  expect((await complete(data.operationId, key, true)).body.state).toBe('ACTIVE');
  expect(
    (
      await registry.pool.query('SELECT version FROM platform.subscription WHERE tenant_id=$1', [
        data.operationId,
      ])
    ).rows[0].version,
  ).toBe(before.version);
  const login = await request(app.getHttpServer())
    .post('/api/auth/mobile/login')
    .set('X-Tenant-Slug', data.slug)
    .send({ correo: data.ownerEmail, clave: data.password });
  expect(login.status).toBe(201);
  expect(login.body.user.roles).toContain('Administrador');
  expect(login.body.user.nombres).toBe('Ana');
  expect(login.body.user.tenant.slug).toBe(data.slug);
  const other = await request(app.getHttpServer())
    .post('/api/auth/mobile/login')
    .set('X-Tenant-Slug', 'lumina')
    .send({ correo: data.ownerEmail, clave: data.password });
  expect(other.status).toBe(401);
  const storage = (
    await registry.pool.query('SELECT password_hash FROM platform.signup WHERE id=$1', [
      data.operationId,
    ])
  ).rows[0];
  expect(storage.password_hash).toBeNull();
}, 60000);
test('Demo provisions ten days without Stripe and prevents a second Demo for the same email', async () => {
  const data = input('demo'),
    key = token();
  const response = await create(data, key);
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({ state: 'ACTIVE', amountMinor: 0, provider: 'NONE' });
  const sub = (
    await registry.pool.query('SELECT * FROM platform.subscription WHERE tenant_id=$1', [
      data.operationId,
    ])
  ).rows[0];
  expect(sub.status).toBe('TRIALING');
  expect(sub.trial_ends_at.getTime() - Date.now()).toBeGreaterThan(9.99 * 86400000);
  expect(sub.trial_ends_at.getTime() - Date.now()).toBeLessThan(10.01 * 86400000);
  expect((await create({ ...input('demo'), ownerEmail: data.ownerEmail }, token())).status).toBe(
    409,
  );
}, 60000);
test('annual Stripe uses reference price; only a matching signed paid event provisions once', async () => {
  const data = { ...input('pro', 'STRIPE_TEST'), billingInterval: 'YEARLY' },
    key = token(),
    sessionId = 'cs_test_' + randomUUID();
  const adapter = app.get(StripeAdapter);
  const checkout = jest
    .spyOn(adapter, 'createSignupCheckout')
    .mockResolvedValue({ id: sessionId, url: 'https://checkout.stripe.com/c/pay/' + sessionId });
  const response = await create(data, key);
  expect(response.status).toBe(201);
  expect(response.body.amountMinor).toBe(19999);
  expect(checkout).toHaveBeenCalledWith(
    expect.objectContaining({ amountMinor: 19999, billingInterval: 'YEARLY' }),
  );
  const session = {
    id: sessionId,
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    livemode: false,
    currency: 'usd',
    amount_total: 19999,
    client_reference_id: data.operationId,
    metadata: { purpose: 'TENANT_SIGNUP', signupId: data.operationId },
  };
  const event = {
    id: 'evt_' + randomUUID(),
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: session },
  };
  async function send(value: unknown, signed = true) {
    const payload = JSON.stringify(value);
    return request(app.getHttpServer())
      .post('/api/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'Stripe-Signature',
        signed ? sdk.webhooks.generateTestHeaderString({ payload, secret }) : 'invalid',
      )
      .send(payload);
  }
  expect((await send(event, false)).status).toBe(400);
  expect((await send({ ...event, data: { object: { ...session, amount_total: 1 } } })).status).toBe(
    400,
  );
  expect(
    (await registry.pool.query('SELECT 1 FROM platform.tenant WHERE id=$1', [data.operationId]))
      .rowCount,
  ).toBe(0);
  expect((await send(event)).status).toBe(200);
  expect((await send(event)).status).toBe(200);
  const sub = (
    await registry.pool.query('SELECT * FROM platform.subscription WHERE tenant_id=$1', [
      data.operationId,
    ])
  ).rows[0];
  expect(sub.status).toBe('ACTIVE');
  expect(sub.provider).toBe('STRIPE');
  expect(sub.current_period_end.getTime() - sub.current_period_start.getTime()).toBeGreaterThan(
    364 * 86400000,
  );
  expect(
    (
      await registry.pool.query(
        "SELECT 1 FROM platform.billing_event WHERE tenant_id=$1 AND event_type='PUBLIC_SIGNUP'",
        [data.operationId],
      )
    ).rowCount,
  ).toBe(1);
}, 60000);
test('reference catalog preserves exact monetary amounts and Enterprise has no public checkout', () => {
  expect([
    PLAN_CATALOG.esencial.priceMinor,
    PLAN_CATALOG.esencial.yearlyPriceMinor,
    PLAN_CATALOG.pro.priceMinor,
    PLAN_CATALOG.pro.yearlyPriceMinor,
  ]).toEqual([999, 9999, 1999, 19999]);
  expect(PLAN_CATALOG.negocio.contactSales).toBe(true);
});
