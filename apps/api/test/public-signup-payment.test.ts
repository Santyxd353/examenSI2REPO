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
  // Independent synthetic visitors; retain the real signup rate limiter.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
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
let visitor = 0;
const create = (body: object, key: string) =>
  request(app.getHttpServer())
    .post('/api/public/signup')
    .set('X-Forwarded-For', '192.0.2.' + ++visitor)
    .set('X-Signup-Token', key)
    .send(body);
const complete = (id: string, key: string, simulatedPayment = false) =>
  request(app.getHttpServer())
    .post(`/api/public/signup/${id}/complete`)
    .set('X-Signup-Token', key)
    .send({ simulatedPayment });

const change = (id: string, key: string, provider: string, extra = {}) =>
  request(app.getHttpServer())
    .post(`/api/public/signup/${id}/payment-method`)
    .set('X-Signup-Token', key)
    .send({ provider, ...extra });
const checkoutUrl = (id: string) => 'https://checkout.stripe.com/c/pay/' + id;
function stripeSession(data: ReturnType<typeof input>, id: string, patch = {}) {
  return {
    id,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    livemode: false,
    currency: 'usd',
    amount_total: 999,
    client_reference_id: data.operationId,
    metadata: { purpose: 'TENANT_SIGNUP', signupId: data.operationId },
    ...patch,
  } as unknown as Stripe.Response<Stripe.Checkout.Session>;
}
async function saved(id: string) {
  return (await registry.pool.query('SELECT * FROM platform.signup WHERE id=$1', [id])).rows[0];
}
function mockCreate(id: string) {
  return jest
    .spyOn(app.get(StripeAdapter), 'createSignupCheckout')
    .mockResolvedValue({ id, url: checkoutUrl(id) });
}

test('pending QR can change to Stripe without another signup and retries reuse its checkout', async () => {
  const data = input(),
    key = token(),
    id = 'cs_test_' + randomUUID();
  expect((await create(data, key)).status).toBe(201);
  const before = await saved(data.operationId);
  const prepare = mockCreate(id);
  jest.spyOn(app.get(StripeAdapter), 'retrieveCheckout').mockResolvedValue(stripeSession(data, id));
  const response = await change(data.operationId, key, 'STRIPE_TEST');
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    id: data.operationId,
    provider: 'STRIPE_TEST',
    state: 'PENDING',
    checkoutUrl: checkoutUrl(id),
    amountMinor: 999,
  });
  expect((await change(data.operationId, key, 'STRIPE_TEST')).status).toBe(201);
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(await saved(data.operationId)).toMatchObject({
    slug: before.slug,
    password_hash: before.password_hash,
    request_hash: before.request_hash,
    amount_minor: before.amount_minor,
    plan_code: before.plan_code,
    payment_attempt: 1,
  });
});

test('Stripe can change to QR, recover after reload and activate exactly one store', async () => {
  const data = input('esencial', 'STRIPE_TEST'),
    key = token(),
    id = 'cs_test_' + randomUUID();
  mockCreate(id);
  const adapter = app.get(StripeAdapter);
  jest.spyOn(adapter, 'retrieveCheckout').mockResolvedValue(stripeSession(data, id));
  const expire = jest
    .spyOn(adapter as any, 'expireCheckout')
    .mockResolvedValue(stripeSession(data, id, { status: 'expired' }));
  expect((await create(data, key)).status).toBe(201);
  const before = await saved(data.operationId);
  expect((await change(data.operationId, token(), 'QR_SIMULATED')).status).toBe(404);
  expect((await change(data.operationId, key, 'QR_SIMULATED', { amountMinor: 1 })).status).toBe(
    400,
  );
  expect((await change(data.operationId, key, 'NONE')).status).toBe(400);
  expect(expire).not.toHaveBeenCalled();
  const response = await change(data.operationId, key, 'QR_SIMULATED');
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    id: data.operationId,
    provider: 'QR_SIMULATED',
    state: 'PENDING',
    checkoutUrl: null,
  });
  expect(expire).toHaveBeenCalledWith(id);
  expect(await saved(data.operationId)).toMatchObject({
    company_name: before.company_name,
    slug: before.slug,
    owner_email: before.owner_email,
    password_hash: before.password_hash,
    request_hash: before.request_hash,
    plan_code: before.plan_code,
    amount_minor: before.amount_minor,
    billing_interval: before.billing_interval,
    expires_at: before.expires_at,
    session_id: null,
  });
  // A retry of the original request must recover the changed method.
  expect((await create(data, key)).body.provider).toBe('QR_SIMULATED');
  expect(expire).toHaveBeenCalledTimes(1);
  const qr = await request(app.getHttpServer())
    .post(`/api/public/signup/${data.operationId}/qr`)
    .set('X-Signup-Token', key)
    .send({});
  expect(qr.status).toBe(201);
  expect(qr.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  expect((await complete(data.operationId, key, true)).body.state).toBe('ACTIVE');
  expect((await change(data.operationId, key, 'STRIPE_TEST')).body).toMatchObject({
    state: 'ACTIVE',
    provider: 'QR_SIMULATED',
  });
  expect((await complete(data.operationId, key, true)).body.state).toBe('ACTIVE');
  const login = await request(app.getHttpServer())
    .post('/api/auth/mobile/login')
    .set('X-Tenant-Slug', data.slug)
    .send({ correo: data.ownerEmail, clave: data.password });
  expect(login.status).toBe(201);
  expect(login.body.user.tenant.slug).toBe(data.slug);
  expect(
    (
      await registry.pool.query(
        "SELECT count(*)::int AS count FROM platform.billing_event WHERE tenant_id=$1 AND event_type='PUBLIC_SIGNUP'",
        [data.operationId],
      )
    ).rows[0].count,
  ).toBe(1);
}, 60000);

