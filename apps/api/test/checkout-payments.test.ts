import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { CommerceController } from '../src/commerce';
import { AuthService } from '../src/auth';
import { RealtimeGateway } from '../src/realtime';

let f: Awaited<ReturnType<typeof commerceFixture>>;
const sessions = new Map<string, any>(),
  keys = new Map<string, string>();
const create = jest.fn(async (input: any, options: any) => {
  const key = options?.idempotencyKey;
  if (!key) throw new Error('Falta idempotencia del proveedor');
  const prior = keys.get(key);
  if (prior) return sessions.get(prior);
  const id = 'cs_test_' + randomUUID().replaceAll('-', '');
  const session = {
    id,
    url: 'https://checkout.stripe.com/c/pay/' + id,
    livemode: false,
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    currency: 'bob',
    amount_total: input.line_items.reduce(
      (sum: number, line: any) => sum + line.quantity * line.price_data.unit_amount,
      0,
    ),
    metadata: input.metadata,
    client_reference_id: input.client_reference_id,
    expires_at: input.expires_at,
  };
  keys.set(key, id);
  sessions.set(id, session);
  return session;
});
const retrieve = jest.fn(async (id: string) => {
  const session = sessions.get(id);
  if (!session) throw new Error('Sesión inexistente');
  return session;
});
beforeAll(async () => {
  f = await commerceFixture();
  (f.app.get(CommerceController) as any).stripeClient = () => ({
    checkout: { sessions: { create, retrieve } },
  });
});
afterAll(async () => {
  await f?.close();
});

async function pending(channel = 'WEB') {
  const item = await f.item();
  expect(
    (
      await f.http(
        'post',
        '/commerce/cart/items',
        { variantId: item.variantId, quantity: 1 },
        channel,
      )
    ).status,
  ).toBe(201);
  const result = await f.http(
    'post',
    '/commerce/checkout',
    {
      locationId: item.locationId,
      address: 'Avenida de pruebas 123, La Paz',
      idempotency: randomUUID(),
    },
    channel,
  );
  expect(result.status).toBe(201);
  return { item, order: result.body };
}
const qrFor = (order: any) =>
  'LUMINA-PAY-DEMO:' + order.id + ':' + Number(order.total).toFixed(2) + ':BOB';
const scan = (order: any, idempotency: string, qr = qrFor(order)) =>
  f.http('post', '/commerce/demo-wallet/scan', { qr, idempotency }, 'APP');
const stripeStart = (id: string, channel = 'WEB') =>
  f.http('post', '/commerce/orders/' + id + '/stripe-test-checkout', {}, channel);
const stripeVerify = (id: string, channel = 'WEB') =>
  f.http('get', '/commerce/stripe-test-checkout?session_id=' + id, undefined, channel);

test('dos escaneos simultáneos del mismo QR producen una venta WEB y conservan un recibo', async () => {
  const { order, item } = await pending(),
    id = randomUUID();
  const results = await Promise.all([scan(order, id), scan(order, id)]);
  expect(results.map((row) => row.status)).toEqual([201, 201]);
  expect(results[0].body).toMatchObject({ estado: 'CONFIRMADO', canal: 'WEB' });
  await f.inStore(async () => {
    expect(
      await f.db.movimiento_stock.count({ where: { pedido_id: order.id, tipo: 'SALIDA' } }),
    ).toBe(1);
    expect(await f.db.evento_pago.count({ where: { pago_id: order.pago[0].id } })).toBe(1);
    expect(
      (await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })).fisico,
    ).toBe(9);
  });
  expect((await scan(order, randomUUID())).status).toBe(400);
});

test('QR rechaza monto cambiado, otra cuenta, tienda ajena, reserva vencida e identificador reutilizado', async () => {
  const { order } = await pending();
  expect((await scan(order, randomUUID(), qrFor(order).replace(':50.00:', ':0.01:'))).status).toBe(
    400,
  );
  const other = await f.inStore(() =>
    f.app.get(AuthService).mobileRegister({
      nombres: 'Otra',
      apellidos: 'Clienta',
      correo: randomUUID() + '@qa.test',
      clave: 'ClientaPrueba2026!',
    }),
  );
  expect(
    (
      await request(f.app.getHttpServer())
        .post('/api/commerce/demo-wallet/scan')
        .set('X-Tenant-Slug', f.tenant.slug)
        .auth(other.accessToken, { type: 'bearer' })
        .send({ qr: qrFor(order), idempotency: randomUUID() })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(f.app.getHttpServer())
        .post('/api/commerce/demo-wallet/scan')
        .set('X-Tenant-Slug', 'lumina')
        .auth(f.token, { type: 'bearer' })
        .send({ qr: qrFor(order), idempotency: randomUUID() })
    ).status,
  ).toBe(401);
  const id = randomUUID();
  expect((await scan(order, id)).status).toBe(201);
  const next = await pending();
  expect((await scan(next.order, id)).status).toBe(400);
  await f.inStore(() =>
    f.db.reserva_stock.updateMany({
      where: { detalle_pedido: { pedido_id: next.order.id } },
      data: {
        creada_en: new Date(Date.now() - 20 * 60_000),
        vence_en: new Date(Date.now() - 1000),
      },
    }),
  );
  expect((await scan(next.order, randomUUID())).status).toBe(400);
  expect(
    (await f.inStore(() => f.db.pedido.findUniqueOrThrow({ where: { id: next.order.id } }))).estado,
  ).toBe('CANCELADO');
});

