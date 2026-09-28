import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';

let app: INestApplication;
let db: PrismaClient;
let adminToken: string;
let customerToken: string;
let locationId: string;
let variantId: string;
const stamp = Date.now();

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  const admin = await db.usuario.create({
    data: {
      nombres: 'Admin',
      apellidos: 'Ventas',
      correo: `admin-ventas-${stamp}@grupo18.test`,
      clave_hash: await hash('AdminVentas2026!', 12),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
    },
  });
  const location = await db.ubicacion.create({
    data: { nombre: `Sucursal canales ${stamp}`, tipo: 'TIENDA', activa: true },
  });
  locationId = location.id;
  variantId = (await db.variante.findUniqueOrThrow({ where: { sku: 'G18-W21-S' } })).id;
  await db.inventario.create({
    data: {
      variante_id: variantId,
      ubicacion_id: locationId,
      fisico: 10,
      reservado: 0,
      comprometido: 0,
      version: 0,
    },
  });
  await db.disponibilidad_canal.createMany({
    data: (['WEB', 'APP', 'TIENDA'] as const).map((canal) => ({
      variante_id: variantId,
      ubicacion_id: locationId,
      canal,
      habilitada: true,
      stock_seguridad: 0,
      plazo_reposicion_dias: 0,
    })),
  });
  app = await createApp();
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ correo: admin.correo, clave: 'AdminVentas2026!' });
  expect(login.status).toBe(201);
  adminToken = login.body.accessToken;
  const registration = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({
      nombres: 'Cliente',
      apellidos: 'Canales',
      correo: `cliente-canales-${stamp}@grupo18.test`,
      clave: 'ClienteSeguro2026!',
    });
  expect(registration.status).toBe(201);
  customerToken = registration.body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});

test('compras WEB y APP y venta TIENDA se guardan y aparecen en pedidos y estadísticas del administrador', async () => {
  const orderIds: string[] = [];
  let expectedTotal = 0;
  for (const channel of ['WEB', 'APP'] as const) {
    const headers = channel === 'APP' ? { 'X-Client-Channel': 'APP' } : {};
    const cart = await request(app.getHttpServer())
      .post('/api/commerce/cart/items')
      .set(headers)
      .auth(customerToken, { type: 'bearer' })
      .send({ variantId, quantity: 1 });
    expect(cart.status).toBe(201);
    const checkout = await request(app.getHttpServer())
      .post('/api/commerce/checkout')
      .set(headers)
      .auth(customerToken, { type: 'bearer' })
      .send({ locationId, address: 'Calle de prueba 123, La Paz', idempotency: randomUUID() });
    expect(checkout.status).toBe(201);
    expect(checkout.body.canal).toBe(channel);
    const payment = await request(app.getHttpServer())
      .post(`/api/commerce/orders/${checkout.body.id}/payment`)
      .set(headers)
      .auth(customerToken, { type: 'bearer' })
      .send({ decision: 'APROBAR', idempotency: randomUUID() });
    expect(payment.status).toBe(201);
    expect(payment.body.estado).toBe('CONFIRMADO');
    expect(payment.body.pago[0].estado).toBe('CONFIRMADO');
    orderIds.push(payment.body.id);
    expectedTotal += Number(payment.body.total);
  }

  const sale = await request(app.getHttpServer())
    .post('/api/sales')
    .auth(adminToken, { type: 'bearer' })
    .send({
      locationId,
      paymentMethod: 'QR',
      idempotency: randomUUID(),
      items: [{ variantId, quantity: 1 }],
    });
  expect(sale.status).toBe(201);
  expect(sale.body).toMatchObject({ canal: 'TIENDA', estado: 'CONFIRMADO' });
  expect(sale.body.pago[0].estado).toBe('CONFIRMADO');
  orderIds.push(sale.body.id);
  expectedTotal += Number(sale.body.total);

  const orders = await request(app.getHttpServer())
    .get('/api/admin/orders')
    .auth(adminToken, { type: 'bearer' });
  expect(orders.status).toBe(200);
  expect(orders.body.filter((order: { id: string }) => orderIds.includes(order.id))).toHaveLength(3);

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const report = await request(app.getHttpServer())
    .get(`/api/reports/summary?from=${yesterday}&to=${tomorrow}&location=${locationId}`)
    .auth(adminToken, { type: 'bearer' });
  expect(report.status).toBe(200);
  expect(report.body.kpis).toMatchObject({ pedidos: 3, unidades: 3, ventas: expectedTotal });
  expect(report.body.products).toEqual(
    expect.arrayContaining([expect.objectContaining({ variante_id: variantId, unidades: 3 })]),
  );
  expect(report.body.locations).toEqual(
    expect.arrayContaining([expect.objectContaining({ ubicacion_id: locationId, pedidos: 3 })]),
  );
  const inventory = await db.inventario.findUniqueOrThrow({
    where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: locationId } },
  });
  expect(inventory.fisico).toBe(7);
  expect(inventory.reservado).toBe(0);
});
