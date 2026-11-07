import 'dotenv/config';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { CommerceController } from '../src/commerce';
import { OrdersController } from '../src/orders';

let f: Awaited<ReturnType<typeof commerceFixture>>;
beforeAll(async () => {
  f = await commerceFixture();
}, 60000);
afterAll(async () => f?.close(), 30000);
const body = (detailId: string, quantity: number) => ({
  reason: 'La talla no corresponde al pedido',
  items: [{ detailId, quantity }],
});
test('compra 3, solicita 3 y acepta 2: queda 1 elegible; solicitudes activas también reservan', async () => {
  const { order, detail } = await f.paidOrder();
  const first = await f.http('post', `/commerce/orders/${order.id}/returns`, body(detail.id, 3));
  expect(first.status).toBe(201);
  expect(
    (await f.http('post', `/commerce/orders/${order.id}/returns`, body(detail.id, 1))).status,
  ).toBe(400);
  const review = {
    decision: 'APROBAR',
    resolution: 'Se aceptan dos prendas de las tres',
    idempotency: randomUUID(),
    items: [{ returnDetailId: first.body.detalle_devolucion[0].id, acceptedQuantity: 2 }],
  };
  expect(
    (await f.http('patch', `/admin/orders/returns/${first.body.id}/review`, review)).status,
  ).toBe(200);
  const last = await f.http('post', `/commerce/orders/${order.id}/returns`, body(detail.id, 1));
  expect(last.status).toBe(201);
  expect(
    (await f.http('post', `/commerce/orders/${order.id}/returns`, body(detail.id, 1))).status,
  ).toBe(400);
});
test('solicitudes concurrentes sobre la misma línea no superan lo comprado', async () => {
  const { order, detail } = await f.paidOrder();
  const controller = f.app.get(CommerceController);
  const results = await f.inStore(() =>
    Promise.allSettled(
      [1, 2].map(() => controller.requestReturn(f.req(), order.id, body(detail.id, 2))),
    ),
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(
    (
      results.find((result) => result.status === 'rejected') as PromiseRejectedResult
    ).reason.getStatus(),
  ).toBe(400);
});
test('revisión concurrente/reintento reintegra y reembolsa una sola vez; cambio del UUID se rechaza', async () => {
  const { order, detail, inventoryId } = await f.paidOrder();
  const first = await f.http('post', `/commerce/orders/${order.id}/returns`, body(detail.id, 2));
  const review = {
    decision: 'APROBAR',
    resolution: 'Prendas verificadas en buen estado',
    idempotency: randomUUID(),
    items: [{ returnDetailId: first.body.detalle_devolucion[0].id, acceptedQuantity: 2 }],
  };
  const controller = f.app.get(OrdersController);
  const results = await f.inStore(() =>
    Promise.allSettled([
      controller.reviewReturn(f.req(), first.body.id, review),
      controller.reviewReturn(f.req(), first.body.id, review),
    ]),
  );
  expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  expect(
    (
      await f.http('patch', `/admin/orders/returns/${first.body.id}/review`, {
        ...review,
        items: [{ ...review.items[0], acceptedQuantity: 1 }],
      })
    ).status,
  ).toBe(409);
  expect(
    await f.inStore(() => f.db.reembolso.count({ where: { devolucion_id: first.body.id } })),
  ).toBe(1);
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: inventoryId } })))
      .fisico,
  ).toBe(9);
});
test('pago 150 con reembolso previo 50 permite como máximo 100 adicionales al cancelar', async () => {
  const { order } = await f.paidOrder();
  await f.inStore(() =>
    f.db.reembolso.create({
      data: {
        pago_id: order.pago[0].id,
        idempotencia: randomUUID(),
        monto: 50,
        estado: 'CONFIRMADO',
        motivo: 'Ajuste anterior registrado',
        creado_en: new Date(),
        confirmado_en: new Date(),
      },
    }),
  );
  const input = { reason: 'Cancelación acordada antes del despacho', idempotency: randomUUID() };
  const result = await f.http('patch', `/admin/orders/${order.id}/cancel`, input);
  expect(result.status).toBe(200);
  const refunds = await f.inStore(() =>
    f.db.reembolso.findMany({ where: { pago_id: order.pago[0].id, estado: 'CONFIRMADO' } }),
  );
  expect(refunds.reduce((sum, row) => sum + Number(row.monto), 0)).toBe(150);
  expect(refunds.find((row) => row.idempotencia === input.idempotency)?.monto.toString()).toBe(
    '100',
  );
});
test('solicitud de devolución con UUID conserva la respuesta tras perderla y rechaza cambios', async () => {
  const { order, detail } = await f.paidOrder();
  const input = { ...body(detail.id, 1), idempotency: randomUUID() };
  const results = await Promise.all([
    f.http('post', `/commerce/orders/${order.id}/returns`, input),
    f.http('post', `/commerce/orders/${order.id}/returns`, input),
  ]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(results[0].body.id).toBe(results[1].body.id);
  expect(
    (
      await f.http('post', `/commerce/orders/${order.id}/returns`, {
        ...input,
        items: [{ detailId: detail.id, quantity: 2 }],
      })
    ).status,
  ).toBe(409);
  expect(await f.inStore(() => f.db.devolucion.count({ where: { pedido_id: order.id } }))).toBe(1);
});
test('devolución total mantiene la venta bruta y su pedido en los registros del administrador', async () => {
  const { order, detail, locationId } = await f.paidOrder();
  const returned = await f.http('post', `/commerce/orders/${order.id}/returns`, body(detail.id, 3));
  expect(
    (
      await f.http('patch', `/admin/orders/returns/${returned.body.id}/review`, {
        decision: 'APROBAR',
        resolution: 'Se verifican las tres prendas devueltas',
        idempotency: randomUUID(),
        items: [{ returnDetailId: returned.body.detalle_devolucion[0].id, acceptedQuantity: 3 }],
      })
    ).status,
  ).toBe(200);
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const report = await f.http(
    'get',
    `/reports/summary?from=${from}&to=${to}&location=${locationId}`,
  );
  expect(report.status).toBe(200);
  expect(report.body.kpis).toMatchObject({ pedidos: 1, unidades: 3, ventas: 150 });
});
