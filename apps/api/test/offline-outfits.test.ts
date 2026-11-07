import 'dotenv/config';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { OutfitManifestSchema } from '@lumina/contracts';
import { commerceFixture } from './helpers/commerce';
import { Fixture } from './helpers/offline';
import { AuthService } from '../src/auth';
import { storedPath } from '../src/storage';
import { seedWomen } from '../../../scripts/seed-women';
import { NativeOutfitCache } from '../../mobile/src/modules/catalog/nativeOutfits';

let f: Fixture;
const deviceId = randomUUID();
const manifest = (platform: 'WEB_3D' | 'ANDROID_AR', includeOwnAvatar = false) =>
  f.http('post', '/offline/outfits', { deviceId, platform, includeOwnAvatar });
const file = (url: string) =>
  f
    .http('get', url.replace(/^\/api/, ''))
    .buffer(true)
    .parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
      response.on('error', done);
    });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  f = await commerceFixture();
  await f.http('post', '/offline/bootstrap', { deviceId });
  await f.inStore(async () => {
    const location = await f.db.ubicacion.findFirstOrThrow();
    await seedWomen(f.db, { storageRoot: f.tenant.storageDirectory, locationId: location.id });
  });
});
afterAll(async () => {
  await f?.close();
});

test('12 referencias reales producen diez productos distintos con archivos íntegros para cada plataforma', async () => {
  const saved = await f.http('patch', '/profile', {
    preferences: { brands: ['Nike'], sizes: ['L'], colors: [], categoryIds: [] },
  });
  expect(saved.status).toBe(200);
  for (const platform of ['WEB_3D', 'ANDROID_AR'] as const) {
    const response = await manifest(platform);
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toContain('no-store');
    const data = OutfitManifestSchema.parse(response.body);
    expect(data).toMatchObject({
      platform,
      garmentCount: 10,
      state: 'COMPLETO',
      optionalOwnAvatar: null,
    });
    expect(new Set(data.garments.map((item) => item.productId)).size).toBe(10);
    const preferred = await f.inStore(() =>
      f.db.variante.findUniqueOrThrow({
        where: { id: data.garments[0].variantId },
        include: { producto: true },
      }),
    );
    expect(preferred.talla).toBe('L');
    expect(preferred.producto.marca).toBe('Nike');
    for (const item of data.garments) {
      const result = await file(item.privateDownloadUrl);
      expect(result.status).toBe(200);
      expect(result.headers['cache-control']).toContain('no-store');
      expect(result.body.length).toBe(item.bytes);
      expect(hash(result.body)).toBe(item.sha256);
      expect(item.format).toBe(platform === 'WEB_3D' ? 'GLB' : 'PNG');
      if (platform === 'ANDROID_AR')
        expect(item.placement).toMatchObject({ algorithm: 'torso-v1' });
    }
    const repeat = await manifest(platform);
    expect(repeat.body.garments.map((item: any) => item.variantId)).toEqual(
      data.garments.map((item) => item.variantId),
    );
    if (platform === 'ANDROID_AR') {
      const records = new Map<string, unknown>();
      const cache = new NativeOutfitCache(
        'https://qa.test/api',
        {
          tenantId: data.tenantId,
          actorId: data.ownerId,
          deviceId,
        },
        {
          guard: () => {},
          read: async (key) => records.get(key) ?? null,
          write: async (key, value) => {
            records.set(key, value);
          },
          remove: async (keys) => {
            keys.forEach((key) => records.delete(key));
          },
          digest: async (bytes) => hash(Buffer.from(bytes)),
          get: async (path) => {
            const result = await file('/api' + path);
            expect(result.status).toBe(200);
            return {
              bytes: new Uint8Array(result.body),
              contentType: result.headers['content-type'].split(';')[0],
            };
          },
        },
      );
      const downloaded = await cache.download(data);
      expect(downloaded.active?.readyIds).toHaveLength(10);
      expect(downloaded.pending).toBeNull();
      expect(await cache.image(data.packageId, data.garments[0].resourceId)).toMatch(
        /^data:image\/png;base64,/,
      );
    }
  }
});

test('un paquete y sus archivos pertenecen a la cuenta, tienda y dispositivo que lo solicitaron', async () => {
  const response = await manifest('ANDROID_AR');
  expect(response.status).toBe(201);
  const { privateDownloadUrl } = response.body.garments[0];
  const otherDevice = randomUUID();
  await f.http('post', '/offline/bootstrap', { deviceId: otherDevice });
  expect((await file(privateDownloadUrl.replace(deviceId, otherDevice))).status).toBe(404);
  const customer = await f.inStore(() =>
    f.app.get(AuthService).mobileRegister({
      nombres: 'Clienta',
      apellidos: 'Ajena',
      correo: randomUUID() + '@qa.test',
      clave: 'OtraClienta2026!',
    }),
  );
  await request(f.app.getHttpServer())
    .post('/api/offline/bootstrap')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(customer.accessToken, { type: 'bearer' })
    .send({ deviceId });
  expect(
    (
      await request(f.app.getHttpServer())
        .get(privateDownloadUrl)
        .set('X-Tenant-Slug', f.tenant.slug)
        .auth(customer.accessToken, { type: 'bearer' })
    ).status,
  ).toBe(404);
  expect(
    (
      await request(f.app.getHttpServer())
        .get(privateDownloadUrl)
        .set('X-Tenant-Slug', 'lumina')
        .auth(f.token, { type: 'bearer' })
    ).status,
  ).toBe(401);
});

