import 'dotenv/config';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { removeStored } from '../src/storage';

let app: INestApplication;
let db: PrismaClient;
let adminId: string;
let customerId: string;
let productId: string;
let newLocationId: string;
const previousStorageRoot = process.env.STORAGE_ROOT;
const stamp = Date.now();
const brand = `Marca Prueba ${stamp}`;
const type = `Blusa Prueba ${stamp}`;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  process.env.STORAGE_ROOT = '.local/test-storage';
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  const admin = await db.usuario.create({
    data: {
      nombres: 'Admin',
      apellidos: 'Catálogo',
      correo: `admin-catalogo-${stamp}@grupo18.test`,
      clave_hash: await hash('PruebaSegura2026!', 12),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
    },
  });
  adminId = admin.id;
  app = await createApp();
});

afterAll(async () => {
  if (productId) {
    const photos = await db.recurso_catalogo.findMany({ where: { producto_id: productId } });
    await db.movimiento_stock.deleteMany({
      where: { inventario: { variante: { producto_id: productId } } },
    });
    await db.inventario.deleteMany({ where: { variante: { producto_id: productId } } });
    await db.disponibilidad_canal.deleteMany({ where: { variante: { producto_id: productId } } });
    await db.precio_canal.deleteMany({ where: { variante: { producto_id: productId } } });
    await db.recurso_catalogo.deleteMany({ where: { producto_id: productId } });
    await db.variante.deleteMany({ where: { producto_id: productId } });
    await db.producto.delete({ where: { id: productId } });
    await Promise.all(photos.map((photo) => removeStored(photo.clave_objeto)));
  }
  if (newLocationId) {
    await db.disponibilidad_canal.deleteMany({ where: { ubicacion_id: newLocationId } });
    await db.inventario.deleteMany({ where: { ubicacion_id: newLocationId } });
    await db.ubicacion.delete({ where: { id: newLocationId } });
  }
  await db.categoria.deleteMany({ where: { nombre: type } });
  for (const userId of [customerId, adminId].filter(Boolean)) {
    await db.auditoria.deleteMany({ where: { actor_id: userId } });
    await db.sesion.deleteMany({ where: { usuario_id: userId } });
    await db.usuario_rol.deleteMany({ where: { usuario_id: userId } });
    await db.usuario.delete({ where: { id: userId } });
  }
  await app?.close();
  await db?.$disconnect();
  if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT;
  else process.env.STORAGE_ROOT = previousStorageRoot;
});

test('cliente filtra talla, color y marca; prenda y fotos son comunes con stock separado', async () => {
  const admin = await db.usuario.findUniqueOrThrow({ where: { id: adminId } });
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ correo: admin.correo, clave: 'PruebaSegura2026!' });
  expect(login.status).toBe(201);
  const adminToken = login.body.accessToken;
  const customer = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      nombres: 'Cliente',
      apellidos: 'Filtro',
      correo: `cliente-${stamp}@grupo18.test`,
      clave: 'PruebaSegura2026!',
    });
  expect(customer.status).toBe(201);
  customerId = customer.body.user.id;
  const customerToken = customer.body.accessToken;
  expect(
    (
      await request(app.getHttpServer())
        .post('/api/catalog/garments')
        .auth(customerToken, { type: 'bearer' })
    ).status,
  ).toBe(403);

  const created = await request(app.getHttpServer())
    .post('/api/catalog/garments')
    .auth(adminToken, { type: 'bearer' })
    .field('nombre', `Blusa floral ${stamp}`)
    .field('descripcion', 'Blusa ligera de prueba con variantes de color y talla.')
    .field('material', 'Lino')
    .field('marca', brand)
    .field('tipoPrenda', type)
    .field('precio', '179.50')
    .field('licencia', 'Fotografías de prueba propias')
    .field(
      'variantes',
      JSON.stringify([
        { talla: 'S', color: 'Rosado', colorHex: '#ff88aa' },
        { talla: 'M', color: 'Azul', colorHex: '#3355aa' },
      ]),
    )
    .attach('fotos', 'apps/mobile/assets/camiseta-marfil-muestra.png')
    .attach('fotos', 'apps/mobile/assets/camiseta-marfil-muestra.png');
  expect(created.status).toBe(201);
  productId = created.body.id;
  expect(created.body.fotos).toBe(2);
  const firstLocation = await db.ubicacion.findFirstOrThrow({ where: { activa: true } });
  const storePrices = await db.precio_canal.findMany({
    where: { variante: { producto_id: productId }, canal: 'TIENDA' },
  });
  const storeAvailability = await db.disponibilidad_canal.findMany({
    where: {
      variante: { producto_id: productId },
      ubicacion_id: firstLocation.id,
      canal: 'TIENDA',
    },
  });
  expect(storePrices).toHaveLength(2);
  expect(storeAvailability).toHaveLength(2);
  expect(storeAvailability.every((policy) => policy.habilitada)).toBe(true);
  const path = `/api/catalog?location=${firstLocation.id}&brand=${encodeURIComponent(brand)}&color=Rosado&size=S`;
  const matching = await request(app.getHttpServer()).get(path);
  expect(matching.status).toBe(200);
  expect(matching.body.products).toHaveLength(1);
  expect(matching.body.products[0].variantes).toHaveLength(1);
  expect(matching.body.products[0].variantes[0].disponible).toBe(0);
  expect(matching.body.products[0].imagenes).toHaveLength(2);
  expect(
    (await request(app.getHttpServer()).get(matching.body.products[0].imagenes[0].url)).status,
  ).toBe(200);
  expect(matching.body.filters.brands).toContain(brand);
  const searchedByBrand = await request(app.getHttpServer()).get(
    `/api/catalog?search=${encodeURIComponent(brand)}`,
  );
  expect(searchedByBrand.status).toBe(200);
  expect(
    searchedByBrand.body.products.some((product: { id: string }) => product.id === productId),
  ).toBe(true);
  expect(
    (
      await request(app.getHttpServer()).get(
        `/api/catalog?brand=${encodeURIComponent(brand)}&color=Rosado&size=M`,
      )
    ).body.products,
  ).toHaveLength(0);

  const nextLocation = await request(app.getHttpServer())
    .post('/api/locations')
    .auth(adminToken, { type: 'bearer' })
    .send({ nombre: `Sucursal prueba ${stamp}`, tipo: 'TIENDA', direccion: 'Calle de prueba 123' });
  expect(nextLocation.status).toBe(201);
  newLocationId = nextLocation.body.id;
  const nextCatalog = await request(app.getHttpServer()).get(
    `/api/catalog?location=${newLocationId}&brand=${encodeURIComponent(brand)}`,
  );
  expect(nextCatalog.body.products[0].variantes).toHaveLength(2);
  expect(
    nextCatalog.body.products[0].variantes.every(
      (variant: { disponible: number }) => variant.disponible === 0,
    ),
  ).toBe(true);

  const adjustment = await request(app.getHttpServer())
    .post(`/api/locations/${firstLocation.id}/inventory/adjustments`)
    .auth(adminToken, { type: 'bearer' })
    .send({
      varianteId: matching.body.products[0].variantes[0].id,
      delta: 5,
      motivo: 'Carga inicial de prueba',
    });
  expect(adjustment.status).toBe(201);
  expect(
    (await request(app.getHttpServer()).get(path)).body.products[0].variantes[0].disponible,
  ).toBe(5);
  expect(
    (
      await request(app.getHttpServer()).get(
        `/api/catalog?location=${newLocationId}&brand=${encodeURIComponent(brand)}`,
      )
    ).body.products[0].variantes[0].disponible,
  ).toBe(0);
});
