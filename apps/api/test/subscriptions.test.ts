import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { billingFixture } from './helpers/billing';
import { Db } from '../src/db';
import { runForTenant } from '../src/tenancy/context';

let f: Awaited<ReturnType<typeof billingFixture>>;
beforeAll(async () => {
  f = await billingFixture();
}, 60000);
beforeEach(async () => f.reset());
afterAll(async () => f?.close(), 30000);
const intent = (planCode = 'esencial', operationId = randomUUID()) => ({
  planCode,
  operationId,
  provider: 'QR_SIMULATED',
  acceptCycleTerms: true,
});
function post(path: string, body: object) {
  return request(f.app.getHttpServer())
    .post(`/api/tenant/subscription${path}`)
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' })
    .send(body);
}
function get(path: string) {
  return request(f.app.getHttpServer())
    .get(`/api/tenant/subscription${path}`)
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' });
}
test('QR explícitamente simulado: importe del servidor, replay y confirmación concurrente una sola vez', async () => {
  const input = intent(),
    first = await post('/checkout', input);
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    provider: 'QR_SIMULATED',
    amountMinor: 14900,
    currency: 'BOB',
    status: 'PENDING',
    simulated: true,
  });
  expect(first.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  expect((await post('/checkout', input)).body.id).toBe(first.body.id);
  expect((await post('/checkout', { ...input, planCode: 'pro' })).status).toBe(409);
  const responses = await Promise.all([
    post(`/qr/${first.body.id}/confirm`, { simulatedPayment: true }),
    post(`/qr/${first.body.id}/confirm`, { simulatedPayment: true }),
  ]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  expect(responses[0].body.result).toEqual(responses[1].body.result);
  expect((await get(`/checkouts/${first.body.id}`)).body.status).toBe('APPLIED');
  const sub = (
    await f.registry.pool.query('SELECT * FROM platform.subscription WHERE tenant_id=$1', [
      f.tenant.id,
    ])
  ).rows[0];
  expect(sub.version).toBe(2);
  expect(sub.status).toBe('ACTIVE');
});
test('renovación anticipada extiende pago y conserva comienzo/ancla mensual; cancelación preserva acceso', async () => {
  const start = new Date();
  start.setUTCDate(1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 2);
  await f.registry.pool.query(
    `UPDATE platform.subscription SET status='ACTIVE',current_period_start=$2,current_period_end=$3,trial_ends_at=NULL WHERE tenant_id=$1`,
    [f.tenant.id, start, end],
  );
  const periodBefore = (await get('')).body;
  const pending = await post('/checkout', intent());
  expect(pending.status).toBe(201);
  expect(pending.body.cycleAction).toBe('RENEW');
  const paid = await post(`/qr/${pending.body.id}/confirm`, { simulatedPayment: true });
  expect(paid.status).toBe(201);
  expect(paid.body.result.periodFrom).toBe(start.toISOString());
  expect(new Date(paid.body.result.paidThrough).getTime()).toBeGreaterThan(end.getTime());
  const periodAfter = (await get('')).body;
  expect([periodAfter.periodFrom, periodAfter.periodTo]).toEqual([
    periodBefore.periodFrom,
    periodBefore.periodTo,
  ]);
  const operationId = randomUUID(),
    cancel = await post('/cancel-renewal', { operationId });
  expect(cancel.status).toBe(201);
  expect(cancel.body.cancelAtPeriodEnd).toBe(true);
  expect((await post('/cancel-renewal', { operationId })).body).toEqual(cancel.body);
  expect((await get('')).body).toMatchObject({ readOnly: false, cancelAtPeriodEnd: true });
});
test('cambio a Profesional inicia ciclo completo y rechazo de downgrade no borra ubicaciones', async () => {
  const pending = await post('/checkout', intent('pro'));
  const paid = await post(`/qr/${pending.body.id}/confirm`, { simulatedPayment: true });
  expect(paid.status).toBe(201);
  expect(paid.body.amountMinor).toBe(29900);
  expect((await get('')).body.limits.aiPerPeriod).toBe(100);
  await f.registry.pool.query(
    `UPDATE platform.subscription SET plan_code='negocio' WHERE tenant_id=$1`,
    [f.tenant.id],
  );
  const db = f.app.get(Db);
  const additions = Array.from({ length: 5 }, (_, i) => ({
    id: randomUUID(),
    nombre: `Sucursal ${i}`,
    tipo: 'TIENDA',
    activa: true,
  }));
  await runForTenant(f.tenant, () => db.ubicacion.createMany({ data: additions }));
  try {
    expect((await post('/checkout', intent('pro'))).status).toBe(409);
    expect(
      await runForTenant(f.tenant, () => db.ubicacion.count({ where: { activa: true } })),
    ).toBe(6);
  } finally {
    await runForTenant(f.tenant, () =>
      db.ubicacion.deleteMany({ where: { id: { in: additions.map((row) => row.id) } } }),
    );
  }
});
test('intento vencido o de otra tienda no confirma; vigencia expirada permite renovación', async () => {
  const pending = await post('/checkout', intent());
  expect(pending.status).toBe(201);
  await f.registry.pool.query(
    `UPDATE platform.billing_event SET contexto=jsonb_set(contexto,'{expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) WHERE id=$1`,
    [pending.body.id],
  );
  expect((await post(`/qr/${pending.body.id}/confirm`, { simulatedPayment: true })).status).toBe(
    409,
  );
  expect((await post(`/qr/${randomUUID()}/confirm`, { simulatedPayment: true })).status).toBe(404);
  await f.registry.pool.query(
    `UPDATE platform.subscription SET status='ACTIVE',current_period_start=now()-interval '2 months',current_period_end=now()-interval '1 month' WHERE tenant_id=$1`,
    [f.tenant.id],
  );
  const renewed = await post('/checkout', intent());
  expect(renewed.status).toBe(201);
  expect((await post(`/qr/${renewed.body.id}/confirm`, { simulatedPayment: true })).status).toBe(
    201,
  );
  expect((await get('')).body.readOnly).toBe(false);
});
test('Stripe sin credencial TEST no crea falsa aprobación; exige consentimiento de ciclo', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    expect((await post('/checkout', { ...intent(), provider: 'STRIPE_TEST' })).status).toBe(503);
  } finally {
    if (saved) process.env.STRIPE_SECRET_KEY = saved;
  }
  expect((await post('/checkout', { ...intent(), acceptCycleTerms: false })).status).toBe(400);
});
test('un identificador QR inválido devuelve validación sin bloquear otra escritura', async () => {
  const response = await post('/qr/no-es-uuid/confirm', { simulatedPayment: true });
  expect(response.status).toBe(400);
});
test('la cancelación repetida con UUID en mayúsculas conserva una sola versión', async () => {
  const operationId = randomUUID();
  expect((await post('/cancel-renewal', { operationId })).status).toBe(201);
  expect((await post('/cancel-renewal', { operationId: operationId.toUpperCase() })).status).toBe(
    201,
  );
  expect(
    (
      await f.registry.pool.query('SELECT version FROM platform.subscription WHERE tenant_id=$1', [
        f.tenant.id,
      ])
    ).rows[0].version,
  ).toBe(2);
});
test('la confirmación simulada y cancelación conservan la identidad autorizada en su auditoría', async () => {
  const pending = await post('/checkout', intent());
  expect((await post(`/qr/${pending.body.id}/confirm`, { simulatedPayment: true })).status).toBe(
    201,
  );
  const qr = (
    await f.registry.pool.query('SELECT contexto FROM platform.billing_event WHERE id=$1', [
      pending.body.id,
    ])
  ).rows[0];
  expect(qr.contexto.confirmedBy).toBe(f.actorId);
  const operationId = randomUUID();
  await post('/cancel-renewal', { operationId });
  const canceled = (
    await f.registry.pool.query(
      "SELECT contexto FROM platform.billing_event WHERE tenant_id=$1 AND event_type='CANCEL_RENEWAL'",
      [f.tenant.id],
    )
  ).rows[0];
  expect(canceled.contexto.actorId).toBe(f.actorId);
});
