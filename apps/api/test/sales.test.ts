import 'dotenv/config';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';

let app: INestApplication;
let db: PrismaClient;
let sellerToken: string;
let clientToken: string;
let sellerId: string;
let locationId: string;
let variantId: string;
const stamp = Date.now();

async function createSaleVariant(
  options: {
    active?: boolean;
    productState?: string;
    storePrice?: number | null;
    discount?: number;
    storeChannel?: 'ENABLED' | 'DISABLED' | 'ABSENT' | 'OTHER_LOCATION';
    stock?: number;
  } = {},
) {
  const category = await db.categoria.findFirstOrThrow();
  const product = await db.producto.create({
    data: {
      categoria_id: category.id,
      nombre: `Prenda POS ${randomUUID()}`,
      descripcion: 'Prenda independiente para comprobar ventas presenciales.',
      material: 'Algodón',
      estado: options.productState ?? 'PUBLICADO',
      creado_en: new Date(),
    },
  });
  const variant = await db.variante.create({
    data: {
      producto_id: product.id,
      sku: `POS-${randomUUID()}`,
      talla: 'M',
      color: 'Azul',
      activa: options.active ?? true,
    },
  });
  await db.inventario.create({
    data: {
      variante_id: variant.id,
      ubicacion_id: locationId,
      fisico: options.stock ?? 20,
      reservado: 0,
      comprometido: 0,
      version: 1,
    },
  });
  await db.precio_canal.create({
    data: {
      variante_id: variant.id,
      canal: 'WEB',
      moneda: 'BOB',
      importe: 1,
      descuento_pct: 0,
      desde: new Date('2026-02-01T00:00:00Z'),
    },
  });
  if (options.storePrice !== null)
    await db.precio_canal.create({
      data: {
        variante_id: variant.id,
        canal: 'TIENDA',
        moneda: 'BOB',
        importe: options.storePrice ?? 100,
        descuento_pct: options.discount ?? 0,
        desde: new Date('2026-01-01T00:00:00Z'),
      },
    });
  await db.disponibilidad_canal.create({
    data: {
      variante_id: variant.id,
      ubicacion_id: locationId,
      canal: 'WEB',
      habilitada: true,
      stock_seguridad: 0,
      plazo_reposicion_dias: 0,
    },
  });
  if (options.storeChannel !== 'ABSENT') {
    const storeLocation =
      options.storeChannel === 'OTHER_LOCATION'
        ? await db.ubicacion.create({
            data: { nombre: `Otra tienda ${randomUUID()}`, tipo: 'TIENDA', activa: true },
          })
        : { id: locationId };
    await db.disponibilidad_canal.create({
      data: {
        variante_id: variant.id,
        ubicacion_id: storeLocation.id,
        canal: 'TIENDA',
        habilitada: options.storeChannel !== 'DISABLED',
        stock_seguridad: 0,
        plazo_reposicion_dias: 0,
      },
    });
  }
  return variant;
}

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const sellerRole = await db.rol.findUniqueOrThrow({ where: { nombre: 'Vendedor' } });
  const seller = await db.usuario.create({
    data: {
      nombres: 'Vendedor',
      apellidos: 'Mostrador',
      correo: `venta-${stamp}@grupo18.test`,
      clave_hash: await hash('VentaSegura2026!', 12),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: sellerRole.id, asignado_en: new Date() } },
    },
  });
  sellerId = seller.id;
  const location = await db.ubicacion.create({
    data: {
      nombre: `Caja ${stamp}`,
      tipo: 'TIENDA',
      direccion: 'Sucursal de prueba',
      activa: true,
    },
  });
  locationId = location.id;
  await db.usuario_ubicacion.create({
    data: { usuario_id: sellerId, ubicacion_id: locationId },
  });
  variantId = (await createSaleVariant({ stock: 5 })).id;
  app = await createApp();
  const sellerLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ correo: seller.correo, clave: 'VentaSegura2026!' });
  sellerToken = sellerLogin.body.accessToken;
  expect(sellerLogin.body.user.permissions).toContain('ventas:registrar');
  clientToken = (
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        nombres: 'Cliente',
        apellidos: 'Venta',
        correo: `cliente-venta-${stamp}@grupo18.test`,
        clave: 'ClienteSeguro2026!',
      })
  ).body.accessToken;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

test('vendedor solo recibe catálogo de sus ubicaciones asignadas', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/sales/context')
    .auth(sellerToken, { type: 'bearer' });
  expect(response.status).toBe(200);
  expect(response.body.map((item: { id: string }) => item.id)).toEqual([locationId]);
  expect(response.body[0].variants).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: variantId, available: 5 })]),
  );
});

test('venta confirma pago, descuenta stock y registra movimiento una sola vez', async () => {
  const idempotency = randomUUID();
  const payload = {
    locationId,
    customerName: 'Cliente de prueba',
    paymentMethod: 'EFECTIVO',
    idempotency,
    items: [{ variantId, quantity: 2 }],
  };
  const first = await request(app.getHttpServer())
    .post('/api/sales')
    .auth(sellerToken, { type: 'bearer' })
    .send(payload);
  expect(first.status).toBe(201);
  expect(first.body).toMatchObject({
    vendedor_id: sellerId,
    ubicacion_id: locationId,
    estado: 'CONFIRMADO',
  });
  expect(first.body.pago[0]).toMatchObject({ estado: 'CONFIRMADO', proveedor: 'POS_EFECTIVO' });

  const retry = await request(app.getHttpServer())
    .post('/api/sales')
    .auth(sellerToken, { type: 'bearer' })
    .send(payload);
  expect(retry.status).toBe(201);
  expect(retry.body.id).toBe(first.body.id);
  const inventory = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(inventory.fisico).toBe(3);
  expect(
    await db.movimiento_stock.count({ where: { pedido_id: first.body.id, tipo: 'SALIDA' } }),
  ).toBe(1);
});

