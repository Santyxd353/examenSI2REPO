import 'dotenv/config';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PNG } from 'pngjs';
import { writeFile } from 'fs/promises';
import { createApp } from '../src/app';
import { removeStored, storedPath } from '../src/storage';

let app: INestApplication;
let db: PrismaClient;
let adminToken: string;
let variantId: string;
let productId: string;
let seededArId: string | undefined;
let resourceId: string | undefined;
const rejectedResourceIds: string[] = [];
let adminId: string;
const stamp = Date.now();
const previousStorageRoot = process.env.STORAGE_ROOT;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  process.env.STORAGE_ROOT = '.local/test-storage';
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const variant = await db.variante.findUniqueOrThrow({ where: { sku: 'G18-W21-S' } });
  variantId = variant.id;
  productId = variant.producto_id;
  const seededAr = await db.recurso_catalogo.findFirst({
    where: { variante_id: variantId, uso: 'AR', estado: 'PUBLICADO' },
  });
  if (seededAr) {
    seededArId = seededAr.id;
    await db.recurso_catalogo.update({ where: { id: seededAr.id }, data: { estado: 'BORRADOR' } });
  }
  const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  const admin = await db.usuario.create({
    data: {
      nombres: 'Admin',
      apellidos: 'AR',
      correo: `admin-ar-${stamp}@grupo18.test`,
      clave_hash: await hash('PruebaSegura2026!', 12),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
    },
  });
  adminId = admin.id;
  app = await createApp();
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ correo: admin.correo, clave: 'PruebaSegura2026!' });
  adminToken = login.body.accessToken;
});

afterAll(async () => {
  if (seededArId) {
    await db.recurso_catalogo.update({
      where: { id: seededArId },
      data: { estado: 'PUBLICADO' },
    });
  }
  for (const id of rejectedResourceIds) {
    const resource = await db.recurso_catalogo.findUnique({ where: { id } });
    if (resource) {
      await db.recurso_catalogo.delete({ where: { id } });
      await removeStored(resource.clave_objeto);
    }
  }
  if (resourceId) {
    const resource = await db.recurso_catalogo.findUnique({ where: { id: resourceId } });
    await db.recurso_catalogo.delete({ where: { id: resourceId } });
    if (resource) await removeStored(resource.clave_objeto);
  }
  if (adminId) {
    await db.sesion.deleteMany({ where: { usuario_id: adminId } });
    await db.usuario_rol.deleteMany({ where: { usuario_id: adminId } });
    await db.usuario.delete({ where: { id: adminId } });
  }
  await app?.close();
  await db?.$disconnect();
  if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT;
  else process.env.STORAGE_ROOT = previousStorageRoot;
});

function pngFixture(kind: 'transparent' | 'opaque' | 'one-pixel' | 'empty') {
  const png = new PNG({ width: 256, height: 256 });
  png.data.fill(255);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const background = x < 32 || x >= 224 || y < 32 || y >= 224;
      if (
        kind === 'empty' ||
        (kind === 'transparent' && background) ||
        (kind === 'one-pixel' && x === 0 && y === 0)
      )
        png.data[(y * png.width + x) * 4 + 3] = 0;
    }
  }
  return PNG.sync.write(png);
}

test.each([
  ['PNG truncado', () => pngFixture('transparent').subarray(0, 100)],
  [
    'PNG con CRC corrupto',
    () => {
      const bytes = pngFixture('transparent');
      bytes[29] ^= 255;
      return bytes;
    },
  ],
  ['PNG opaco con canal alfa', () => pngFixture('opaque')],
  ['PNG con un solo píxel transparente', () => pngFixture('one-pixel')],
  ['PNG completamente transparente', () => pngFixture('empty')],
] as const)('rechaza %s antes de guardar un recurso AR', async (_name, fixture) => {
  const response = await request(app.getHttpServer())
    .post('/api/catalog/ar-resources')
    .auth(adminToken, { type: 'bearer' })
    .field('varianteId', variantId)
    .field('textoAlternativo', 'Prenda de prueba frontal')
    .field('licencia', 'Geometría de prueba propia')
    .attach('imagen', fixture(), { filename: 'prenda.png', contentType: 'image/png' });
  if (response.body.id) rejectedResourceIds.push(response.body.id);
  expect(response.status).toBe(400);
  expect(response.body.id).toBeUndefined();
});