test('round trips use fresh Stripe attempts and never expose an expired checkout', async () => {
  const data = input('esencial', 'STRIPE_TEST'),
    key = token();
  const adapter = app.get(StripeAdapter);
  const prepare = jest.spyOn(adapter, 'createSignupCheckout').mockImplementation(async (value) => {
    const id = 'cs_test_' + data.operationId + '_' + (value as any).paymentAttempt;
    return { id, url: checkoutUrl(id) };
  });
  jest.spyOn(adapter, 'retrieveCheckout').mockImplementation(async (id) => stripeSession(data, id));
  jest
    .spyOn(adapter as any, 'expireCheckout')
    .mockImplementation(async (...args: unknown[]) =>
      stripeSession(data, String(args[0]), { status: 'expired' }),
    );
  const first = await create(data, key);
  expect(first.status).toBe(201);
  expect((await change(data.operationId, key, 'QR_SIMULATED')).status).toBe(201);
  const second = await change(data.operationId, key, 'STRIPE_TEST');
  expect(second.status).toBe(201);
  expect(second.body.checkoutUrl).not.toBe(first.body.checkoutUrl);
  expect((await change(data.operationId, key, 'QR_SIMULATED')).status).toBe(201);
  const third = await change(data.operationId, key, 'STRIPE_TEST');
  expect(third.body.checkoutUrl).not.toBe(second.body.checkoutUrl);
  expect(prepare.mock.calls.map(([value]) => (value as any).paymentAttempt)).toEqual([0, 1, 2]);
});

test.each(['unavailable', 'processing', 'foreign-session'])(
  'does not enable QR if Stripe is %s',
  async (reason) => {
    const data = input('esencial', 'STRIPE_TEST'),
      key = token(),
      id = 'cs_test_' + randomUUID();
    mockCreate(id);
    expect((await create(data, key)).status).toBe(201);
    const before = await saved(data.operationId);
    const adapter = app.get(StripeAdapter);
    jest
      .spyOn(adapter, 'retrieveCheckout')
      .mockResolvedValue(
        stripeSession(
          data,
          id,
          reason === 'processing'
            ? { status: 'complete' }
            : reason === 'foreign-session'
              ? { client_reference_id: randomUUID() }
              : {},
        ),
      );
    jest.spyOn(adapter as any, 'expireCheckout').mockRejectedValue(new Error('Stripe unavailable'));
    const response = await change(data.operationId, key, 'QR_SIMULATED');
    expect(response.status).toBe(
      reason === 'unavailable' ? 503 : reason === 'processing' ? 409 : 400,
    );
    expect(await saved(data.operationId)).toMatchObject({
      state: 'PENDING',
      provider: 'STRIPE_TEST',
      session_id: before.session_id,
      checkout_url: before.checkout_url,
    });
  },
);

