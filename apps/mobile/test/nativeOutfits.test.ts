import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { toBase64, fromBase64 } from '../src/offline/base64';
import {
  NativeOutfitCache,
  privateOutfitPath,
  arGarmentImageUrl,
} from '../src/modules/catalog/nativeOutfits';

test('la cámara conserva el PNG verificado offline y resuelve la prenda del servidor', () => {
  const uri = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(arGarmentImageUrl('https://qa.test/api', uri), uri);
  assert.equal(
    arGarmentImageUrl('https://qa.test/api', '/media/ar/vestido.png'),
    'https://qa.test/media/ar/vestido.png',
  );
  assert.equal(arGarmentImageUrl('https://qa.test/api', null), null);
});

test('el codec binario mantiene todos los bytes sin depender de Buffer en Android', () => {
  for (const size of [0, 1, 2, 3, 257, 65537, 3 * 1024 * 1024]) {
    const bytes = Uint8Array.from({ length: size }, (_, i) => i % 256);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
  }
  assert.throws(() => fromBase64('not base64!'));
});
function fixture() {
  const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() },
    packageId = randomUUID();
  const bytes = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  const hash = async (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  const manifest = {
    packageId,
    tenantId: scope.tenantId,
    ownerId: scope.actorId,
    platform: 'ANDROID_AR',
    createdAt: '2026-11-07T12:00:00Z',
    manifestVersion: '1.0',
    preferencesBasis: 'Gustos guardados',
    garmentCount: 3,
    state: 'PARCIAL',
    optionalOwnAvatar: null,
    garments: Array.from({ length: 3 }, (_, i) => {
      const resourceId = randomUUID();
      return {
        productId: randomUUID(),
        variantId: randomUUID(),
        catalogVersion: 1,
        resourceId,
        resourceVersion: 1,
        format: 'PNG',
        privateDownloadUrl: `/api/offline/outfits/${packageId}/files/${resourceId}?deviceId=${scope.deviceId}`,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        compatibility: 'torso-v1',
        license: 'Geometría QA propia',
        required: true,
        placement: { algorithm: 'torso-v1', kind: 'dress' },
        productName: 'Vestido ' + i,
        size: 'S',
        color: 'Rosa',
      };
    }),
  };
  const records = new Map<string, unknown>(),
    calls: string[] = [];
  let failed = manifest.garments[1].resourceId,
    locked = false;
  const io = {
    read: async (key: string) => records.get(key) ?? null,
    write: async (key: string, value: unknown) => {
      records.set(key, JSON.parse(JSON.stringify(value)));
    },
    remove: async (keys: string[]) => {
      keys.forEach((key) => records.delete(key));
    },
    digest: hash,
    guard: () => {
      if (locked) throw new Error('Sesión bloqueada');
    },
    get: async (path: string) => {
      calls.push(path);
      if (failed && path.includes(failed)) throw new Error('Sin conexión');
      return { bytes, contentType: 'image/png' };
    },
  };
  return {
    scope,
    manifest,
    bytes,
    records,
    calls,
    io,
    failResource: (id: string) => {
      failed = id;
    },
    unlockNetwork: () => {
      failed = '';
    },
    lock: () => {
      locked = true;
    },
  };
}
test('la descarga parcial sobrevive a una reapertura, recupera recursos dañados y solo publica un paquete íntegro', async () => {
  const f = fixture(),
    cache = new NativeOutfitCache('https://qa.test/api', f.scope, f.io);
  let status = await cache.download(f.manifest);
  assert.equal(status.active, null);
  assert.equal(status.pending?.readyIds.length, 2);
  const broken = [...f.records.keys()].find((key) =>
    key.includes(f.manifest.garments[0].resourceId),
  )!;
  f.records.set(broken, { base64: toBase64(new Uint8Array([1, 2, 3])), bytes: f.bytes.length });
  f.unlockNetwork();
  f.calls.length = 0;
  const reopened = new NativeOutfitCache('https://qa.test/api', f.scope, f.io);
  status = await reopened.download(status.pending!.manifest);
  assert.equal(f.calls.length, 2);
  assert.equal(status.pending, null);
  assert.equal(status.active?.readyIds.length, 3);
  const uri = await reopened.image(f.manifest.packageId, f.manifest.garments[0].resourceId);
  assert.equal(uri, 'data:image/png;base64,' + Buffer.from(f.bytes).toString('base64'));
  f.lock();
  await assert.rejects(reopened.image(f.manifest.packageId, f.manifest.garments[0].resourceId));
});
test('un manifiesto ajeno o una URL externa no inicia descargas con credenciales', async () => {
  const f = fixture(),
    cache = new NativeOutfitCache('https://qa.test/api', f.scope, f.io);
  await assert.rejects(cache.download({ ...f.manifest, ownerId: randomUUID() }));
  const bad = {
    ...f.manifest,
    garments: f.manifest.garments.map((g, i) =>
      i === 0 ? { ...g, privateDownloadUrl: 'https://evil.test/asset.png' } : g,
    ),
  };
  await assert.rejects(cache.download(bad));
  assert.equal(f.calls.length, 0);
  assert.throws(() =>
    privateOutfitPath(
      'https://qa.test/api',
      f.scope,
      f.manifest as any,
      {
        ...f.manifest.garments[0],
        privateDownloadUrl: f.manifest.garments[0].privateDownloadUrl.replace(
          f.scope.deviceId,
          randomUUID(),
        ),
      } as any,
    ),
  );
});
test('un reemplazo parcial conserva el paquete listo y solo retira el anterior al completar el nuevo', async () => {
  const f = fixture();
  f.unlockNetwork();
  const cache = new NativeOutfitCache('https://qa.test/api', f.scope, f.io);
  await cache.download(f.manifest);
  const id = randomUUID();
  const next = {
    ...f.manifest,
    packageId: id,
    garments: f.manifest.garments.map((g) => {
      const rid = randomUUID();
      return {
        ...g,
        resourceId: rid,
        privateDownloadUrl: `/api/offline/outfits/${id}/files/${rid}?deviceId=${f.scope.deviceId}`,
      };
    }),
  };
  f.failResource(next.garments[0].resourceId);
  let status = await cache.download(next);
  assert.equal(status.active?.manifest.packageId, f.manifest.packageId);
  assert.equal(status.pending?.readyIds.length, 2);
  assert.ok(await cache.image(f.manifest.packageId, f.manifest.garments[0].resourceId));
  f.unlockNetwork();
  status = await cache.download(next);
  assert.equal(status.active?.manifest.packageId, id);
  assert.ok(![...f.records.keys()].some((key) => key.includes(f.manifest.packageId)));
  await cache.clear();
  assert.equal(f.records.size, 0);
});
