import 'dotenv/config';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
let f: Awaited<ReturnType<typeof commerceFixture>>;
beforeAll(async () => {
  f = await commerceFixture();
  await f.registry.pool.query(
    "UPDATE platform.subscription SET plan_code='negocio' WHERE tenant_id=$1",
    [f.tenant.id],
  );
});
afterAll(async () => {
  await f?.close();
});
const row = async (id: string) =>
  (await f.http('get', '/locations')).body.find((p: any) => p.id === id);
const create = (extra = {}) =>
  f.http('post', '/locations', {
    nombre: `Sucursal ${randomUUID()}`,
    tipo: 'TIENDA',
    responsableId: f.actorId,
    ...extra,
  });
const change = async (id: string, values: object) =>
  f.http('patch', `/locations/${id}`, { expectedVersion: (await row(id)).version, ...values });

test('responsable local, edición versionada, auditoría y jerarquía circular', async () => {
  const first = await create();
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ schemaVersion: '1.0', version: 1, responsable_id: f.actorId });
  expect((await create({ responsableId: randomUUID() })).status).toBe(400);
  const child = await create({ tipo: 'ALMACEN', padreId: first.body.id });
  expect(child.status).toBe(201);
  expect((await change(first.body.id, { padreId: child.body.id })).status).toBe(400);
  const edits = await Promise.all(
    ['Sucursal Rosa', 'Sucursal Violeta'].map((nombre) =>
      f.http('patch', `/locations/${child.body.id}`, { expectedVersion: 1, nombre }),
    ),
  );
  expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await change(first.body.id, { activa: false, motivo: 'Cierre por mudanza' })).status,
  ).toBe(409);
  expect(
    (await change(child.body.id, { activa: false, motivo: 'Cierre por mudanza' })).status,
  ).toBe(200);
  expect(
    (await change(first.body.id, { activa: false, motivo: 'Cierre por mudanza' })).status,
  ).toBe(200);
  expect((await change(child.body.id, { activa: true })).status).toBe(400);
  expect((await change(child.body.id, { activa: true, padreId: null })).status).toBe(200);
  expect(
    await f.inStore(() => f.db.auditoria.count({ where: { entidad_id: first.body.id } })),
  ).toBeGreaterThan(1);
});

test('stock o pedido pendiente impide cierre; historial finalizado no se pierde', async () => {
  const paid = await f.paidOrder(10);
  const result = await change(paid.locationId, { activa: false, motivo: 'Cierre por mudanza' });
  expect(result.status).toBe(409);
  expect(result.body.code).toBe('LOCATION_DEPENDENCIES');
  expect(result.body.details.orders).toBe(1);
  await f.inStore(() =>
    f.db.pedido.update({
      where: { id: paid.order.id },
      data: { estado: 'ENTREGADO', entregado_en: new Date() },
    }),
  );
  expect(
    (await change(paid.locationId, { activa: false, motivo: 'Cierre por mudanza' })).status,
  ).toBe(200);
  expect(
    await f.inStore(() => f.db.pedido.count({ where: { ubicacion_id: paid.locationId } })),
  ).toBe(1);
  const stocked = await f.item(1);
  expect(
    (await change(stocked.locationId, { activa: false, motivo: 'Cierre por mudanza' })).status,
  ).toBe(409);
});

test('responsable no se suspende ni pierde asignación antes de reasignar ubicación activa', async () => {
  const staff = await f.http('post', '/staff', {
    nombres: 'Ana',
    apellidos: 'Responsable',
    correo: `${randomUUID()}@qa.test`,
    clave: 'EquipoPrueba2026!',
    rol: 'Vendedor',
    ubicaciones: [],
  });
  expect(staff.status).toBe(201);
  const location = await create({ responsableId: staff.body.id });
  expect(location.status).toBe(201);
  const person = () =>
    f.http('get', '/staff').then((r) => r.body.find((p: any) => p.id === staff.body.id));
  let current = await person();
  expect(current.usuario_ubicacion.map((a: any) => a.ubicacion_id)).toContain(location.body.id);
  for (const update of [
    { estado: 'SUSPENDIDO', motivo: 'Finalizar contrato' },
    { ubicaciones: [] },
  ])
    expect(
      (
        await f.http('patch', `/staff/${staff.body.id}`, {
          expectedVersion: current.version,
          ...update,
        })
      ).status,
    ).toBe(409);
  expect((await change(location.body.id, { responsableId: f.actorId })).status).toBe(200);
  current = await person();
  expect(
    (
      await f.http('patch', `/staff/${staff.body.id}`, {
        expectedVersion: current.version,
        estado: 'SUSPENDIDO',
        motivo: 'Finalizar contrato',
      })
    ).status,
  ).toBe(200);
});

test('un pedido cerrado deja de bloquear cuando se resuelve su devolución', async () => {
  const paid = await f.paidOrder(10);
  await f.inStore(() =>
    f.db.pedido.update({ where: { id: paid.order.id }, data: { estado: 'CERRADO' } }),
  );
  const returned = await f.http('post', `/commerce/orders/${paid.order.id}/returns`, {
    reason: 'Revisión de la prenda comprada',
    items: [{ detailId: paid.detail.id, quantity: 1 }],
    idempotency: randomUUID(),
  });
  expect(returned.status).toBe(201);
  const blocked = await change(paid.locationId, {
    activa: false,
    motivo: 'Cierre definitivo de sucursal',
  });
  expect(blocked.status).toBe(409);
  expect(blocked.body.details.returns).toBe(1);
  await f.inStore(() =>
    f.db.devolucion.update({ where: { id: returned.body.id }, data: { estado: 'RECHAZADA' } }),
  );
  expect(
    (await change(paid.locationId, { activa: false, motivo: 'Cierre definitivo de sucursal' }))
      .status,
  ).toBe(200);
});
