import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { createHash, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import request from 'supertest';
import { createApp } from '../src/app';
import { removeStored } from '../src/storage';

let app: INestApplication;
let db: PrismaClient;
let adminId = '';
let productId = '';
let token = '';
const deviceId = randomUUID();
const operationIds: string[] = [];
const imagePath = 'apps/mobile/assets/camiseta-marfil-muestra.png';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  process.env.STORAGE_ROOT = '.local/test-storage';
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  const email = `offline-catalog-${randomUUID()}@grupo18.test`;
  const admin = await db.usuario.create({
    data: {
      nombres: 'Admin', apellidos: 'Offline', correo: email,
      clave_hash: await hash('PruebaSegura2026!', 12), estado: 'ACTIVO', preferencias: {}, creado_en: new Date(),
      usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
    },
  });
  adminId = admin.id;
  app = await createApp();
  const login = await request(app.getHttpServer()).post('/api/auth/login')
    .send({ correo: email, clave: 'PruebaSegura2026!' });
  expect(login.status).toBe(201);
  token = login.body.accessToken;
});

afterAll(async () => {
  if (productId) {
    const resources = await db.recurso_catalogo.findMany({ where: { producto_id: productId } });
    await db.movimiento_stock.deleteMany({ where: { inventario: { variante: { producto_id: productId } } } });
    await db.inventario.deleteMany({ where: { variante: { producto_id: productId } } });
    await db.disponibilidad_canal.deleteMany({ where: { variante: { producto_id: productId } } });
    await db.precio_canal.deleteMany({ where: { variante: { producto_id: productId } } });
    await db.recurso_catalogo.deleteMany({ where: { producto_id: productId } });
    await db.variante.deleteMany({ where: { producto_id: productId } });
    await db.producto.deleteMany({ where: { id: productId } });
    await db.$executeRawUnsafe(`DELETE FROM offline_entity_version WHERE entity_type='PRODUCT' AND entity_id=$1::uuid`, productId);
    await Promise.all(resources.map((resource) => removeStored(resource.clave_objeto)));
  }
  for (const operationId of operationIds)
    await db.$executeRawUnsafe(`DELETE FROM offline_sync_receipt WHERE operation_id=$1::uuid`, operationId);
  if (adminId) {
    await db.sesion.deleteMany({ where: { usuario_id: adminId } });
    await db.usuario_rol.deleteMany({ where: { usuario_id: adminId } });
    await db.usuario.deleteMany({ where: { id: adminId } });
  }
  await app?.close();
  await db?.$disconnect();
});

