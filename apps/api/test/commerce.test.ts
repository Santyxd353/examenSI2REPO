import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';

let app: INestApplication;
let db: PrismaClient;
let token: string;
let locationId: string;
let variantId: string;
const stamp = Date.now();

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  variantId = (await db.variante.findUniqueOrThrow({ where: { sku: 'G18-W21-S' } })).id;
  const location = await db.ubicacion.create({
    data: { nombre: `Web ${stamp}`, tipo: 'TIENDA', direccion: 'Prueba comercio', activa: true },
  });
  locationId = location.id;
  await db.inventario.create({
    data: {
      variante_id: variantId,
      ubicacion_id: locationId,
      fisico: 4,
      reservado: 0,
      comprometido: 0,
      version: 1,
    },
  });
  await db.disponibilidad_canal.create({
    data: {
      variante_id: variantId,
      ubicacion_id: locationId,
      canal: 'WEB',
      habilitada: true,
      stock_seguridad: 0,
      plazo_reposicion_dias: 1,
    },
  });
  await db.disponibilidad_canal.create({
    data: {
      variante_id: variantId,
      ubicacion_id: locationId,
      canal: 'APP',
      habilitada: true,
      stock_seguridad: 0,
      plazo_reposicion_dias: 1,
    },
  });
  app = await createApp();
  const login = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      nombres: 'Cliente',
      apellidos: 'Comercio',
      correo: `comercio-${stamp}@grupo18.test`,
      clave: 'ClienteSeguro2026!',
    });
  expect(login.status).toBe(201);
  token = login.body.accessToken;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

test('carrito, reserva, pago simulado e idempotencia', async () => {
  const add = await request(app.getHttpServer())
    .post('/api/commerce/cart/items')
    .auth(token, { type: 'bearer' })
    .send({ variantId, quantity: 2 });
  expect(add.status).toBe(201);
  expect(add.body.item_carrito[0].cantidad).toBe(2);
  const idempotency = randomUUID();
  const payload = { locationId, address: 'Calle de prueba 123, La Paz', idempotency };
  const checkout = await request(app.getHttpServer())
    .post('/api/commerce/checkout')
    .auth(token, { type: 'bearer' })
    .send(payload);
  expect(checkout.status).toBe(201);
  expect(checkout.body.estado).toBe('PENDIENTE_PAGO');
  expect(checkout.body.detalle_pedido[0].reserva_stock[0].estado).toBe('ACTIVA');
  const inventory = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(inventory.reservado).toBe(2);
  const retry = await request(app.getHttpServer())
    .post('/api/commerce/checkout')
    .auth(token, { type: 'bearer' })
    .send(payload);
  expect(retry.body.id).toBe(checkout.body.id);
  const payId = randomUUID();
  const payment = await request(app.getHttpServer())
    .post(`/api/commerce/orders/${checkout.body.id}/payment`)
    .auth(token, { type: 'bearer' })
    .send({ decision: 'APROBAR', idempotency: payId });
  expect(payment.status).toBe(201);
  expect(payment.body.estado).toBe('CONFIRMADO');
  expect(payment.body.pago[0].estado).toBe('CONFIRMADO');
  const payRetry = await request(app.getHttpServer())
    .post(`/api/commerce/orders/${checkout.body.id}/payment`)
    .auth(token, { type: 'bearer' })
    .send({ decision: 'APROBAR', idempotency: payId });
  expect(payRetry.body.estado).toBe('CONFIRMADO');
  const stock = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(stock.fisico).toBe(2);
  expect(stock.reservado).toBe(0);
  const returned = await request(app.getHttpServer())
    .post(`/api/commerce/orders/${checkout.body.id}/returns`)
    .auth(token, { type: 'bearer' })
    .send({
      reason: 'La talla no me queda bien',
      items: [{ detailId: checkout.body.detalle_pedido[0].id, quantity: 1 }],
    });
  expect(returned.status).toBe(201);
  expect(returned.body.estado).toBe('SOLICITADA');
});

test('un pago rechazado libera la reserva', async () => {
  await request(app.getHttpServer())
    .post('/api/commerce/cart/items')
    .auth(token, { type: 'bearer' })
    .send({ variantId, quantity: 1 });
  const checkout = await request(app.getHttpServer())
    .post('/api/commerce/checkout')
    .auth(token, { type: 'bearer' })
    .send({ locationId, address: 'Calle de prueba 123, La Paz', idempotency: randomUUID() });
  expect(checkout.status).toBe(201);
  const payment = await request(app.getHttpServer())
    .post(`/api/commerce/orders/${checkout.body.id}/payment`)
    .auth(token, { type: 'bearer' })
    .send({ decision: 'RECHAZAR', idempotency: randomUUID() });
  expect(payment.body.estado).toBe('CANCELADO');
  const stock = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(stock.reservado).toBe(0);
  expect(stock.fisico).toBe(2);
});