test('Stripe TEST crea una sola sesión durable, conserva tienda y confirma exactamente una salida APP', async () => {
  const { order, item } = await pending('APP'),
    before = sessions.size;
  const starts = await Promise.all([stripeStart(order.id, 'APP'), stripeStart(order.id, 'APP')]);
  expect(starts.map((row) => row.status)).toEqual([201, 201]);
  expect(starts[0].body.sessionId).toBe(starts[1].body.sessionId);
  expect(sessions.size).toBe(before + 1);
  const session = sessions.get(starts[0].body.sessionId);
  expect(session.metadata).toMatchObject({
    tenantId: f.tenant.id,
    orderId: order.id,
    userId: f.actorId,
    channel: 'APP',
  });
  const params = create.mock.calls.find(([input]) => input.client_reference_id === order.id)![0];
  expect(params.success_url).toContain('tienda=' + f.tenant.slug);
  expect((await scan(order, randomUUID())).status).toBe(400);
  session.payment_status = 'paid';
  session.status = 'complete';
  const verified = await Promise.all([
    stripeVerify(session.id, 'APP'),
    stripeVerify(session.id, 'APP'),
  ]);
  expect(verified.map((row) => row.status)).toEqual([200, 200]);
  expect(verified[0].body).toMatchObject({ estado: 'CONFIRMADO', pagado: true });
  await f.inStore(async () => {
    expect(
      await f.db.movimiento_stock.count({ where: { pedido_id: order.id, tipo: 'SALIDA' } }),
    ).toBe(1);
    expect(
      (await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })).fisico,
    ).toBe(9);
    const event = await f.db.evento_pago.findFirstOrThrow({ where: { pago_id: order.pago[0].id } });
    expect(event.payload_resumen).toMatchObject({ simulacion: true, metodo: 'STRIPE_TEST' });
  });
});

test('Stripe rechaza moneda, monto, sesión, metadata y canal ajenos sin vender; recupera respuesta perdida', async () => {
  const { order } = await pending();
  const start = await stripeStart(order.id);
  expect(start.status).toBe(201);
  const session = sessions.get(start.body.sessionId),
    original = { ...session, metadata: { ...session.metadata } };
  session.payment_status = 'paid';
  session.status = 'complete';
  for (const patch of [
    { currency: 'usd' },
    { amount_total: 1 },
    { livemode: true },
    { metadata: { ...original.metadata, tenantId: randomUUID() } },
    { metadata: { ...original.metadata, userId: randomUUID() } },
  ]) {
    Object.assign(session, original, { payment_status: 'paid', status: 'complete' }, patch);
    expect((await stripeVerify(session.id)).status).toBe(400);
  }
  Object.assign(session, original, { payment_status: 'paid', status: 'complete' });
  expect((await stripeVerify(session.id, 'APP')).status).toBe(400);
  const result = await stripeVerify(session.id);
  expect(result.status).toBe(200);
  expect((await stripeVerify(session.id)).body).toEqual(result.body);
  expect(
    await f.inStore(() =>
      f.db.movimiento_stock.count({ where: { pedido_id: order.id, tipo: 'SALIDA' } }),
    ),
  ).toBe(1);
});

test('perder la respuesta del proveedor conserva intención y clave tras reiniciar el controlador', async () => {
  const { order } = await pending(),
    before = sessions.size;
  create.mockImplementationOnce(async (input: any, options: any) => {
    const id = 'cs_test_' + randomUUID().replaceAll('-', '');
    const value = {
      id,
      url: 'https://checkout.stripe.com/c/pay/' + id,
      livemode: false,
      mode: 'payment',
      status: 'open',
      payment_status: 'unpaid',
      currency: 'bob',
      amount_total: 50 * 100,
      client_reference_id: input.client_reference_id,
      metadata: input.metadata,
      expires_at: input.expires_at,
    };
    keys.set(options.idempotencyKey, id);
    sessions.set(id, value);
    throw new Error('Respuesta perdida después de crear la sesión de prueba');
  });
  expect((await stripeStart(order.id)).status).toBe(500);
  const saved = await f.inStore(() =>
    f.db.pago.findFirstOrThrow({ where: { pedido_id: order.id } }),
  );
  expect(saved.proveedor).toBe('STRIPE_TEST');
  expect(saved.referencia).toMatch(/^INIT:\d+$/);
  expect((await scan(order, randomUUID())).status).toBe(400);
  const restarted = new CommerceController(f.db, f.app.get(RealtimeGateway), f.registry);
  (restarted as any).stripeClient = () => ({ checkout: { sessions: { create, retrieve } } });
  const retry = await f.inStore(() => restarted.stripeTestCheckout(f.req(), order.id));
  expect(sessions.size).toBe(before + 1);
  expect(retry.sessionId).toBe(
    [...sessions.values()].find((row) => row.metadata.orderId === order.id).id,
  );
});
