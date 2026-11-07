import 'dotenv/config';
import { randomUUID } from 'crypto';
import { billingFixture } from './helpers/billing';
import { Db } from '../src/db';
import { AuthService, Identity } from '../src/auth';
import { runForTenant } from '../src/tenancy/context';
import request from 'supertest';

let f: Awaited<ReturnType<typeof billingFixture>>, db: Db, actor: Identity;
const originId = randomUUID(),
  targetId = randomUUID(),
  variantId = randomUUID();
const domain = () => require('../src/inventory/inventory.service');
const scope = () => ({ actor, operationId: randomUUID() });
const delta = (amount: number) => ({
  variantId,
  locationId: originId,
  deltaFisico: amount,
  reason: 'Reposición de prendas',
});
const transfer = {
  variantId,
  originId,
  targetId,
  quantity: 3,
  reason: 'Reposición entre sucursales',
};
const inStore = <T>(work: () => Promise<T>) => runForTenant(f.tenant, work);
beforeAll(async () => {
  f = await billingFixture();
  db = f.app.get(Db);
  actor = await inStore(() => f.app.get(AuthService).verify(f.token));
  await inStore(async () => {
    const category = await db.categoria.create({
      data: { nombre: 'Vestidos QA dominio', activa: true },
    });
    const product = await db.producto.create({
      data: {
        categoria_id: category.id,
        nombre: 'Vestido QA dominio',
        descripcion: 'Prenda femenina de prueba',
        material: 'Algodón',
        estado: 'PUBLICADO',
        creado_en: new Date(),
      },
    });
    await db.variante.create({
      data: {
        id: variantId,
        producto_id: product.id,
        sku: 'DOMINIO-VESTIDO-S',
        talla: 'S',
        color: 'Negro',
        activa: true,
      },
    });
    await db.ubicacion.createMany({
      data: [
        { id: originId, nombre: 'Origen QA', tipo: 'TIENDA', activa: true },
        { id: targetId, nombre: 'Destino QA', tipo: 'ALMACEN', activa: true },
      ],
    });
  });
}, 60000);
beforeEach(async () =>
  inStore(async () => {
    await db.movimiento_stock.deleteMany();
    await db.auditoria.deleteMany();
    await db.inventario.deleteMany();
    await db.inventario.createMany({
      data: [
        {
          variante_id: variantId,
          ubicacion_id: originId,
          fisico: 10,
          reservado: 2,
          comprometido: 1,
          version: 1,
        },
        {
          variante_id: variantId,
          ubicacion_id: targetId,
          fisico: 2,
          reservado: 0,
          comprometido: 0,
          version: 1,
        },
      ],
    });
  }),
);
afterAll(async () => f?.close(), 30000);
test('deltas concurrentes suman; conteo obsoleto y saldo menor que reservas se rechazan', async () => {
  await inStore(() =>
    Promise.all(
      [3, 4].map((amount) =>
        db.$transaction((tx) => domain().applyStockDelta(tx, scope(), delta(amount))),
      ),
    ),
  );
  const stock = await inStore(() =>
    db.inventario.findUniqueOrThrow({
      where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: originId } },
    }),
  );
  expect(stock.fisico).toBe(17);
  expect(stock.version).toBe(3);
  await expect(
    inStore(() =>
      db.$transaction((tx) =>
        domain().applyStockCount(tx, scope(), {
          variantId,
          locationId: originId,
          observedPhysical: 12,
          baseVersion: 1,
          reason: 'Conteo desactualizado',
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    inStore(() =>
      db.$transaction((tx) =>
        domain().applyStockCount(tx, scope(), {
          variantId,
          locationId: originId,
          observedPhysical: 2,
          baseVersion: 3,
          reason: 'Conteo menor a reservas',
        }),
      ),
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(await inStore(() => db.movimiento_stock.count())).toBe(2);
});
test('transferencia usa la transacción recibida: 10/2 a7/5 con dos movimientos y auditoría', async () => {
  const context = scope();
  const result: any = await inStore(() =>
    db.$transaction((tx) => domain().transferStock(tx, context, transfer)),
  );
  expect([result.origen.fisico, result.destino.fisico]).toEqual([7, 5]);
  expect(result.grupoOperacion).toBe(context.operationId);
  expect(
    await inStore(() =>
      db.movimiento_stock.count({ where: { grupo_operacion: context.operationId } }),
    ),
  ).toBe(2);
  expect(
    await inStore(() =>
      db.auditoria.count({ where: { correlacion: context.operationId, actor_id: actor.id } }),
    ),
  ).toBe(1);
});
test('fallo después de transferir revierte ambos saldos y sus movimientos', async () => {
  await expect(
    inStore(() =>
      db.$transaction(async (tx) => {
        await domain().transferStock(tx, scope(), transfer);
        throw new Error('rollback-confirm');
      }),
    ),
  ).rejects.toThrow('rollback-confirm');
  const rows = await inStore(() => db.inventario.findMany({ orderBy: { fisico: 'desc' } }));
  expect(rows.map((row) => row.fisico)).toEqual([10, 2]);
  expect(await inStore(() => db.movimiento_stock.count())).toBe(0);
});
test('servicio exige permisos y asignación para las dos ubicaciones', async () => {
  const seller = { ...actor, roles: ['Vendedor'], permissions: ['inventario:gestionar'] };
  await inStore(() =>
    db.usuario_ubicacion.upsert({
      where: { usuario_id_ubicacion_id: { usuario_id: actor.id, ubicacion_id: originId } },
      create: { usuario_id: actor.id, ubicacion_id: originId },
      update: {},
    }),
  );
  await expect(
    inStore(() =>
      db.$transaction((tx) =>
        domain().transferStock(tx, { actor: seller, operationId: randomUUID() }, transfer),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    inStore(() =>
      db.$transaction((tx) =>
        domain().applyStockDelta(
          tx,
          { actor: { ...actor, permissions: [] }, operationId: randomUUID() },
          delta(2),
        ),
      ),
    ),
  ).rejects.toMatchObject({ status: 403 });
});
test('transferencia online repetida conserva el comprobante y rechaza el mismo UUID con otro payload', async () => {
  const operationId = randomUUID(),
    deviceId = randomUUID();
  const payload = {
    origenId: originId,
    destinoId: targetId,
    varianteId: variantId,
    cantidad: 3,
    motivo: 'Reposición entre sucursales',
    operationId,
    deviceId,
  };
  const post = (body: object) =>
    request(f.app.getHttpServer())
      .post('/api/locations/transfers')
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(f.token, { type: 'bearer' })
      .send(body);
  const responses = await Promise.all([post(payload), post(payload)]);
  expect(responses.map((response) => response.status)).toEqual([201, 201]);
  expect(responses[0].body).toEqual(responses[1].body);
  expect([responses[0].body.origen.fisico, responses[0].body.destino.fisico]).toEqual([7, 5]);
  expect((await post({ ...payload, cantidad: 1 })).status).toBe(409);
  expect((await post({ ...payload, deviceId: randomUUID() })).status).toBe(409);
  expect(
    await inStore(() => db.movimiento_stock.count({ where: { grupo_operacion: operationId } })),
  ).toBe(2);
  expect(
    await inStore(() =>
      db.operacion_sincronizacion.findUniqueOrThrow({ where: { id: operationId } }),
    ),
  ).toMatchObject({ tipo: 'ONLINE_TRANSFER', estado_resultado: 'APPLIED', actor_id: actor.id });
});
