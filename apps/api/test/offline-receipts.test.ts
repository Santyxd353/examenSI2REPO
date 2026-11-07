import 'dotenv/config';
import { randomBytes, randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { Fixture, signedIntent, stockIntent, sendOffline } from './helpers/offline';
let f: Fixture;
const deviceId = randomUUID();
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  f = await commerceFixture();
  expect((await f.http('post', '/offline/bootstrap', { deviceId })).status).toBe(201);
});
afterAll(async () => {
  await f?.close();
});
async function createIntent() {
  const category = await f.inStore(() =>
    f.db.categoria.create({ data: { nombre: randomUUID(), activa: true } }),
  );
  const productId = randomUUID();
  return signedIntent({
    schemaVersion: '1.0',
    tenantId: f.tenant.id,
    actorId: f.actorId,
    deviceId,
    operationId: randomUUID(),
    entityId: productId,
    kind: 'CATALOG_CREATE',
    baseVersion: null,
    dependsOn: [],
    createdAt: new Date().toISOString(),
    payload: {
      product: {
        id: productId,
        nombre: 'Vestido offline',
        descripcion: 'Prenda femenina de prueba',
        material: 'Algodón',
        marca: 'QA',
        categoriaId: category.id,
        variants: [
          {
            id: randomUUID(),
            sku: randomUUID(),
            talla: 'M',
            color: 'Negro',
            prices: { WEB: 5000, APP: 5000, TIENDA: 5000 },
          },
        ],
        resources: [],
      },
    },
  });
}
test('lote desordenado aplica alta, edición dependiente y archivo en transacciones separadas', async () => {
  const create = await createIntent();
  const update = signedIntent({
    ...create,
    operationId: randomUUID(),
    kind: 'CATALOG_UPDATE',
    dependsOn: [create.operationId],
    payload: { patch: { nombre: 'Vestido actualizado sin conexión' } },
  });
  const archive = signedIntent({
    ...create,
    operationId: randomUUID(),
    kind: 'CATALOG_ARCHIVE',
    baseVersion: 2,
    dependsOn: [update.operationId],
    payload: { reason: 'Archivo de prueba offline' },
  });
  const result = await sendOffline(f, [archive, update, create]);
  expect(result.status).toBe(201);
  expect(result.body.results.map((r: any) => r.receipt?.confirmedVersion)).toEqual([3, 2, 1]);
  expect(
    (await f.inStore(() => f.db.producto.findUniqueOrThrow({ where: { id: create.entityId } })))
      .estado,
  ).toBe('RETIRADO');
  expect(
    (await sendOffline(f, [create, update, archive])).body.results.map(
      (r: any) => r.receipt?.confirmedVersion,
    ),
  ).toEqual([1, 2, 3]);
});
test('edición dependiente no sustituye la versión del alta por la actual', async () => {
  const create = await createIntent();
  await sendOffline(f, [create]);
  await f.inStore(() =>
    f.db.producto.update({
      where: { id: create.entityId },
      data: { nombre: 'Cambio de otra administradora', version: { increment: 1 } },
    }),
  );
  const update = signedIntent({
    ...create,
    operationId: randomUUID(),
    kind: 'CATALOG_UPDATE',
    dependsOn: [create.operationId],
    payload: { patch: { nombre: 'Sobrescritura vieja' } },
  });
  const result = await sendOffline(f, [update]);
  expect(result.body.results[0].receipt.status).toBe('CONFLICT');
  expect(
    (await f.inStore(() => f.db.producto.findUniqueOrThrow({ where: { id: create.entityId } })))
      .nombre,
  ).toBe('Cambio de otra administradora');
});
test('rechazo posterior a escribir campos/variantes revierte dominio y persiste solo comprobante', async () => {
  const create = await createIntent();
  await sendOffline(f, [create]);
  const op = signedIntent({
    ...create,
    operationId: randomUUID(),
    kind: 'CATALOG_UPDATE',
    baseVersion: 1,
    payload: {
      patch: {
        nombre: 'Nombre inválido parcial',
        variants: [
          { ...(create as any).payload.product.variants[0], active: false, baseVersion: 1 },
        ],
        estado: 'PUBLICADO',
      },
    },
  });
  const response = await sendOffline(f, [op]);
  expect(response.body.results[0].receipt.status).toBe('REJECTED');
  const product = await f.inStore(() =>
    f.db.producto.findUniqueOrThrow({
      where: { id: create.entityId },
      include: { variante: true },
    }),
  );
  expect(product).toMatchObject({ nombre: 'Vestido offline', version: 1, estado: 'BORRADOR' });
  expect(product.variante[0].activa).toBe(true);
  expect(
    await f.inStore(() =>
      f.db.auditoria.count({ where: { accion: 'CATALOG_UPDATE', correlacion: op.operationId } }),
    ),
  ).toBe(0);
  expect((await sendOffline(f, [op])).body.results[0]).toEqual(response.body.results[0]);
});
test('nuevo saldo usa ID estable y stock insuficiente genera conflicto sin movimiento', async () => {
  const item = await f.item();
  await f.inStore(() => f.db.inventario.delete({ where: { id: item.inventoryId } }));
  const created = stockIntent(f, deviceId, item, { baseVersion: null });
  const res = await sendOffline(f, [created]);
  expect(res.body.results[0].receipt.status).toBe('APPLIED');
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })))
      .fisico,
  ).toBe(2);
  const negative = stockIntent(f, deviceId, item, {
    payload: {
      variantId: item.variantId,
      locationId: item.locationId,
      deltaFisico: -4,
      reason: 'Ajuste sin saldo',
    },
  });
  const failed = await sendOffline(f, [negative]);
  expect(failed.body.results[0].receipt.result.code).toBe('INSUFFICIENT_STOCK');
  expect(
    await f.inStore(() =>
      f.db.movimiento_stock.count({ where: { grupo_operacion: negative.operationId } }),
    ),
  ).toBe(0);
});

test('fallo técnico al guardar comprobante revierte stock y permite reintento con el mismo UUID', async () => {
  const item = await f.item(),
    op = stockIntent(f, deviceId, item);
  await f.inStore(async () => {
    await f.db.$executeRawUnsafe(
      "CREATE FUNCTION qa_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA receipt unavailable'; END $$",
    );
    await f.db.$executeRawUnsafe(
      'CREATE TRIGGER qa_fail_receipt BEFORE INSERT ON operacion_sincronizacion FOR EACH ROW EXECUTE FUNCTION qa_fail_receipt()',
    );
  });
  try {
    const response = await sendOffline(f, [op]);
    expect(response.body.results[0].blocked.code).toBe('SERVICE_UNAVAILABLE');
    expect(
      await f.inStore(() => f.db.operacion_sincronizacion.count({ where: { id: op.operationId } })),
    ).toBe(0);
    expect(
      await f.inStore(() =>
        f.db.movimiento_stock.count({ where: { grupo_operacion: op.operationId } }),
      ),
    ).toBe(0);
    expect(
      (
        await f.inStore(() =>
          f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
        )
      ).fisico,
    ).toBe(10);
  } finally {
    await f.inStore(() =>
      f.db.$executeRawUnsafe('DROP TRIGGER qa_fail_receipt ON operacion_sincronizacion'),
    );
    await f.inStore(() => f.db.$executeRawUnsafe('DROP FUNCTION qa_fail_receipt()'));
  }
  const success = await sendOffline(f, [op]);
  expect(success.body.results[0].receipt.status).toBe('APPLIED');
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })))
      .fisico,
  ).toBe(12);
});
