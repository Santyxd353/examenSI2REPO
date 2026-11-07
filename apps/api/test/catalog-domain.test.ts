import 'dotenv/config';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import request from 'supertest';
import { PNG } from 'pngjs';

let f: Awaited<ReturnType<typeof commerceFixture>>, categoryId: string;
const mutate = (input: unknown) =>
  f.inStore(() =>
    f.db.$transaction((tx) =>
      require('../src/catalog/catalog.service').mutateCatalog(
        tx,
        { actor: f.actor, operationId: randomUUID() },
        input,
      ),
    ),
  );
beforeAll(async () => {
  f = await commerceFixture();
  categoryId = (
    await f.inStore(() =>
      f.db.categoria.create({ data: { nombre: 'Vestidos catálogo', activa: true } }),
    )
  ).id;
}, 60000);
afterAll(async () => f?.close(), 30000);
const product = () => ({
  id: randomUUID(),
  nombre: 'Vestido femenino',
  descripcion: 'Vestido de algodón de prueba',
  material: 'Algodón',
  marca: 'Marca QA',
  coleccion: 'Primavera',
  categoriaId: categoryId,
  variants: [
    {
      id: randomUUID(),
      sku: randomUUID(),
      barcode: randomUUID(),
      talla: 'S',
      color: 'Rosa',
      prices: { WEB: 5000, APP: 4900, TIENDA: 4500 },
      baseVersion: null,
    },
  ],
  resources: [],
});
test('alta, edición/versiones y archivo conservan variante y saldo; conflicto obsoleto no modifica', async () => {
  const p = product();
  const created: any = await mutate({
    kind: 'CATALOG_CREATE',
    entityId: p.id,
    baseVersion: null,
    payload: { product: p },
  });
  expect(created).toMatchObject({
    id: p.id,
    version: 1,
    estado: 'BORRADOR',
    coleccion: 'Primavera',
  });
  const changed: any = await mutate({
    kind: 'CATALOG_UPDATE',
    entityId: p.id,
    baseVersion: 1,
    payload: {
      patch: {
        nombre: 'Vestido actualizado',
        estado: 'PUBLICADO',
        variants: [
          { ...p.variants[0], baseVersion: 1, prices: { WEB: 6000, APP: 5800, TIENDA: 5500 } },
        ],
      },
    },
  });
  expect(changed).toMatchObject({ version: 2, estado: 'PUBLICADO' });
  expect(changed.variantes[0]).toMatchObject({ version: 2, codigo_barras: p.variants[0].barcode });
  await expect(
    mutate({
      kind: 'CATALOG_UPDATE',
      entityId: p.id,
      baseVersion: 1,
      payload: { patch: { nombre: 'Edición obsoleta' } },
    }),
  ).rejects.toMatchObject({ status: 409 });
  const archived: any = await mutate({
    kind: 'CATALOG_ARCHIVE',
    entityId: p.id,
    baseVersion: 2,
    payload: { reason: 'Fuera de temporada' },
  });
  expect(archived).toMatchObject({ version: 3, estado: 'RETIRADO' });
  expect(await f.inStore(() => f.db.variante.count({ where: { producto_id: p.id } }))).toBe(1);
  expect(await f.inStore(() => f.db.auditoria.count({ where: { entidad_id: p.id } }))).toBe(3);
});
test('SKU/código duplicados, variante ajena y recurso sin validar revierten el agregado', async () => {
  const p = product(),
    q = product();
  await mutate({
    kind: 'CATALOG_CREATE',
    entityId: p.id,
    baseVersion: null,
    payload: { product: p },
  });
  await mutate({
    kind: 'CATALOG_CREATE',
    entityId: q.id,
    baseVersion: null,
    payload: { product: q },
  });
  for (const variant of [
    { ...q.variants[0], baseVersion: 1, sku: p.variants[0].sku },
    { ...q.variants[0], baseVersion: 1, barcode: p.variants[0].barcode },
    { ...p.variants[0], baseVersion: 1 },
  ])
    await expect(
      mutate({
        kind: 'CATALOG_UPDATE',
        entityId: q.id,
        baseVersion: 1,
        payload: { patch: { nombre: 'No guardar', variants: [variant] } },
      }),
    ).rejects.toMatchObject({ status: 409 });
  expect(
    (await f.inStore(() => f.db.producto.findUniqueOrThrow({ where: { id: q.id } }))).version,
  ).toBe(1);
  await expect(
    mutate({
      kind: 'CATALOG_UPDATE',
      entityId: q.id,
      baseVersion: 1,
      payload: {
        patch: {
          resources: [
            {
              clientResourceId: randomUUID(),
              sha256: 'a'.repeat(64),
              bytes: 100,
              mime: 'image/png',
              usage: 'GALLERY',
              license: 'Prueba autorizada',
            },
          ],
        },
      },
    }),
  ).rejects.toMatchObject({ status: 409 });
});
test('precios por canal y promoción programada conservan la vigencia anterior y el precio posterior', async () => {
  const p = product(),
    from = new Date(Date.now() + 86400000).toISOString(),
    to = new Date(Date.now() + 172800000).toISOString();
  const variant = {
    ...p.variants[0],
    discounts: { WEB: { basisPoints: 1500, startsAt: from, endsAt: to } },
  };
  await mutate({
    kind: 'CATALOG_CREATE',
    entityId: p.id,
    baseVersion: null,
    payload: { product: { ...p, variants: [variant] } },
  });
  const prices = await f.inStore(() =>
    f.db.precio_canal.findMany({
      where: { variante_id: variant.id, canal: 'WEB' },
      orderBy: { desde: 'asc' },
    }),
  );
  expect(prices.map((row) => Number(row.descuento_pct))).toEqual([0, 15, 0]);
  expect(prices[0].hasta?.toISOString()).toBe(from);
  expect(prices[1].hasta?.toISOString()).toBe(to);
  expect(prices[2].hasta).toBeNull();
});
test('API permite editar un producto con versión y consultar borradores/archivados solo a personal autorizado', async () => {
  const p = product();
  await mutate({
    kind: 'CATALOG_CREATE',
    entityId: p.id,
    baseVersion: null,
    payload: { product: p },
  });
  const edited = await f.http('patch', `/catalog/products/${p.id}`, {
    baseVersion: 1,
    patch: { nombre: 'Vestido desde API', estado: 'PUBLICADO' },
  });
  expect(edited.status).toBe(200);
  expect(edited.body.version).toBe(2);
  const archived = await f.http('post', `/catalog/products/${p.id}/archive`, {
    baseVersion: 2,
    reason: 'Fin de temporada',
  });
  expect(archived.status).toBe(201);
  const all = await f.http('get', '/catalog/manage');
  expect(all.status).toBe(200);
  expect(all.body.products.find((row: any) => row.id === p.id)).toMatchObject({
    estado: 'RETIRADO',
    version: 3,
  });
  const publicList = await f.http('get', '/catalog');
  expect(publicList.body.products.some((row: any) => row.id === p.id)).toBe(false);
});
test('editar galería conserva archivos/historial, incrementa versión y exige suscripción para multipart', async () => {
  const p = product();
  await mutate({
    kind: 'CATALOG_CREATE',
    entityId: p.id,
    baseVersion: null,
    payload: { product: p },
  });
  const image = new PNG({ width: 300, height: 300 });
  image.data.fill(150);
  const bytes = PNG.sync.write(image);
  const upload = (version: number) =>
    request(f.app.getHttpServer())
      .post(`/api/catalog/products/${p.id}/photos`)
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(f.token, { type: 'bearer' })
      .field('baseVersion', String(version))
      .field('license', 'Imagen sintética de prueba')
      .attach('fotos', bytes, 'foto.png');
  const added = await upload(1);
  expect(added.status).toBe(201);
  expect(added.body.version).toBe(2);
  expect(added.body.recurso_catalogo).toHaveLength(1);
  const resourceId = added.body.recurso_catalogo[0].id;
  const hidden = await f.http('patch', `/catalog/products/${p.id}/photos/${resourceId}`, {
    baseVersion: 2,
    visible: false,
  });
  expect(hidden.status).toBe(200);
  expect(hidden.body.version).toBe(3);
  expect(
    await f.inStore(() => f.db.recurso_catalogo.findUniqueOrThrow({ where: { id: resourceId } })),
  ).toMatchObject({ estado: 'BORRADOR' });
  expect((await upload(1)).status).toBe(409);
  await f.registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [f.tenant.id],
  );
  expect((await upload(3)).status).toBe(402);
  await f.reset();
});
test('colección filtra el precio vigente por canal y ordena las coincidencias', async () => {
  const prefix = `Colección ${randomUUID()}`;
  for (const price of [7000, 5000, 3000]) {
    const p = product();
    p.nombre = `${prefix} ${price}`;
    p.variants[0].prices = { WEB: price, APP: price + 1000, TIENDA: price };
    await mutate({
      kind: 'CATALOG_CREATE',
      entityId: p.id,
      baseVersion: null,
      payload: { product: p },
    });
    await mutate({
      kind: 'CATALOG_UPDATE',
      entityId: p.id,
      baseVersion: 1,
      payload: { patch: { estado: 'PUBLICADO' } },
    });
  }
  const web = await f.http(
    'get',
    `/catalog?search=${encodeURIComponent(prefix)}&minPriceMinor=4000&maxPriceMinor=8000&sort=price_desc`,
  );
  expect(web.status).toBe(200);
  expect(web.body.products.map((p: any) => p.variantes[0].precio)).toEqual([70, 50]);
  const app = await f.http(
    'get',
    `/catalog?search=${encodeURIComponent(prefix)}&channel=APP&maxPriceMinor=4500&sort=price_asc`,
  );
  expect(app.body.products.map((p: any) => p.variantes[0].precio)).toEqual([40]);
  expect((await f.http('get', '/catalog?minPriceMinor=5000&maxPriceMinor=1000')).status).toBe(400);
});
