import 'dotenv/config';
import request from 'supertest';
import { randomBytes, randomUUID } from 'crypto';
import { AuthService } from '../src/auth';
import { commerceFixture } from './helpers/commerce';
import { Fixture, stockIntent, sendOffline } from './helpers/offline';
let a: Fixture, b: Fixture;
const deviceId = randomUUID();
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  a = await commerceFixture();
  b = await commerceFixture();
});
afterAll(async () => {
  await a?.close();
  await b?.close();
});
test('misma instalación en otra tienda recibe DEK distinta; token ajeno no consulta bootstrap ni recibos', async () => {
  const first = await a.http('post', '/offline/bootstrap', { deviceId }),
    second = await b.http('post', '/offline/bootstrap', { deviceId });
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(first.body.keyBase64).not.toBe(second.body.keyBase64);
  for (const path of ['/offline/bootstrap', '/offline/sync']) {
    const call = await request(b.app.getHttpServer())
      .post('/api' + path)
      .set('X-Tenant-Slug', b.tenant.slug)
      .auth(a.token, { type: 'bearer' })
      .send({ deviceId });
    expect(call.status).toBe(401);
  }
  const op = stockIntent(a, deviceId, await a.item());
  await sendOffline(a, [op]);
  expect(
    (await b.http('get', `/offline/operations/${op.operationId}?deviceId=${deviceId}`)).status,
  ).toBe(404);
  expect((await sendOffline(b, [op])).status).toBe(403);
});
test('otro actor no recupera la DEK ni el comprobante del propietario', async () => {
  const own = await a.http('post', '/offline/bootstrap', { deviceId });
  const other = await a.inStore(() =>
    a.app
      .get(AuthService)
      .mobileRegister({
        nombres: 'Otra',
        apellidos: 'Clienta',
        correo: `${randomUUID()}@qa.test`,
        clave: 'ClientaOffline2026!',
      }),
  );
  const op = stockIntent(a, deviceId, await a.item());
  await sendOffline(a, [op]);
  const bootstrap = await request(a.app.getHttpServer())
    .post('/api/offline/bootstrap')
    .set('X-Tenant-Slug', a.tenant.slug)
    .auth(other.accessToken, { type: 'bearer' })
    .send({ deviceId });
  expect(bootstrap.status).toBe(201);
  expect(bootstrap.body.keyBase64).not.toBe(own.body.keyBase64);
  const receipt = await request(a.app.getHttpServer())
    .get(`/api/offline/operations/${op.operationId}?deviceId=${deviceId}`)
    .set('X-Tenant-Slug', a.tenant.slug)
    .auth(other.accessToken, { type: 'bearer' });
  expect(receipt.status).toBe(404);
});
test('permiso revocado bloquea sin recibo definitivo; restaurar permiso no cambia UUID ni autor', async () => {
  const item = await a.item(),
    op = stockIntent(a, deviceId, item);
  const roles = await a.inStore(() =>
    a.db.usuario_rol.findMany({ where: { usuario_id: a.actorId } }),
  );
  await a.inStore(() => a.db.usuario_rol.deleteMany({ where: { usuario_id: a.actorId } }));
  try {
    const blocked = await sendOffline(a, [op]);
    expect(blocked.status).toBe(201);
    expect(blocked.body.results[0].blocked.code).toBe('FORBIDDEN');
    expect(
      await a.inStore(() => a.db.operacion_sincronizacion.count({ where: { id: op.operationId } })),
    ).toBe(0);
  } finally {
    await a.inStore(() => a.db.usuario_rol.createMany({ data: roles }));
  }
  const success = await sendOffline(a, [op]);
  expect(success.body.results[0].receipt).toMatchObject({
    status: 'APPLIED',
    actorId: a.actorId,
    operationId: op.operationId,
  });
});
test('dependencias de otra instalación no heredan su aprobación ni su versión', async () => {
  const item = await a.item(),
    first = stockIntent(a, deviceId, item);
  await sendOffline(a, [first]);
  const otherDevice = randomUUID();
  await a.http('post', '/offline/bootstrap', { deviceId: otherDevice });
  const next = stockIntent(a, otherDevice, item, { dependsOn: [first.operationId] });
  const res = await sendOffline(a, [next]);
  expect(res.body.results[0].blocked.code).toBe('DEPENDENCY_BLOCKED');
  expect(
    await a.inStore(() => a.db.operacion_sincronizacion.count({ where: { id: next.operationId } })),
  ).toBe(0);
});

test('personal con permiso de inventario conserva restricción por ubicación', async () => {
  const item = await a.item(),
    op = stockIntent(a, deviceId, item);
  const roles = await a.inStore(() =>
    a.db.usuario_rol.findMany({ where: { usuario_id: a.actorId } }),
  );
  const scoped = await a.inStore(async () => {
    const permission = await a.db.permiso.findFirstOrThrow({
      where: { recurso: 'inventario', accion: 'gestionar' },
    });
    const role = await a.db.rol.create({
      data: {
        nombre: `QA-${randomUUID().slice(0, 8)}`,
        descripcion: 'Inventario por ámbito QA',
        protegido: false,
        rol_permiso: { create: { permiso_id: permission.id } },
      },
    });
    await a.db.usuario_rol.deleteMany({ where: { usuario_id: a.actorId } });
    await a.db.usuario_rol.create({
      data: { usuario_id: a.actorId, rol_id: role.id, asignado_en: new Date() },
    });
    return role;
  });
  try {
    const blocked = await sendOffline(a, [op]);
    expect(blocked.body.results[0].blocked.code).toBe('FORBIDDEN');
    await a.inStore(() =>
      a.db.usuario_ubicacion.create({
        data: { usuario_id: a.actorId, ubicacion_id: item.locationId },
      }),
    );
    const success = await sendOffline(a, [op]);
    expect(success.body.results[0].receipt.status).toBe('APPLIED');
    await a.inStore(() =>
      a.db.usuario_ubicacion.delete({
        where: {
          usuario_id_ubicacion_id: { usuario_id: a.actorId, ubicacion_id: item.locationId },
        },
      }),
    );
    expect(
      (await a.http('get', `/offline/operations/${op.operationId}?deviceId=${deviceId}`)).status,
    ).toBe(403);
  } finally {
    await a.inStore(() =>
      a.db.usuario_rol.deleteMany({ where: { usuario_id: a.actorId, rol_id: scoped.id } }),
    );
    await a.inStore(() => a.db.usuario_rol.createMany({ data: roles }));
  }
});
