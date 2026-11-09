import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import Stripe from 'stripe';
import { TenantRegistry } from '../src/tenancy/platform';
import { PlanBilling } from '../src/tenancy/stripe-plans';

const tenant = randomUUID();
const slug = 'qa-' + tenant;
let pool: Pool;
let registry: TenantRegistry;
const plan = { code: 'negocio', currency: 'BOB', monthlyAmount: 599 };

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.PLATFORM_DATABASE_URL = url.href;
  registry = new TenantRegistry();
  await registry.initialize();
  pool = registry.pool;
  await pool.query(
    "INSERT INTO platform.tenant(id,slug,name,database_name,state) VALUES($1,$2,'QA',$3,'ACTIVE')",
    [tenant, slug, 'qa_' + tenant.replace(/-/g, '')],
  );
  await pool.query(
    "INSERT INTO platform.subscription(tenant_id,plan_code,status,provider) VALUES($1,'piloto','ACTIVE','NONE')",
    [tenant],
  );
});
afterAll(async () => {
  await pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [tenant]);
  await pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [tenant]);
  await pool.query('DELETE FROM platform.tenant WHERE id=$1', [tenant]);
  await registry.onModuleDestroy();
});

test('volver sin pagar conserva el plan, el pago se aplica una vez y cancelar conserva la fecha', async () => {
  const end = Math.floor(Date.now() / 1000) + 2592000;
  const sub = {
    id: 'sub_qa',
    status: 'active',
    items: { data: [{ current_period_end: end }] },
    cancel_at_period_end: false,
  };
  const session = {
    id: 'cs_test_' + tenant,
    livemode: false,
    mode: 'subscription',
    client_reference_id: tenant,
    url: 'https://checkout.stripe.com/test',
    metadata: { tenant, plan: plan.code },
    status: 'open',
    payment_status: 'unpaid',
    subscription: sub,
  };
  const stripe = {
    checkout: {
      sessions: { create: jest.fn(async () => session), retrieve: jest.fn(async () => session) },
    },
    subscriptions: {
      retrieve: jest.fn(async () => sub),
      update: jest.fn(async () => {
        sub.cancel_at_period_end = true;
        return sub;
      }),
    },
  };
  const billing = new PlanBilling(pool, () => stripe as unknown as Stripe);
  await billing.start(tenant, plan, randomUUID());
  expect(await billing.refresh(tenant)).toBe(true);
  expect((await registry.resolve(slug)).subscription?.plan).toBe('piloto');
  Object.assign(session, { status: 'complete', payment_status: 'paid' });
  await Promise.all([billing.refresh(tenant), billing.refresh(tenant)]);
  expect((await registry.resolve(slug)).subscription?.plan).toBe('negocio');
  expect(
    (await pool.query('SELECT id FROM platform.billing_event WHERE tenant_id=$1', [tenant]))
      .rowCount,
  ).toBe(1);
  await billing.cancel(tenant);
  expect(stripe.subscriptions.update).toHaveBeenCalledWith(sub.id, { cancel_at_period_end: true });
  expect((await registry.resolve(slug)).subscription).toMatchObject({
    status: 'ACTIVE',
    cancelAtEnd: true,
    periodEnd: new Date(end * 1000).toISOString(),
  });
});

(process.env.RUN_STRIPE_SANDBOX === '1' ? test : test.skip)(
  'Stripe sandbox abre Checkout y permite volver y descartarlo',
  async () => {
    const billing = new PlanBilling(pool);
    await pool.query(
      "UPDATE platform.subscription SET stripe_subscription_id=NULL,provider='NONE',plan_code='piloto' WHERE tenant_id=$1",
      [tenant],
    );
    const created = await billing.start(tenant, plan, randomUUID());
    try {
      expect(created.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      expect(await billing.refresh(tenant)).toBe(true);
      expect((await registry.resolve(slug)).subscription?.plan).toBe('piloto');
    } finally {
      await billing.discard(tenant);
    }
    expect(await billing.refresh(tenant)).toBe(false);
  },
  60000,
);
