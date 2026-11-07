import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { canonicalIntentJson, UnsignedIntentSchema } from '@lumina/contracts';
import { commerceFixture } from './helpers/commerce';
import request from 'supertest';
import { AuthService } from '../src/auth';
let f: Awaited<ReturnType<typeof commerceFixture>>;
const deviceId = randomUUID();
function sign(raw: unknown) {
  const { payloadHash: _ignored, ...unsigned } = raw as Record<string, unknown>;
  const value = UnsignedIntentSchema.parse(unsigned);
  return {
    ...value,
    payloadHash: createHash('sha256').update(canonicalIntentJson(value)).digest('hex'),
  };
}
function intent(
  item: { inventoryId: string; variantId: string; locationId: string },
  delta = 3,
  extra = {},
) {
  return sign({
    schemaVersion: '1.0',
    operationId: randomUUID(),
    tenantId: f.tenant.id,
    actorId: f.actorId,
    deviceId,
    kind: 'STOCK_DELTA',
    entityId: item.inventoryId,
    baseVersion: 1,
    dependsOn: [],
    createdAt: new Date().toISOString(),
    payload: {
      variantId: item.variantId,
      locationId: item.locationId,
      deltaFisico: delta,
      reason: 'Ajuste offline de prueba',
    },
    ...extra,
  });
}
const send = (operations: unknown[]) =>
  f.http('post', '/offline/sync', { schemaVersion: '1.0', operations });
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  f = await commerceFixture();
});
afterAll(async () => {
  await f?.close();
});
test('bootstrap autenticado recupera la misma clave, aislada por dispositivo y sin token push', async () => {
  const first = await f.http('post', '/offline/bootstrap', { deviceId });
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    schemaVersion: '1.0',
    tenantId: f.tenant.id,
    actorId: f.actorId,
    deviceId,
    keyVersion: 1,
  });
  expect(Buffer.from(first.body.keyBase64, 'base64')).toHaveLength(32);
  const again = await f.http('post', '/offline/bootstrap', { deviceId });
  expect(again.body.keyBase64).toBe(first.body.keyBase64);
  expect(
    (await f.http('post', '/offline/bootstrap', { deviceId: randomUUID() })).body.keyBase64,
  ).not.toBe(first.body.keyBase64);
  const rows = await f.inStore(() =>
    f.db.configuracion.findMany({ where: { clave: { startsWith: 'offline-device:' } } }),
  );
  expect(rows).toHaveLength(2);
  expect(JSON.stringify(rows)).not.toContain(first.body.keyBase64);
  expect(await f.inStore(() => f.db.dispositivo.count())).toBe(0);
});
test('respuesta perdida y doble envío simultáneo recuperan el mismo recibo con un solo movimiento', async () => {
  const item = await f.item(),
    op = intent(item);
  const results = await Promise.all([send([op]), send([op])]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(results[0].body.results[0].receipt.status).toBe('APPLIED');
  expect(results[1].body).toEqual(results[0].body);
  expect((await send([op])).body).toEqual(results[0].body);
  const receipt = await f.http('get', `/offline/operations/${op.operationId}?deviceId=${deviceId}`);
  expect(receipt.body).toEqual(results[0].body.results[0].receipt);
  expect(
    await f.inStore(() =>
      f.db.movimiento_stock.count({ where: { grupo_operacion: op.operationId } }),
    ),
  ).toBe(1);
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })))
      .fisico,
  ).toBe(13);
});
test('dos deltas compatibles suman; conteo de versión vieja conserva conflicto sin pisar saldo', async () => {
  const item = await f.item();
  const plus = intent(item, 3),
    minus = intent(item, -2);
  const count = intent(item, 3, {
    kind: 'STOCK_COUNT',
    payload: {
      variantId: item.variantId,
      locationId: item.locationId,
      observedPhysical: 99,
      reason: 'Conteo desactualizado',
    },
  });
  const res = await send([plus, minus, count]);
  expect(res.status).toBe(201);
  expect(res.body.results.map((r: any) => r.receipt?.status)).toEqual([
    'APPLIED',
    'APPLIED',
    'CONFLICT',
  ]);
  expect(res.body.results[2].receipt.result.code).toBe('VERSION_CONFLICT');
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })))
      .fisico,
  ).toBe(11);
  expect((await send([count])).body.results[0]).toEqual(res.body.results[2]);
});
test('UUID con contenido cambiado o identidad ajena no modifica el comprobante original', async () => {
  const item = await f.item(),
    op = intent(item);
  await send([op]);
  const changed = intent(item, 5, { operationId: op.operationId, createdAt: op.createdAt });
  const res = await send([changed]);
  expect(res.status).toBe(409);
  expect(res.body.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  expect(
    (await f.http('get', `/offline/operations/${op.operationId}?deviceId=${randomUUID()}`)).status,
  ).toBe(404);
  expect((await send([intent(item, 1, { actorId: randomUUID() })])).status).toBe(403);
  expect((await send([intent(item, 1, { tenantId: randomUUID() })])).status).toBe(403);
});

test('dos sesiones y dispositivos contra la misma API suman deltas concurrentes sin reemplazar saldo', async () => {
  const device2 = randomUUID(),
    item = await f.item();
  const login = await f.inStore(() =>
    f.app.get(AuthService).mobileLogin({ correo: f.actor.correo, clave: 'BillingPrueba2026!' }),
  );
  const client2 = (path: string, body: unknown) =>
    request(f.app.getHttpServer())
      .post('/api' + path)
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(login.accessToken, { type: 'bearer' })
      .send(body as object);
  expect((await client2('/offline/bootstrap', { deviceId: device2 })).status).toBe(201);
  const first = intent(item, 3),
    second = intent(item, -2, { deviceId: device2 });
  const responses = await Promise.all([
    send([first]),
    client2('/offline/sync', { schemaVersion: '1.0', operations: [second] }),
  ]);
  expect(responses.map((r) => r.body.results[0].receipt?.status)).toEqual(['APPLIED', 'APPLIED']);
  expect(
    (await f.inStore(() => f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })))
      .fisico,
  ).toBe(11);
});
test('hash alterado, tipo no permitido y dependencias cíclicas se rechazan antes de aplicar', async () => {
  const item = await f.item(),
    op = intent(item),
    second = intent(item);
  expect((await send([{ ...op, payloadHash: '0'.repeat(64) }])).status).toBe(400);
  expect((await send([{ ...op, kind: 'SALE' }])).status).toBe(400);
  expect(
    (
      await send([
        sign({ ...op, payloadHash: undefined, dependsOn: [second.operationId] }),
        sign({ ...second, payloadHash: undefined, dependsOn: [op.operationId] }),
      ])
    ).status,
  ).toBe(400);
  expect(
    await f.inStore(() =>
      f.db.movimiento_stock.count({ where: { grupo_operacion: op.operationId } }),
    ),
  ).toBe(0);
});
test('dependencia desconocida bloquea sin recibo definitivo; agotamiento de plan permite recuperar aplicado', async () => {
  const item = await f.item(),
    accepted = intent(item);
  const first = await send([accepted]);
  const pending = intent(item, 2, { dependsOn: [randomUUID()] });
  const blocked = await send([pending]);
  expect(blocked.body.results[0].blocked.code).toBe('DEPENDENCY_BLOCKED');
  expect(
    await f.inStore(() =>
      f.db.operacion_sincronizacion.count({ where: { id: pending.operationId } }),
    ),
  ).toBe(0);
  await f.registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [f.tenant.id],
  );
  const replay = await send([accepted, intent(item)]);
  expect(replay.status).toBe(201);
  expect(replay.body.results[0]).toEqual(first.body.results[0]);
  expect(replay.body.results[1].blocked.code).toBe('SUBSCRIPTION_REQUIRED');
  expect((await f.http('post', '/offline/bootstrap', { deviceId })).status).toBe(201);
  await f.reset();
});