test('una reserva vencida cancela el pedido y devuelve el stock disponible', async () => {
  await request(app.getHttpServer())
    .post('/api/commerce/cart/items')
    .auth(token, { type: 'bearer' })
    .send({ variantId, quantity: 1 });
  const checkout = await request(app.getHttpServer())
    .post('/api/commerce/checkout')
    .auth(token, { type: 'bearer' })
    .send({ locationId, address: 'Calle de prueba 123, La Paz', idempotency: randomUUID() });
  expect(checkout.status).toBe(201);
  await db.reserva_stock.updateMany({
    where: { detalle_pedido_id: checkout.body.detalle_pedido[0].id },
    data: {
      creada_en: new Date(Date.now() - 20 * 60_000),
      vence_en: new Date(Date.now() - 5 * 60_000),
    },
  });
  const orders = await request(app.getHttpServer())
    .get('/api/commerce/orders')
    .auth(token, { type: 'bearer' });
  expect(orders.status).toBe(200);
  expect(orders.body.find((row: { id: string }) => row.id === checkout.body.id).estado).toBe(
    'CANCELADO',
  );
  const stock = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(stock.reservado).toBe(0);
  expect(stock.fisico).toBe(2);
});

test('la aplicación mantiene carrito y pedidos separados del canal web', async () => {
  const appHeaders = { 'X-Client-Channel': 'APP' };
  const add = await request(app.getHttpServer())
    .post('/api/commerce/cart/items')
    .set(appHeaders)
    .auth(token, { type: 'bearer' })
    .send({ variantId, quantity: 1 });
  expect(add.status).toBe(201);
  expect(add.body.canal).toBe('APP');
  expect(add.body.item_carrito[0].cantidad).toBe(1);

  const webCart = await request(app.getHttpServer())
    .get('/api/commerce/cart')
    .auth(token, { type: 'bearer' });
  expect(webCart.status).toBe(200);
  expect(webCart.body.canal).toBe('WEB');
  expect(webCart.body.item_carrito).toHaveLength(0);

  const profile = await request(app.getHttpServer())
    .post('/api/profile/addresses')
    .set(appHeaders)
    .auth(token, { type: 'bearer' })
    .send({
      alias: 'Casa móvil',
      destinatario: 'Cliente Comercio',
      telefono: '+591 70000002',
      ciudad: 'La Paz',
      zona: 'Centro',
      detalle: 'Calle de prueba número 789',
      predeterminada: true,
    });
  expect(profile.status).toBe(201);
  const addressId = profile.body.direccion[0].id as string;

  const checkout = await request(app.getHttpServer())
    .post('/api/commerce/checkout')
    .set(appHeaders)
    .auth(token, { type: 'bearer' })
    .send({
      locationId,
      addressId,
      address: 'Cliente Comercio. La Paz, Centro. Calle de prueba número 789',
      idempotency: randomUUID(),
    });
  expect(checkout.status).toBe(201);
  expect(checkout.body.canal).toBe('APP');
  expect(checkout.body.numero).toMatch(/^APP-/);
  expect(checkout.body.pago[0].proveedor).toBe('SIMULADO_APP');
  expect(checkout.body.direccion_snapshot).toMatchObject({
    direccionId: addressId,
    alias: 'Casa móvil',
    ciudad: 'La Paz',
  });

  const payment = await request(app.getHttpServer())
    .post(`/api/commerce/orders/${checkout.body.id}/payment`)
    .set(appHeaders)
    .auth(token, { type: 'bearer' })
    .send({ decision: 'RECHAZAR', idempotency: randomUUID() });
  expect(payment.status).toBe(201);
  expect(payment.body.estado).toBe('CANCELADO');

  const appOrders = await request(app.getHttpServer())
    .get('/api/commerce/orders')
    .set(appHeaders)
    .auth(token, { type: 'bearer' });
  expect(appOrders.status).toBe(200);
  expect(appOrders.body.some((row: { id: string }) => row.id === checkout.body.id)).toBe(true);
  expect(appOrders.body.every((row: { canal: string }) => row.canal === 'APP')).toBe(true);

  const stock = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(stock.fisico).toBe(2);
  expect(stock.reservado).toBe(0);
});