test('el catálogo entrega la categoría de la prenda como tipo explícito para AR', async () => {
  const variant = await db.variante.findUniqueOrThrow({
    where: { id: variantId },
    include: { producto: { include: { categoria: true } } },
  });
  const response = await request(app.getHttpServer()).get('/api/catalog');
  expect(response.status).toBe(200);
  const product = response.body.products.find((item: { id: string }) => item.id === variant.producto_id);
  expect(product.tipoPrenda).toBe(variant.producto.categoria.nombre);
});

test('publicar vuelve a validar el PNG y conserva el borrador si el archivo ya no sirve', async () => {
  const upload = await request(app.getHttpServer())
    .post('/api/catalog/ar-resources')
    .auth(adminToken, { type: 'bearer' })
    .field('varianteId', variantId)
    .field('textoAlternativo', 'Prenda de prueba frontal')
    .field('licencia', 'Geometría de prueba propia')
    .attach('imagen', pngFixture('transparent'), { filename: 'prenda.png', contentType: 'image/png' });
  expect(upload.status).toBe(201);
  rejectedResourceIds.push(upload.body.id);
  const resource = await db.recurso_catalogo.findUniqueOrThrow({ where: { id: upload.body.id } });
  await writeFile(storedPath(resource.clave_objeto), pngFixture('opaque'));
  const publish = await request(app.getHttpServer())
    .patch(`/api/catalog/ar-resources/${resource.id}`)
    .auth(adminToken, { type: 'bearer' })
    .send({ estado: 'PUBLICADO' });
  expect(publish.status).toBe(400);
  expect((await db.recurso_catalogo.findUniqueOrThrow({ where: { id: resource.id } })).estado).toBe('BORRADOR');
});

test('imagen AR se carga como borrador y solo aparece en catálogo al publicarse', async () => {
  const anonymous = await request(app.getHttpServer()).get('/api/catalog/ar-resources');
  expect(anonymous.status).toBe(401);
  const invalid = await request(app.getHttpServer())
    .post('/api/catalog/ar-resources')
    .auth(adminToken, { type: 'bearer' })
    .field('varianteId', variantId)
    .field('textoAlternativo', 'Camiseta marfil vista de frente')
    .field('licencia', 'Muestra propia de prueba')
    .attach('imagen', Buffer.from('contenido no PNG'), 'imagen.png');
  expect(invalid.status).toBe(400);

  const upload = await request(app.getHttpServer())
    .post('/api/catalog/ar-resources')
    .auth(adminToken, { type: 'bearer' })
    .field('varianteId', variantId)
    .field('textoAlternativo', 'Camiseta marfil vista de frente')
    .field('licencia', 'Muestra propia de prueba')
    .attach('imagen', 'apps/mobile/assets/camiseta-marfil-muestra.png');
  expect(upload.status).toBe(201);
  expect(upload.body.estado).toBe('BORRADOR');
  resourceId = upload.body.id;

  const findImage = async () => {
    const catalog = await request(app.getHttpServer()).get('/api/catalog');
    expect(catalog.status).toBe(200);
    return catalog.body.products
      .find((product: { id: string }) => product.id === productId)
      .variantes.find((variant: { id: string }) => variant.id === variantId).arImagePath;
  };
  expect(await findImage()).toBeNull();

  const publish = await request(app.getHttpServer())
    .patch(`/api/catalog/ar-resources/${resourceId}`)
    .auth(adminToken, { type: 'bearer' })
    .send({ estado: 'PUBLICADO' });
  expect(publish.status).toBe(200);
  const path = await findImage();
  expect(path).toMatch(/^\/assets\/catalog-ar\/.+\.png$/);
  const image = await request(app.getHttpServer()).get(path);
  expect(image.status).toBe(200);
  expect(image.headers['content-type']).toMatch(/image\/png/);

  const withdraw = await request(app.getHttpServer())
    .patch(`/api/catalog/ar-resources/${resourceId}`)
    .auth(adminToken, { type: 'bearer' })
    .send({ estado: 'BORRADOR' });
  expect(withdraw.status).toBe(200);
  expect(await findImage()).toBeNull();
});