test('si quedan siete prendas o ninguna, la cobertura es honesta y los archivos retirados no se sirven', async () => {
  const response = await manifest('ANDROID_AR');
  expect(response.status).toBe(201);
  const old = response.body.garments[0];
  const productIds = await f.inStore(async () =>
    (await f.db.producto.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map(
      (row) => row.id,
    ),
  );
  const others = productIds.filter((id) => id !== old.productId);
  const retired = [old.productId, ...others.slice(0, 4)];
  await f.inStore(() =>
    f.db.producto.updateMany({ where: { id: { in: retired } }, data: { estado: 'RETIRADO' } }),
  );
  try {
    const partial = await manifest('ANDROID_AR');
    expect(partial.body).toMatchObject({
      garmentCount: 7,
      state: 'COMPLETO',
      limitations: expect.arrayContaining([expect.any(String)]),
    });
    expect((await file(old.privateDownloadUrl)).status).toBe(404);
    await f.inStore(() =>
      f.db.recurso_catalogo.updateMany({ where: { uso: 'AR' }, data: { estado: 'BORRADOR' } }),
    );
    const empty = await manifest('ANDROID_AR');
    expect(empty.body).toMatchObject({
      garmentCount: 0,
      state: 'PARCIAL',
      garments: [],
      limitations: expect.arrayContaining([expect.any(String)]),
    });
  } finally {
    await f.inStore(() =>
      f.db.producto.updateMany({ where: { id: { in: retired } }, data: { estado: 'PUBLICADO' } }),
    );
    await f.inStore(() =>
      f.db.recurso_catalogo.updateMany({ where: { uso: 'AR' }, data: { estado: 'PUBLICADO' } }),
    );
  }
});

test('avatar aprobado exige consentimiento local explícito y deja de descargarse al borrarlo', async () => {
  const avatar = await f.inStore(async () => {
    const template = await f.db.plantilla_corporal.findFirstOrThrow();
    const id = randomUUID(),
      key = 'private/outfit-fixture/' + id + '.glb';
    // Small static fixture for access checks. It represents no person's photos or measurements.
    const points = Buffer.alloc(36);
    [0, 0, 0, 0.2, 1.7, 0, -0.2, 1, 0].forEach((v, index) => points.writeFloatLE(v, index * 4));
    let json = JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'Cuerpo_G18', mesh: 0, extras: { reference: false, plantilla: 'g18-1' } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 }],
    });
    json = json.padEnd(Math.ceil(json.length / 4) * 4);
    const bytes = Buffer.alloc(28 + json.length + points.length);
    bytes.write('glTF');
    bytes.writeUInt32LE(2, 4);
    bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(json.length, 12);
    bytes.writeUInt32LE(0x4e4f534a, 16);
    bytes.write(json, 20);
    bytes.writeUInt32LE(points.length, 20 + json.length);
    bytes.writeUInt32LE(0x004e4942, 24 + json.length);
    points.copy(bytes, 28 + json.length);
    await mkdir(storedPath('private/outfit-fixture'), { recursive: true });
    await writeFile(storedPath(key), bytes);
    return f.db.avatar.create({
      data: {
        id,
        usuario_id: f.actorId,
        plantilla_id: template.id,
        version: 1,
        clave_glb: key,
        estado: 'APROBADO',
        medidas: { altura: { valor_cm: 170 } },
        creado_en: new Date(),
        aprobado_en: new Date(),
      },
    });
  });
  expect((await manifest('WEB_3D')).body.optionalOwnAvatar).toBeNull();
  expect((await manifest('ANDROID_AR', true)).status).toBe(400);
  const own = await manifest('WEB_3D', true);
  expect(own.body.optionalOwnAvatar).toMatchObject({ avatarId: avatar.id, consented: true });
  expect((await file(own.body.optionalOwnAvatar.privateDownloadUrl)).status).toBe(200);
  const deleted = await request(f.app.getHttpServer())
    .delete('/api/avatars/' + avatar.id)
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' });
  expect(deleted.status).toBe(200);
  expect((await file(own.body.optionalOwnAvatar.privateDownloadUrl)).status).toBe(404);
  expect(
    (await f.http('get', '/offline/outfits/' + own.body.packageId + '?deviceId=' + deviceId)).body
      .optionalOwnAvatar,
  ).toBeNull();
});
