import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';

let f: Awaited<ReturnType<typeof commerceFixture>>;
beforeAll(async () => {
  f = await commerceFixture();
}, 60000);
afterAll(async () => {
  await f?.close();
}, 60000);

async function checkout(channel = 'WEB') {
  const item = await f.item();
  await f.http('post', '/commerce/cart/items', { variantId: item.variantId, quantity: 1 }, channel);
  const order = await f.http(
    'post',
    '/commerce/checkout',
    {
      locationId: item.locationId,
      address: 'Calle de prueba 123, La Paz',
      idempotency: randomUUID(),
    },
    channel,
  );
  expect(order.status).toBe(201);
  return { item, order: order.body };
}
function anonymous(method: 'get' | 'post', token: string, slug = f.tenant.slug) {
  const call = request(f.app.getHttpServer())
    [method]('/api/payments/qr-demo' + (method === 'post' ? '/confirm' : ''))
    .set('X-Tenant-Slug', slug);
  return method === 'post' ? call.send({ token }) : call.set('X-QR-Token', token);
}
async function link(id: string, pos = false, channel = 'WEB') {
  const response = await f.http(
    'post',
    pos ? `/sales/${id}/qr-link` : `/commerce/orders/${id}/qr-link`,
    undefined,
    channel,
  );
  expect(response.status).toBe(201);
  const url = new URL(response.body.url);
  expect(url.searchParams.get('pago_qr')).toBe('1');
  expect(url.searchParams.get('tienda')).toBe(f.tenant.slug);
  expect(url.searchParams.has('token')).toBe(false);
  return new URLSearchParams(url.hash.slice(1)).get('token')!;
}

test.each(['WEB', 'APP'])(
  'el QR %s abre un enlace firmado; leerlo no paga y confirmar sin sesión descuenta una vez',
  async (channel) => {
    const { item, order } = await checkout(channel),
      token = await link(order.id, false, channel);
    const read = await anonymous('get', token);
    expect(read.status).toBe(200);
    expect(read.headers['cache-control']).toBe('no-store');
    expect(read.body).toMatchObject({
      orderNumber: order.numero,
      amount: '50.00',
      currency: 'BOB',
      paid: false,
      canPay: true,
    });
    expect(read.body).not.toHaveProperty('usuario_id');
    await f.inStore(async () => {
      expect(
        (await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })).fisico,
      ).toBe(10);
    });
    const responses = await Promise.all([anonymous('post', token), anonymous('post', token)]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(responses.every((r) => r.body.paid)).toBe(true);
    expect((await anonymous('post', token)).body.paid).toBe(true);
    await f.inStore(async () => {
      const inventory = await f.db.inventario.findUniqueOrThrow({
        where: { id: item.inventoryId },
      });
      expect(inventory).toMatchObject({ fisico: 9, reservado: 0 });
      expect(
        await f.db.movimiento_stock.count({ where: { pedido_id: order.id, tipo: 'SALIDA' } }),
      ).toBe(1);
      expect(await f.db.evento_pago.count({ where: { pago: { pedido_id: order.id } } })).toBe(1);
    });
  },
);

test('el QR no es una sesión, no admite falsificación ni otra tienda, y exige reserva vigente', async () => {
  const { order, item } = await checkout(),
    token = await link(order.id);
  const foreign = await anonymous('get', token, 'lumina');
  expect(foreign.status).toBe(401);
  const parts = token.split('.');
  parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1);
  expect((await anonymous('get', parts.join('.'))).status).toBe(401);
  expect(
    (
      await request(f.app.getHttpServer())
        .get('/api/commerce/orders')
        .set('X-Tenant-Slug', f.tenant.slug)
        .auth(token, { type: 'bearer' })
    ).status,
  ).toBe(401);
  await f.inStore(() =>
    f.db.reserva_stock.updateMany({
      where: { detalle_pedido: { pedido_id: order.id } },
      data: {
        creada_en: new Date(Date.now() - 20 * 60_000),
        vence_en: new Date(Date.now() - 1000),
      },
    }),
  );
  expect((await anonymous('get', token)).body.canPay).toBe(false);
  expect((await anonymous('post', token)).status).toBe(400);
  await f.inStore(async () =>
    expect(
      (await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })).fisico,
    ).toBe(10),
  );
});

test('POS admite efectivo o QR; tarjeta se rechaza y QR queda reservado hasta confirmar', async () => {
  const item = await f.item(),
    payload = {
      locationId: item.locationId,
      paymentMethod: 'QR',
      items: [{ variantId: item.variantId, quantity: 2 }],
      idempotency: randomUUID(),
    };
  const card = await f.http('post', '/sales', { ...payload, paymentMethod: 'TARJETA' });
  expect(card.status).toBe(400);
  const sale = await f.http('post', '/sales', payload);
  expect(sale.status).toBe(201);
  expect(sale.body.estado).toBe('PENDIENTE_PAGO');
  expect(sale.body.pago[0]).toMatchObject({ proveedor: 'POS_QR', estado: 'PENDIENTE' });
  expect((await f.http('post', '/sales', payload)).body.id).toBe(sale.body.id);
  await f.inStore(async () =>
    expect(
      await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
    ).toMatchObject({ fisico: 10, reservado: 2 }),
  );
  const token = await link(sale.body.id, true);
  expect((await anonymous('get', token)).body.amount).toBe('100.00');
  expect((await anonymous('post', token)).body.paid).toBe(true);
  expect((await anonymous('post', token)).body.paid).toBe(true);
  await f.inStore(async () => {
    expect(
      await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
    ).toMatchObject({ fisico: 8, reservado: 0 });
    expect(
      await f.db.movimiento_stock.count({ where: { pedido_id: sale.body.id, tipo: 'SALIDA' } }),
    ).toBe(1);
  });
  const cash = await f.http('post', '/sales', {
    ...payload,
    paymentMethod: 'EFECTIVO',
    idempotency: randomUUID(),
  });
  expect(cash.body).toMatchObject({
    estado: 'CONFIRMADO',
    pago: [expect.objectContaining({ proveedor: 'POS_EFECTIVO', estado: 'CONFIRMADO' })],
  });
});

test('una venta POS con QR vencido libera la reserva sin descontar existencias ni confirmar el pago', async () => {
  const item = await f.item();
  const sale = await f.http('post', '/sales', {
    locationId: item.locationId,
    paymentMethod: 'QR',
    items: [{ variantId: item.variantId, quantity: 1 }],
    idempotency: randomUUID(),
  });
  expect(sale.status).toBe(201);
  await f.inStore(() =>
    f.db.reserva_stock.updateMany({
      where: { detalle_pedido: { pedido_id: sale.body.id } },
      data: {
        creada_en: new Date(Date.now() - 20 * 60_000),
        vence_en: new Date(Date.now() - 1000),
      },
    }),
  );
  await f.http('get', '/commerce/orders');
  await f.inStore(async () => {
    expect(
      await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
    ).toMatchObject({ fisico: 10, reservado: 0 });
    expect((await f.db.pedido.findUniqueOrThrow({ where: { id: sale.body.id } })).estado).toBe(
      'CANCELADO',
    );
    expect(
      await f.db.movimiento_stock.count({ where: { pedido_id: sale.body.id, tipo: 'SALIDA' } }),
    ).toBe(0);
  });
});