test.each([false, true])(
  'accepts a Stripe payment before/during expiration (%s) instead of enabling QR',
  async (during) => {
    const data = input('esencial', 'STRIPE_TEST'),
      key = token(),
      id = 'cs_test_' + randomUUID();
    mockCreate(id);
    const adapter = app.get(StripeAdapter),
      paid = stripeSession(data, id, { status: 'complete', payment_status: 'paid' });
    const retrieve = jest.spyOn(adapter, 'retrieveCheckout').mockResolvedValue(paid);
    if (during) retrieve.mockResolvedValueOnce(stripeSession(data, id));
    const expire = jest
      .spyOn(adapter as any, 'expireCheckout')
      .mockRejectedValue(new Error('Already complete'));
    expect((await create(data, key)).status).toBe(201);
    const response = await change(data.operationId, key, 'QR_SIMULATED');
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ state: 'ACTIVE', provider: 'STRIPE_TEST' });
    expect(expire).toHaveBeenCalledTimes(during ? 1 : 0);
    expect(
      (
        await registry.pool.query('SELECT provider FROM platform.subscription WHERE tenant_id=$1', [
          data.operationId,
        ])
      ).rows[0].provider,
    ).toBe('STRIPE');
  },
  60000,
);

test('recovers a lost Stripe creation reply before closing it and enabling QR', async () => {
  const data = input('esencial', 'STRIPE_TEST'),
    key = token(),
    id = 'cs_test_' + randomUUID();
  const prepare = mockCreate(id).mockRejectedValueOnce(new Error('Lost network reply'));
  const adapter = app.get(StripeAdapter);
  jest.spyOn(adapter, 'retrieveCheckout').mockResolvedValue(stripeSession(data, id));
  jest
    .spyOn(adapter as any, 'expireCheckout')
    .mockResolvedValue(stripeSession(data, id, { status: 'expired' }));
  expect((await create(data, key)).status).toBe(503);
  expect((await saved(data.operationId)).session_id).toBeNull();
  const response = await change(data.operationId, key, 'QR_SIMULATED');
  expect(response.status).toBe(201);
  expect(response.body.provider).toBe('QR_SIMULATED');
  expect(prepare.mock.calls.map(([value]) => (value as any).paymentAttempt)).toEqual([0, 0]);
});

test('an in-flight Stripe creation cannot race with QR confirmation', async () => {
  const data = input(),
    key = token(),
    id = 'cs_test_' + randomUUID();
  expect((await create(data, key)).status).toBe(201);
  let started!: () => void, release!: () => void;
  const creating = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.spyOn(app.get(StripeAdapter), 'createSignupCheckout').mockImplementation(async () => {
    started();
    await gate;
    return { id, url: checkoutUrl(id) };
  });
  jest.spyOn(app.get(StripeAdapter), 'retrieveCheckout').mockResolvedValue(stripeSession(data, id));
  const changing = change(data.operationId.toUpperCase(), key, 'STRIPE_TEST').then((r) => r);
  await creating;
  const confirming = complete(data.operationId, key, true).then((r) => r);
  release();
  const results = await Promise.all([changing, confirming]);
  for (const result of results)
    expect(result.body).toMatchObject({ state: 'PENDING', provider: 'STRIPE_TEST' });
  expect(
    (await registry.pool.query('SELECT 1 FROM platform.tenant WHERE id=$1', [data.operationId]))
      .rowCount,
  ).toBe(0);
});

test('expired registrations cannot change method or create another checkout', async () => {
  const data = input(),
    key = token();
  expect((await create(data, key)).status).toBe(201);
  await registry.pool.query(
    "UPDATE platform.signup SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [data.operationId],
  );
  const prepare = mockCreate('cs_test_unused');
  expect((await change(data.operationId, key, 'STRIPE_TEST')).status).toBe(409);
  expect(prepare).not.toHaveBeenCalled();
});

test('a lost expiration reply is reconciled before enabling QR', async () => {
  const data = input('esencial', 'STRIPE_TEST'),
    key = token(),
    id = 'cs_test_' + randomUUID();
  mockCreate(id);
  expect((await create(data, key)).status).toBe(201);
  const adapter = app.get(StripeAdapter);
  jest
    .spyOn(adapter, 'retrieveCheckout')
    .mockResolvedValueOnce(stripeSession(data, id))
    .mockResolvedValue(stripeSession(data, id, { status: 'expired' }));
  jest.spyOn(adapter, 'expireCheckout').mockRejectedValue(new Error('Lost expiration reply'));
  expect((await change(data.operationId, key, 'QR_SIMULATED')).body).toMatchObject({
    state: 'PENDING',
    provider: 'QR_SIMULATED',
  });
});

