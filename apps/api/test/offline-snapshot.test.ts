import 'dotenv/config';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { canonicalJson } from '@lumina/contracts';
import { writeFile } from 'fs/promises';
import { storedPath } from '../src/storage';
import { SnapshotService } from '../src/offline/snapshot.service';
import { purgePrivateDocuments } from '../src/offline/private-files';
import { commerceFixture } from './helpers/commerce';
import { Fixture } from './helpers/offline';
import { AuthService } from '../src/auth';
let f: Fixture;
const deviceId = randomUUID();
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  f = await commerceFixture();
  await f.http('post', '/offline/bootstrap', { deviceId });
});
afterAll(async () => {
  await f?.close();
});
const get = (suffix = '') => f.http('get', `/offline/snapshot?deviceId=${deviceId}${suffix}`);
test('stock y catálogo mantienen un corte estable entre páginas aunque cambie la base', async () => {
  const item = await f.item(10);
  const first = await get('&pageSize=1');
  expect(first.status).toBe(200);
  expect(first.headers['cache-control']).toContain('no-store');
  expect(first.body).toMatchObject({
    schemaVersion: '1.0',
    scope: { tenantId: f.tenant.id, actorId: f.actorId, deviceId },
    coverage: { complete: true },
  });
  expect(first.body.nextCursor).toBeTruthy();
  await f.inStore(() =>
    f.db.inventario.update({
      where: { id: item.inventoryId },
      data: { fisico: 99, version: { increment: 1 } },
    }),
  );
  const all = [...first.body.entities];
  let cursor = first.body.nextCursor;
  while (cursor) {
    const page = await get('&cursor=' + encodeURIComponent(cursor));
    expect(page.status).toBe(200);
    expect(page.body.snapshotId).toBe(first.body.snapshotId);
    expect(page.body.asOf).toBe(first.body.asOf);
    expect(page.body.sha256).toBe(first.body.sha256);
    all.push(...page.body.entities);
    cursor = page.body.nextCursor;
  }
  const stock = all.find((e) => e.kind === 'STOCK' && e.id === item.inventoryId);
  expect(stock).toMatchObject({ physical: 10, version: 1 });
  expect(all.length).toBe(first.body.coverage.rowCount);
  const { sha256, pageHash, nextCursor, offset, pageSize, ...document } = first.body;
  const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
  expect(hash(document.entities)).toBe(pageHash);
  expect(hash({ ...document, entities: all })).toBe(sha256);
  const fresh = await get('&pageSize=500');
  expect(
    fresh.body.entities.find((e: any) => e.kind === 'STOCK' && e.id === item.inventoryId),
  ).toMatchObject({ physical: 99, version: 2 });
});
test('el cursor detecta un corte modificado y la limpieza elimina archivos vencidos', async () => {
  const first = await get('&pageSize=1');
  const key = 'private/offline/snapshots/' + f.actorId + '/' + first.body.snapshotId + '.json';
  await f.inStore(() => writeFile(storedPath(key), '{}'));
  expect((await get('&cursor=' + encodeURIComponent(first.body.nextCursor))).status).toBe(410);
  const fresh = await get('&pageSize=1');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse(fresh.body.expiresAt) + 1000);
  try {
    await expect(
      f.inStore(() =>
        f.app.get(SnapshotService).page(f.req(), { deviceId, cursor: fresh.body.nextCursor }),
      ),
    ).rejects.toMatchObject({ status: 410 });
  } finally {
    clock.mockRestore();
  }
  expect(
    await f.inStore(() => purgePrivateDocuments('snapshots', new Date(Date.now() + 25 * 3600000))),
  ).toBeGreaterThan(0);
  expect((await get('&cursor=' + encodeURIComponent(fresh.body.nextCursor))).status).toBe(404);
});
test('cursor alterado o usado por otro dispositivo no abre el corte anterior', async () => {
  const first = await get('&pageSize=1');
  const cursor = first.body.nextCursor;
  const tampered = cursor.slice(0, -1) + (cursor.endsWith('A') ? 'B' : 'A');
  expect((await get('&cursor=' + encodeURIComponent(tampered))).status).toBe(400);
  const second = randomUUID();
  await f.http('post', '/offline/bootstrap', { deviceId: second });
  expect(
    (
      await f.http(
        'get',
        `/offline/snapshot?deviceId=${second}&cursor=${encodeURIComponent(cursor)}`,
      )
    ).status,
  ).toBe(400);
});
test('una compradora no recibe saldos internos ni borradores y no reutiliza el cursor administrativo', async () => {
  const item = await f.item();
  await f.inStore(() =>
    f.db.producto.update({ where: { id: item.productId }, data: { estado: 'BORRADOR' } }),
  );
  const owner = await get('&pageSize=1');
  const customer = await f.inStore(() =>
    f.app
      .get(AuthService)
      .mobileRegister({
        nombres: 'Ana',
        apellidos: 'Offline',
        correo: randomUUID() + '@qa.test',
        clave: 'ClientaOffline2026!',
      }),
  );
  const call = (path: string) =>
    request(f.app.getHttpServer())
      .get('/api' + path)
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(customer.accessToken, { type: 'bearer' });
  await request(f.app.getHttpServer())
    .post('/api/offline/bootstrap')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(customer.accessToken, { type: 'bearer' })
    .send({ deviceId });
  const own = await call(`/offline/snapshot?deviceId=${deviceId}&pageSize=500`);
  expect(own.status).toBe(200);
  expect(own.body.entities.some((e: any) => e.kind === 'STOCK' || e.id === item.productId)).toBe(
    false,
  );
  expect(
    (
      await call(
        `/offline/snapshot?deviceId=${deviceId}&cursor=${encodeURIComponent(owner.body.nextCursor)}`,
      )
    ).status,
  ).toBe(400);
});
