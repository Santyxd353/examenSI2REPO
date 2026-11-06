import 'dotenv/config';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PNG } from 'pngjs';
import { access, writeFile } from 'fs/promises';
import { storedPath } from '../src/storage';
import { ResourcesService } from '../src/offline/resources.service';
import { commerceFixture } from './helpers/commerce';
import { Fixture, sendOffline, signedIntent } from './helpers/offline';
let f: Fixture;
const deviceId = randomUUID();
function png(transparent = true) {
  const p = new PNG({ width: 256, height: 256 });
  p.data.fill(180);
  for (let i = 3; i < p.data.length; i += 4)
    p.data[i] = transparent && i < p.data.length / 3 ? 0 : 255;
  return PNG.sync.write(p);
}
function ref(bytes: Buffer, extra: object = {}) {
  return {
    clientResourceId: randomUUID(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mime: 'image/png',
    usage: 'GALLERY',
    license: 'Fixture propio Grupo 18, CC0',
    ...extra,
  };
}
const upload = (bytes: Buffer, reference: object, device = deviceId) =>
  request(f.app.getHttpServer())
    .post('/api/offline/resources')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' })
    .field('metadata', JSON.stringify({ deviceId: device, reference }))
    .attach('file', bytes, { filename: 'prenda.png', contentType: (reference as any).mime });
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  f = await commerceFixture();
  await f.http('post', '/offline/bootstrap', { deviceId });
});
afterAll(async () => {
  await f?.close();
});
test('staging recuperable: mismo archivo/UUID no se duplica; cambiar su licencia o dispositivo se rechaza', async () => {
  const bytes = png(),
    reference = ref(bytes);
  const first = await upload(bytes, reference);
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({ reference, state: 'VERIFIED' });
  expect(first.headers['cache-control']).toContain('no-store');
  expect((await upload(bytes, reference)).body).toEqual(first.body);
  expect((await upload(bytes, { ...reference, license: 'Otra licencia' })).status).toBe(409);
  const other = randomUUID();
  await f.http('post', '/offline/bootstrap', { deviceId: other });
  expect((await upload(bytes, reference, other)).status).toBe(404);
  const publicRead = await f.http('get', '/catalog/offline-media/' + reference.clientResourceId);
  expect(publicRead.status).toBe(404);
});
test('rechaza checksum, tamaño, MIME falso, imagen truncada y licencia vacía antes de registrar el archivo', async () => {
  const bytes = png();
  for (const reference of [
    ref(bytes, { sha256: '0'.repeat(64) }),
    ref(bytes, { bytes: bytes.length + 1 }),
    ref(bytes, { mime: 'image/jpeg' }),
    ref(bytes, { license: '' }),
  ])
    expect((await upload(bytes, reference)).status).toBe(400);
  const damaged = bytes.subarray(0, 55);
  expect((await upload(damaged, ref(damaged))).status).toBe(400);
});
test('AR requiere PNG transparente y metadatos de colocación; una miniatura no sirve como GLB', async () => {
  const bytes = png(),
    opaque = png(false),
    item = await f.item();
  const extra = {
    usage: 'ANDROID_AR',
    variantId: item.variantId,
    placement: { algorithm: 'torso-v1', kind: 'dress' },
  };
  expect((await upload(opaque, ref(opaque, extra))).status).toBe(400);
  expect(
    (await upload(bytes, ref(bytes, { usage: 'ANDROID_AR', variantId: item.variantId }))).status,
  ).toBe(400);
  expect((await upload(bytes, ref(bytes, extra))).status).toBe(201);
  expect(
    (
      await upload(
        bytes,
        ref(bytes, { usage: 'WEB_3D', mime: 'model/gltf-binary', variantId: item.variantId }),
      )
    ).status,
  ).toBe(400);
});
test('sincronizar depende del staging privado; reintentar el mismo UUID después de subirlo aplica una sola vez', async () => {
  const item = await f.item(),
    bytes = png(),
    reference = ref(bytes, { variantId: item.variantId });
  const op = signedIntent({
    schemaVersion: '1.0',
    tenantId: f.tenant.id,
    actorId: f.actorId,
    deviceId,
    operationId: randomUUID(),
    entityId: item.productId,
    kind: 'CATALOG_UPDATE',
    baseVersion: 1,
    dependsOn: [],
    createdAt: new Date().toISOString(),
    payload: { patch: { resources: [reference] } },
  });
  const blocked = await sendOffline(f, [op]);
  expect(blocked.body.results[0].blocked.code).toBe('RESOURCE_NOT_STAGED');
  expect((await upload(bytes, reference)).status).toBe(201);
  const key = 'private/offline/resources/' + reference.clientResourceId + '.png';
  await f.inStore(() => writeFile(storedPath(key), 'archivo dañado'));
  expect((await sendOffline(f, [op])).body.results[0].blocked.code).toBe('RESOURCE_NOT_STAGED');
  expect((await upload(bytes, reference)).status).toBe(201);
  const applied = await sendOffline(f, [op]);
  expect(applied.body.results[0].receipt.status).toBe('APPLIED');
  expect((await sendOffline(f, [op])).body).toEqual(applied.body);
  expect(
    await f.inStore(() =>
      f.db.recurso_catalogo.count({ where: { id: reference.clientResourceId } }),
    ),
  ).toBe(1);
  const file = await f.http('get', '/catalog/offline-media/' + reference.clientResourceId);
  expect(file.status).toBe(200);
  expect(file.body).toEqual(bytes);
  const anonymousImage = await request(f.app.getHttpServer()).get(
    '/api/catalog/offline-media/' + reference.clientResourceId + '?store=' + f.tenant.slug,
  );
  expect(anonymousImage.body).toEqual(bytes);
  await f.inStore(() =>
    f.db.producto.update({ where: { id: item.productId }, data: { estado: 'RETIRADO' } }),
  );
  const anonymous = await request(f.app.getHttpServer())
    .get('/api/catalog/offline-media/' + reference.clientResourceId)
    .set('X-Tenant-Slug', f.tenant.slug);
  expect(anonymous.status).toBe(404);
  const orphan = ref(bytes);
  await upload(bytes, orphan);
  await f.inStore(() =>
    f.app.get(ResourcesService).purgeExpired(new Date(Date.now() + 8 * 86400000)),
  );
  await expect(f.inStore(() => access(storedPath(key)))).resolves.toBeUndefined();
  await expect(
    f.inStore(() =>
      access(storedPath('private/offline/resources/' + orphan.clientResourceId + '.png')),
    ),
  ).rejects.toThrow('ENOENT');
});
