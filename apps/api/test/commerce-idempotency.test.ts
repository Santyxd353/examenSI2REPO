import 'dotenv/config';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { CommerceController } from '../src/commerce';
import { SalesController } from '../src/sales';
import { ProfileController } from '../src/profile';

let f: Awaited<ReturnType<typeof commerceFixture>>;
beforeAll(async () => {
  f = await commerceFixture();
}, 60000);
afterAll(async () => f?.close(), 30000);
test.each(['WEB', 'APP'])(
  '%s: respuesta perdida, UUID concurrente y payload alterado',
  async (channel) => {
    const { variantId, locationId, inventoryId } = await f.item();
    expect(
      (await f.http('post', '/commerce/cart/items', { variantId, quantity: 2 }, channel)).status,
    ).toBe(201);
    const input = { locationId, address: 'Calle de prueba 123, La Paz', idempotency: randomUUID() };
    const controller = f.app.get(CommerceController);
    const results = await f.inStore(() =>
      Promise.allSettled([
        controller.placeOrder(f.req(channel), input),
        controller.placeOrder(f.req(channel), input),
      ]),
    );
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const orders = results.map((result) => (result as PromiseFulfilledResult<any>).value);
    expect(orders[0].id).toBe(orders[1].id);
    expect((await f.http('post', '/commerce/checkout', input, channel)).body.id).toBe(orders[0].id);
    expect(
      (
        await f.http(
          'post',
          '/commerce/checkout',
          { ...input, address: 'Otra dirección diferente' },
          channel,
        )
      ).status,
    ).toBe(409);
    const row = await f.inStore(() =>
      f.db.inventario.findUniqueOrThrow({ where: { id: inventoryId } }),
    );
    expect(row.reservado).toBe(2);
    expect(
      await f.inStore(() =>
        f.db.movimiento_stock.count({ where: { pedido_id: orders[0].id, tipo: 'RESERVA' } }),
      ),
    ).toBe(1);
  },
);
test('última unidad compartida por WEB y APP no se reserva dos veces', async () => {
  const { variantId, locationId, inventoryId } = await f.item(1);
  for (const channel of ['WEB', 'APP'])
    expect(
      (await f.http('post', '/commerce/cart/items', { variantId, quantity: 1 }, channel)).status,
    ).toBe(201);
  const controller = f.app.get(CommerceController);
  const results = await f.inStore(() =>
    Promise.allSettled(
      ['WEB', 'APP'].map((channel) =>
        controller.placeOrder(f.req(channel), {
          locationId,
          address: 'Calle de prueba 123',
          idempotency: randomUUID(),
        }),
      ),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const failure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  expect(failure.reason.getStatus()).toBe(400);
  expect(
    await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: inventoryId } })),
  ).toMatchObject({ fisico: 1, reservado: 1, disponible: 0 });
  // Remove the cart left by the correctly rejected purchase for the following cases.
  await f.inStore(() => f.db.item_carrito.deleteMany({ where: { carrito: { estado: 'ACTIVO' } } }));
});
test('mostrador: UUID concurrente guarda venta/pago/salida una vez y rechaza contenido distinto', async () => {
  const { variantId, locationId, inventoryId } = await f.item();
  const input = {
    locationId,
    paymentMethod: 'EFECTIVO',
    idempotency: randomUUID(),
    items: [{ variantId, quantity: 2 }],
  };
  const controller = f.app.get(SalesController);
  const results = await f.inStore(() =>
    Promise.allSettled([controller.create(f.req(), input), controller.create(f.req(), input)]),
  );
  expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  const orders = results.map((result) => (result as PromiseFulfilledResult<any>).value);
  expect(orders[0].id).toBe(orders[1].id);
  expect(
    (await f.http('post', '/sales', { ...input, items: [{ variantId, quantity: 3 }] })).status,
  ).toBe(409);
  expect(await f.inStore(() => f.db.pago.count({ where: { pedido_id: orders[0].id } }))).toBe(1);
  expect(
    await f.inStore(() => f.db.movimiento_stock.count({ where: { pedido_id: orders[0].id } })),
  ).toBe(1);
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: inventoryId } })))
      .fisico,
  ).toBe(8);
});
test('pagar, preparar y despachar descuentan físico solo una vez', async () => {
  const { order, inventoryId } = await f.paidOrder(3, 'APP');
  for (const status of ['PREPARANDO', 'DESPACHADO']) {
    const response = await f.http('patch', `/admin/orders/${order.id}/status`, {
      status,
      reason: 'Procesamiento del pedido',
      ...(status === 'DESPACHADO' ? { tracking: 'QA-001' } : {}),
    });
    expect(response.status).toBe(200);
  }
  expect(
    await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: inventoryId } })),
  ).toMatchObject({ fisico: 7, reservado: 0 });
  expect(
    await f.inStore(() =>
      f.db.movimiento_stock.count({ where: { pedido_id: order.id, delta_fisico: { lt: 0 } } }),
    ),
  ).toBe(1);
});
test('pago concurrente con el mismo UUID devuelve la misma confirmación sin duplicar el evento', async () => {
  const { variantId, locationId } = await f.item();
  await f.http('post', '/commerce/cart/items', { variantId, quantity: 1 });
  const order = await f.http('post', '/commerce/checkout', {
    locationId,
    address: 'Dirección de prueba para pago',
    idempotency: randomUUID(),
  });
  expect(order.status).toBe(201);
  const input = { decision: 'APROBAR', idempotency: randomUUID() },
    controller = f.app.get(CommerceController);
  // Force both requests past the initial read before either commits. Real transactions still run.
  const original = (controller as any).closePending.bind(controller);
  let arrived = 0,
    release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const gate = jest
    .spyOn(controller as any, 'closePending')
    .mockImplementation(async (...args: any[]) => {
      if (args[2]?.id === input.idempotency) {
        if (++arrived === 2) release();
        await barrier;
      }
      return original(...args);
    });
  let results: PromiseSettledResult<any>[];
  try {
    results = await f.inStore(() =>
      Promise.allSettled([
        controller.pay(f.req(), order.body.id, input),
        controller.pay(f.req(), order.body.id, input),
      ]),
    );
  } finally {
    gate.mockRestore();
  }
  expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  expect(
    await f.inStore(() => f.db.evento_pago.count({ where: { evento_externo: input.idempotency } })),
  ).toBe(1);
  expect(
    (
      await f.http('post', `/commerce/orders/${order.body.id}/payment`, {
        ...input,
        decision: 'RECHAZAR',
      })
    ).status,
  ).toBe(400);
});
test('dos direcciones predeterminadas concurrentes dejan una; el pedido conserva su copia histórica', async () => {
  const controller = f.app.get(ProfileController);
  const data = {
    alias: 'Casa',
    destinatario: 'Cliente Prueba',
    telefono: '70000000',
    ciudad: 'La Paz',
    zona: 'Centro',
    detalle: 'Avenida del pedido 123',
    predeterminada: true,
  };
  const results = await f.inStore(() =>
    Promise.allSettled([
      controller.createAddress(f.req(), data),
      controller.createAddress(f.req(), { ...data, alias: 'Trabajo' }),
    ]),
  );
  expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  const addresses = await f.inStore(() =>
    f.db.direccion.findMany({ where: { usuario_id: f.actor.id, activa: true } }),
  );
  expect(addresses.filter((row) => row.predeterminada)).toHaveLength(1);
  const chosen = addresses.find((row) => row.predeterminada)!;
  const { variantId, locationId } = await f.item();
  expect((await f.http('post', '/commerce/cart/items', { variantId, quantity: 1 })).status).toBe(
    201,
  );
  const order = await f.http('post', '/commerce/checkout', {
    locationId,
    address: data.detalle,
    addressId: chosen.id,
    idempotency: randomUUID(),
  });
  expect(order.status).toBe(201);
  expect(
    (
      await f.http('patch', `/profile/addresses/${chosen.id}`, {
        detalle: 'Otra dirección actualizada 456',
      })
    ).status,
  ).toBe(200);
  expect(
    (await f.inStore(() => f.db.pedido.findUniqueOrThrow({ where: { id: order.body.id } })))
      .direccion_snapshot,
  ).toMatchObject({ detalle: data.detalle, direccionId: chosen.id });
});
test('barrido de reservas vencidas alcanza otra tienda y no depende del tráfico del cliente', async () => {
  const { variantId, locationId, inventoryId } = await f.item();
  await f.http('post', '/commerce/cart/items', { variantId, quantity: 1 });
  const order = await f.http('post', '/commerce/checkout', {
    locationId,
    address: 'Calle prueba reservas 123',
    idempotency: randomUUID(),
  });
  expect(order.status).toBe(201);
  await f.inStore(() =>
    f.db.reserva_stock.updateMany({
      where: { detalle_pedido: { pedido_id: order.body.id } },
      data: { creada_en: new Date(Date.now() - 120000), vence_en: new Date(Date.now() - 60000) },
    }),
  );
  await (f.app.get(CommerceController) as any).expireAcrossTenants();
  expect(
    (await f.inStore(() => f.db.pedido.findUniqueOrThrow({ where: { id: order.body.id } }))).estado,
  ).toBe('CANCELADO');
  expect(
    await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: inventoryId } })),
  ).toMatchObject({ fisico: 10, reservado: 0 });
});