test('stock insuficiente revierte pedido, pago y movimientos', async () => {
  const idempotency = randomUUID();
  const response = await request(app.getHttpServer())
    .post('/api/sales')
    .auth(sellerToken, { type: 'bearer' })
    .send({
      locationId,
      paymentMethod: 'EFECTIVO',
      idempotency,
      items: [{ variantId, quantity: 10 }],
    });
  expect(response.status).toBe(400);
  expect(await db.pedido.count({ where: { idempotencia: idempotency } })).toBe(0);
});

test('cliente no puede abrir el punto de venta ni registrar ventas', async () => {
  expect(
    (
      await request(app.getHttpServer())
        .get('/api/sales/context')
        .auth(clientToken, { type: 'bearer' })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app.getHttpServer())
        .post('/api/sales')
        .auth(clientToken, { type: 'bearer' })
        .send({})
    ).status,
  ).toBe(403);
});

test.each([
  { price: 99.99, discount: 10, unit: 89.99, total: 899.9 },
  { price: 1.01, discount: 50, unit: 0.51, total: 5.1 },
])(
  'venta redondea el precio TIENDA $price con descuento $discount antes de multiplicar',
  async ({ price, discount, unit, total }) => {
    const variant = await createSaleVariant({ storePrice: price, discount });
    const response = await request(app.getHttpServer())
      .post('/api/sales')
      .auth(sellerToken, { type: 'bearer' })
      .send({
        locationId,
        paymentMethod: 'EFECTIVO',
        idempotency: randomUUID(),
        items: [{ variantId: variant.id, quantity: 10 }],
      });
    expect(response.status).toBe(201);
    expect(Number(response.body.detalle_pedido[0].precio_unitario)).toBe(unit);
    expect(Number(response.body.detalle_pedido[0].total_linea)).toBe(total);
    expect(Number(response.body.total)).toBe(total);
    expect(Number(response.body.pago[0].monto)).toBe(total);
    const inventory = await db.inventario.findUniqueOrThrow({
      where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: locationId } },
    });
    expect(inventory.fisico).toBe(10);
    const context = await request(app.getHttpServer())
      .get('/api/sales/context')
      .auth(sellerToken, { type: 'bearer' });
    const offer = context.body[0].variants.find((item: { id: string }) => item.id === variant.id);
    expect(offer.price).toBe(unit);
  },
);

test.each([
  { name: 'variante inactiva', active: false, productState: 'PUBLICADO' },
  { name: 'prenda retirada', active: true, productState: 'RETIRADO' },
  { name: 'prenda borrador', active: true, productState: 'BORRADOR' },
])(
  'venta rechaza $name aunque el cliente conserve su identificador',
  async ({ active, productState }) => {
    const variant = await createSaleVariant({ active, productState });
    const idempotency = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/sales')
      .auth(sellerToken, { type: 'bearer' })
      .send({
        locationId,
        paymentMethod: 'QR',
        idempotency,
        items: [{ variantId: variant.id, quantity: 1 }],
      });
    expect(response.status).toBe(400);
    expect(await db.pedido.count({ where: { idempotencia: idempotency } })).toBe(0);
    const inventory = await db.inventario.findUniqueOrThrow({
      where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: locationId } },
    });
    expect(inventory.fisico).toBe(20);
  },
);

test.each(['DISABLED', 'ABSENT', 'OTHER_LOCATION'] as const)(
  'venta exige habilitación TIENDA en su ubicación: %s',
  async (storeChannel) => {
    const variant = await createSaleVariant({ storeChannel });
    const idempotency = randomUUID();
    const response = await request(app.getHttpServer())
      .post('/api/sales')
      .auth(sellerToken, { type: 'bearer' })
      .send({
        locationId,
        paymentMethod: 'QR',
        idempotency,
        items: [{ variantId: variant.id, quantity: 1 }],
      });
    expect(response.status).toBe(400);
    expect(await db.pedido.count({ where: { idempotencia: idempotency } })).toBe(0);
    const inventory = await db.inventario.findUniqueOrThrow({
      where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: locationId } },
    });
    expect(inventory.fisico).toBe(20);
    const context = await request(app.getHttpServer())
      .get('/api/sales/context')
      .auth(sellerToken, { type: 'bearer' });
    expect(context.body[0].variants.some((item: { id: string }) => item.id === variant.id)).toBe(
      false,
    );
  },
);

test('venta sin precio TIENDA no usa el precio WEB', async () => {
  const variant = await createSaleVariant({ storePrice: null });
  const idempotency = randomUUID();
  const response = await request(app.getHttpServer())
    .post('/api/sales')
    .auth(sellerToken, { type: 'bearer' })
    .send({
      locationId,
      paymentMethod: 'QR',
      idempotency,
      items: [{ variantId: variant.id, quantity: 1 }],
    });
  expect(response.status).toBe(400);
  expect(await db.pedido.count({ where: { idempotencia: idempotency } })).toBe(0);
  const context = await request(app.getHttpServer())
    .get('/api/sales/context')
    .auth(sellerToken, { type: 'bearer' });
  expect(context.body[0].variants.some((item: { id: string }) => item.id === variant.id)).toBe(
    false,
  );
});
