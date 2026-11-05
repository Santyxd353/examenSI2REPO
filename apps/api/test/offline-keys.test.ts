import 'dotenv/config';
import { createDecipheriv, randomBytes, randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { Fixture } from './helpers/offline';
let f: Fixture;
const deviceId = randomUUID(),
  firstMaster = randomBytes(32).toString('base64');
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = firstMaster;
  delete process.env.OFFLINE_WRAP_KEYS;
  delete process.env.OFFLINE_WRAP_KEY_VERSION;
  f = await commerceFixture();
});
afterAll(async () => {
  await f?.close();
});
const bootstrap = () => f.http('post', '/offline/bootstrap', { deviceId });
test('material está envuelto con AES-GCM, AAD de identidad y no se guarda ni audita en claro', async () => {
  const response = await bootstrap();
  expect(response.status).toBe(201);
  expect(response.headers['cache-control']).toContain('no-store');
  const row = await f.inStore(() =>
    f.db.configuracion.findFirstOrThrow({ where: { clave: { startsWith: 'offline-device:' } } }),
  );
  const value = row.valor as any;
  expect(value.aad).toContain(f.actorId);
  expect(value.aad).toContain(f.tenant.id);
  expect(value.aad).toContain(deviceId);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(firstMaster, 'base64'),
    Buffer.from(value.nonce, 'base64'),
  );
  decipher.setAAD(Buffer.from(value.aad));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  expect(
    Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('base64'),
  ).toBe(response.body.keyBase64);
  const wrong = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(firstMaster, 'base64'),
    Buffer.from(value.nonce, 'base64'),
  );
  wrong.setAAD(Buffer.from(value.aad + '-otro-dispositivo'));
  wrong.setAuthTag(Buffer.from(value.tag, 'base64'));
  wrong.update(Buffer.from(value.ciphertext, 'base64'));
  expect(() => wrong.final()).toThrow();
  expect(JSON.stringify(await f.inStore(() => f.db.auditoria.findMany()))).not.toContain(
    response.body.keyBase64,
  );
});
test('rotación de envoltura conserva DEK, historial y acceso a la copia anterior', async () => {
  const first = await bootstrap();
  process.env.OFFLINE_WRAP_KEYS = JSON.stringify({
    1: firstMaster,
    2: randomBytes(32).toString('base64'),
  });
  process.env.OFFLINE_WRAP_KEY_VERSION = '2';
  const second = await bootstrap();
  expect(second.status).toBe(201);
  expect(second.body.keyBase64).toBe(first.body.keyBase64);
  const rows = await f.inStore(() =>
    f.db.configuracion.findMany({
      where: { clave: { startsWith: 'offline-device:' } },
      orderBy: { version: 'asc' },
    }),
  );
  expect(rows).toHaveLength(2);
  expect(rows[0].hasta).not.toBeNull();
  expect((rows[1].valor as any).wrapVersion).toBe(2);
});
test('corrupción no genera clave nueva ni sobrescribe la copia recuperable', async () => {
  const row = await f.inStore(() =>
    f.db.configuracion.findFirstOrThrow({
      where: { clave: { startsWith: 'offline-device:' }, hasta: null },
    }),
  );
  const original = row.valor as any;
  await f.inStore(() =>
    f.db.configuracion.update({
      where: { id: row.id },
      data: { valor: { ...original, tag: randomBytes(16).toString('base64') } },
    }),
  );
  const failed = await bootstrap();
  expect(failed.status).toBe(503);
  expect(failed.body.code).toBe('OFFLINE_KEY_UNAVAILABLE');
  expect(await f.inStore(() => f.db.configuracion.count({ where: { clave: row.clave } }))).toBe(2);
  await f.inStore(() =>
    f.db.configuracion.update({ where: { id: row.id }, data: { valor: original } }),
  );
  expect((await bootstrap()).status).toBe(201);
});
test('clave maestra ausente devuelve503 sin reemplazar registros privados existentes', async () => {
  const keys = process.env.OFFLINE_WRAP_KEYS;
  delete process.env.OFFLINE_WRAP_KEYS;
  delete process.env.OFFLINE_MASTER_KEY;
  try {
    expect((await bootstrap()).status).toBe(503);
    expect(
      await f.inStore(() =>
        f.db.configuracion.count({ where: { clave: { startsWith: 'offline-device:' } } }),
      ),
    ).toBe(2);
  } finally {
    process.env.OFFLINE_WRAP_KEYS = keys;
    process.env.OFFLINE_MASTER_KEY = firstMaster;
  }
});