test('a signed paid webhook racing with a method change activates only the Stripe payment once', async () => {
  const data = input('esencial', 'STRIPE_TEST'),
    key = token(),
    id = 'cs_test_' + randomUUID();
  mockCreate(id);
  expect((await create(data, key)).status).toBe(201);
  const adapter = app.get(StripeAdapter);
  const paid = stripeSession(data, id, { status: 'complete', payment_status: 'paid' });
  jest
    .spyOn(adapter, 'retrieveCheckout')
    .mockResolvedValueOnce(stripeSession(data, id))
    .mockResolvedValue(paid);
  let started!: () => void, release!: () => void;
  const expiring = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.spyOn(adapter, 'expireCheckout').mockImplementation(async () => {
    started();
    await gate;
    throw new Error('Payment completed');
  });
  const event = {
    id: 'evt_' + randomUUID(),
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    data: { object: paid },
  };
  const payload = JSON.stringify(event);
  const webhook = () =>
    request(app.getHttpServer())
      .post('/api/billing/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sdk.webhooks.generateTestHeaderString({ payload, secret }))
      .send(payload);
  const changing = change(data.operationId, key, 'QR_SIMULATED').then((r) => r);
  await expiring;
  const notifying = webhook().then((r) => r);
  release();
  const responses = await Promise.all([changing, notifying]);
  // The global provisioning lock may ask one caller to retry while the other finishes.
  expect([201, 503]).toContain(responses[0].status);
  expect([200, 503]).toContain(responses[1].status);
  expect((await webhook()).status).toBe(200);
  expect(await saved(data.operationId)).toMatchObject({
    state: 'ACTIVE',
    provider: 'STRIPE_TEST',
    session_id: id,
  });
  expect(
    (
      await registry.pool.query(
        "SELECT count(*)::int AS count FROM platform.billing_event WHERE tenant_id=$1 AND event_type='PUBLIC_SIGNUP'",
        [data.operationId],
      )
    ).rows[0].count,
  ).toBe(1);
}, 60000);

test('a lost reply on QR to Stripe durably disables QR until the unknown checkout is closed', async () => {
  const data = input(),
    key = token(),
    id = 'cs_test_' + randomUUID();
  expect((await create(data, key)).status).toBe(201);
  const prepare = mockCreate(id).mockRejectedValueOnce(new Error('Lost creation reply'));
  const adapter = app.get(StripeAdapter);
  jest.spyOn(adapter, 'retrieveCheckout').mockResolvedValue(stripeSession(data, id));
  jest
    .spyOn(adapter, 'expireCheckout')
    .mockResolvedValue(stripeSession(data, id, { status: 'expired' }));
  expect((await change(data.operationId, key, 'STRIPE_TEST')).status).toBe(503);
  expect(await saved(data.operationId)).toMatchObject({
    state: 'PENDING',
    provider: 'STRIPE_TEST',
    payment_attempt: 1,
    session_id: null,
  });
  expect((await change(data.operationId, key, 'QR_SIMULATED')).body.provider).toBe('QR_SIMULATED');
  expect(prepare.mock.calls.map(([value]) => value.paymentAttempt)).toEqual([1, 1]);
  expect(
    (await registry.pool.query('SELECT 1 FROM platform.tenant WHERE id=$1', [data.operationId]))
      .rowCount,
  ).toBe(0);
});

test('a late QR registration keeps QR instead of requesting an invalid Stripe expiration', async () => {
  const data = input(),
    key = token();
  expect((await create(data, key)).status).toBe(201);
  await registry.pool.query(
    "UPDATE platform.signup SET expires_at=now()+interval '20 minutes' WHERE id=$1",
    [data.operationId],
  );
  const prepare = mockCreate('cs_test_unused');
  expect((await change(data.operationId, key, 'STRIPE_TEST')).status).toBe(409);
  expect(await saved(data.operationId)).toMatchObject({
    provider: 'QR_SIMULATED',
    payment_attempt: 0,
  });
  expect(prepare).not.toHaveBeenCalled();
});

test('the Stripe SDK receives the legacy idempotency key for existing drafts and distinct keys for new attempts', async () => {
  const adapter = new StripeAdapter();
  const prepare = jest
    .fn()
    .mockResolvedValue({ id: 'cs_test_sdk', url: checkoutUrl('cs_test_sdk'), livemode: false });
  jest
    .spyOn(adapter as any, 'client')
    .mockReturnValue({
      on: jest.fn(),
      off: jest.fn(),
      checkout: { sessions: { create: prepare } },
    });
  const data = {
    id: randomUUID(),
    companyName: 'QA',
    email: 'qa@example.test',
    planName: 'Esencial',
    amountMinor: 999,
    expiresAt: new Date(Date.now() + 3600000),
    billingInterval: 'MONTHLY' as const,
  };
  for (const paymentAttempt of [0, 1, 1, 2])
    await adapter.createSignupCheckout({ ...data, paymentAttempt });
  expect(prepare.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual([
    `lumina-signup-${data.id}`,
    `lumina-signup-${data.id}-payment-1`,
    `lumina-signup-${data.id}-payment-1`,
    `lumina-signup-${data.id}-payment-2`,
  ]);
  const [params] = prepare.mock.calls[0];
  expect(new URL(params.cancel_url).searchParams.get('alta')).toBe(data.id);
  expect(params.success_url).toBe(params.cancel_url);
  expect(params.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 999 });
});

function rejectingStripe(status: number, loseFirstReply = false) {
  let sent = 0;
  const send = jest.fn(async () => {
    if (loseFirstReply && sent++ === 0)
      throw Object.assign(new Error('Reply lost after remote processing'), { code: 'ECONNRESET' });
    return {
      getStatusCode: () => status,
      getHeaders: () => ({ 'request-id': 'req_qa', 'stripe-should-retry': 'false' }),
      getRawResponse: () => null,
      toStream: () => null,
      toJSON: async () => ({ error: { type: 'invalid_request_error', message: 'Rejected' } }),
    };
  });
  // Exercise the actual installed SDK, including its implicit ECONNRESET retry.
  const client = new Stripe('sk_test_fixture', {
    maxNetworkRetries: 0,
    httpClient: { getClientName: () => 'qa-http', makeRequest: send },
  });
  jest.spyOn(app.get(StripeAdapter) as any, 'client').mockReturnValue(client);
  return send;
}
test.each([401, 403, 400])(
  'a definitive first checkout rejection (%s) preserves a usable QR registration',
  async (status) => {
    const data = input(),
      key = token();
    expect((await create(data, key)).status).toBe(201);
    const before = await saved(data.operationId);
    const send = rejectingStripe(status);
    const response = await change(data.operationId, key, 'STRIPE_TEST');
    expect(response.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await saved(data.operationId)).toMatchObject({
      provider: 'QR_SIMULATED',
      state: 'PENDING',
      session_id: null,
      checkout_url: null,
      password_hash: before.password_hash,
      request_hash: before.request_hash,
    });
    expect(
      (
        await request(app.getHttpServer())
          .post(`/api/public/signup/${data.operationId}/qr`)
          .set('X-Signup-Token', key)
          .send({})
      ).status,
    ).toBe(201);
  },
);

test('a definitive rejection while recovering an unknown checkout must not re-enable QR', async () => {
  const data = input(),
    key = token();
  expect((await create(data, key)).status).toBe(201);
  const prepare = mockCreate('cs_test_unknown').mockRejectedValueOnce(new Error('Lost reply'));
  expect((await change(data.operationId, key, 'STRIPE_TEST')).status).toBe(503);
  prepare.mockRestore();
  rejectingStripe(401);
  expect((await change(data.operationId, key, 'QR_SIMULATED')).status).toBe(503);
  expect(await saved(data.operationId)).toMatchObject({
    provider: 'STRIPE_TEST',
    session_id: null,
    state: 'PENDING',
  });
});

test('an implicit SDK retry ending in 401 cannot make an unknown remote checkout QR-payable', async () => {
  const data = input(),
    key = token();
  expect((await create(data, key)).status).toBe(201);
  const send = rejectingStripe(401, true);
  expect((await change(data.operationId, key, 'STRIPE_TEST')).status).toBe(503);
  expect(send).toHaveBeenCalledTimes(2);
  expect(await saved(data.operationId)).toMatchObject({
    provider: 'STRIPE_TEST',
    session_id: null,
    state: 'PENDING',
  });
  expect((await change(data.operationId, key, 'QR_SIMULATED')).status).toBe(503);
  expect(await saved(data.operationId)).toMatchObject({ provider: 'STRIPE_TEST' });
});