test('crea, edita, adjunta y archiva catálogo offline de forma idempotente', async () => {
  const category = await db.categoria.findFirstOrThrow({ where: { activa: true } });
  productId = randomUUID();
  const firstVariant = randomUUID();
  const secondVariant = randomUUID();
  const product = {
    id: productId,
    nombre: 'Vestido offline de prueba',
    categoriaId: category.id,
    descripcion: 'Vestido creado durante una prueba de sincronización offline.',
    material: 'Algodón',
    marca: 'Lúmina QA',
    archived: false,
    variants: [{ id: firstVariant, talla: 'M', color: 'Verde', priceCents: 25990 }],
  };
  const createId = randomUUID(); operationIds.push(createId);
  const created = await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send({
    deviceId,
    operations: [{ operationId: createId, kind: 'CATALOG_CREATE', baseVersion: null, payload: JSON.stringify({ product, archived: false }) }],
  });
  expect(created.status).toBe(201);
  expect(created.body.receipts).toEqual([{ operationId: createId, status: 'APPLIED', serverVersion: 1 }]);

  const updateId = randomUUID(); operationIds.push(updateId);
  const updatedProduct = {
    ...product,
    nombre: 'Vestido offline editado',
    variants: [...product.variants, { id: secondVariant, talla: 'L', color: 'Azul', priceCents: 27990 }],
  };
  const updateBody = {
    deviceId,
    operations: [{ operationId: updateId, kind: 'CATALOG_UPDATE', baseVersion: 1, payload: JSON.stringify({ product: updatedProduct, archived: false }) }],
  };
  const updated = await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send(updateBody);
  expect(updated.body.receipts[0]).toEqual({ operationId: updateId, status: 'APPLIED', serverVersion: 2 });
  const repeated = await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send(updateBody);
  expect(repeated.body.receipts).toEqual(updated.body.receipts);
  expect(await db.variante.count({ where: { producto_id: productId, activa: true } })).toBe(2);

  const bytes = await readFile(imagePath);
  const resourceId = randomUUID();
  const resource = () => request(app.getHttpServer()).post('/api/offline/resources').auth(token, { type: 'bearer' })
    .field('clientResourceId', resourceId)
    .field('productId', productId)
    .field('sha256', createHash('sha256').update(bytes).digest('hex'))
    .field('usage', 'GALLERY')
    .field('license', 'Imagen propia para prueba automatizada')
    .attach('file', imagePath);
  expect((await resource()).body.state).toBe('STAGED');
  expect((await resource()).body.resourceId).toBe(resourceId);
  expect(await db.recurso_catalogo.count({ where: { id: resourceId } })).toBe(1);

  const admin = await request(app.getHttpServer()).get('/api/catalog/admin').auth(token, { type: 'bearer' });
  const listed = admin.body.products.find((entry: { id: string }) => entry.id === productId);
  expect(listed.version).toBe(2);
  expect(listed.variants).toHaveLength(2);
  expect(listed.attachments).toHaveLength(1);

  const inventory = await db.inventario.findFirstOrThrow({ where: { variante_id: firstVariant } });
  await db.inventario.update({
    where: { id: inventory.id },
    data: { fisico: 10, reservado: 0, comprometido: 0, version: 1 },
  });
  const webDelta = await request(app.getHttpServer())
    .post(`/api/locations/${inventory.ubicacion_id}/inventory/adjustments`)
    .auth(token, { type: 'bearer' })
    .send({ varianteId: firstVariant, delta: -2, motivo: 'Venta concurrente de prueba' });
  expect(webDelta.status).toBe(201);

  const deltaId = randomUUID(); operationIds.push(deltaId);
  const deltaBody = {
    deviceId,
    operations: [{
      operationId: deltaId,
      kind: 'STOCK_DELTA',
      baseVersion: 1,
      payload: JSON.stringify({ locationId: inventory.ubicacion_id, variantId: firstVariant, delta: 3, reason: 'Recepción offline de prueba' }),
    }],
  };
  const delta = await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send(deltaBody);
  expect(delta.body.receipts[0]).toMatchObject({ operationId: deltaId, status: 'APPLIED' });
  expect((await db.inventario.findUniqueOrThrow({ where: { id: inventory.id } })).fisico).toBe(11);
  await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send(deltaBody);
  expect((await db.inventario.findUniqueOrThrow({ where: { id: inventory.id } })).fisico).toBe(11);

  const staleVersion = delta.body.receipts[0].serverVersion;
  await request(app.getHttpServer())
    .post(`/api/locations/${inventory.ubicacion_id}/inventory/adjustments`)
    .auth(token, { type: 'bearer' })
    .send({ varianteId: firstVariant, delta: -1, motivo: 'Segunda venta concurrente' });
  const countId = randomUUID(); operationIds.push(countId);
  const staleCount = await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send({
    deviceId,
    operations: [{
      operationId: countId,
      kind: 'STOCK_COUNT',
      baseVersion: staleVersion,
      payload: JSON.stringify({ locationId: inventory.ubicacion_id, variantId: firstVariant, observedPhysical: 12, reason: 'Conteo físico offline de prueba' }),
    }],
  });
  expect(staleCount.body.receipts[0]).toMatchObject({ operationId: countId, status: 'CONFLICT' });
  expect((await db.inventario.findUniqueOrThrow({ where: { id: inventory.id } })).fisico).toBe(10);

  const archiveId = randomUUID(); operationIds.push(archiveId);
  const archived = await request(app.getHttpServer()).post('/api/offline/sync').auth(token, { type: 'bearer' }).send({
    deviceId,
    operations: [{ operationId: archiveId, kind: 'CATALOG_ARCHIVE', baseVersion: 2, payload: JSON.stringify({ product: { ...updatedProduct, archived: true }, archived: true }) }],
  });
  expect(archived.body.receipts[0]).toEqual({ operationId: archiveId, status: 'APPLIED', serverVersion: 3 });
  expect((await db.producto.findUniqueOrThrow({ where: { id: productId } })).estado).toBe('RETIRADO');
  expect(await db.variante.count({ where: { producto_id: productId, activa: true } })).toBe(0);
});
