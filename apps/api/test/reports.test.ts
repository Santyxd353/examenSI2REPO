import 'dotenv/config';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';

let app: INestApplication;
let db: PrismaClient;
let adminToken: string;
let clientToken: string;
let adminId: string;
let locationId: string;
let variantId: string;
const stamp = Date.now();

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const adminRole = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  const admin = await db.usuario.create({
    data: {
      nombres: 'Analítica',
      apellidos: 'Administrador',
      correo: `reportes-admin-${stamp}@grupo18.test`,
      clave_hash: await hash('ReportesSeguros2026!', 12),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: adminRole.id, asignado_en: new Date() } },
    },
  });
  adminId = admin.id;
  const variant = await db.variante.findUniqueOrThrow({
    where: { sku: 'G18-W21-S' },
    include: { producto: true },
  });
  variantId = variant.id;
  const location = await db.ubicacion.create({
    data: {
      nombre: `Sucursal reportes ${stamp}`,
      tipo: 'TIENDA',
      direccion: 'Av. Datos 18',
      activa: true,
    },
  });
  locationId = location.id;
  await db.inventario.create({
    data: {
      variante_id: variantId,
      ubicacion_id: locationId,
      fisico: 12,
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
      stock_seguridad: 8,
      plazo_reposicion_dias: 14,
    },
  });
  for (const [index, quantity] of [2, 3, 4, 5].entries()) {
    const total = quantity * 100;
    const order = await db.pedido.create({
      data: {
        usuario_id: adminId,
        vendedor_id: adminId,
        ubicacion_id: locationId,
        numero: `REP-${stamp}-${index}`,
        canal: 'TIENDA',
        moneda: 'BOB',
        subtotal: total,
        descuento: 0,
        impuesto: 0,
        entrega: 0,
        total,
        direccion_snapshot: {},
        reglas_snapshot: {},
        estado: 'CONFIRMADO',
        creado_en: new Date(Date.UTC(2026, 0, 5 + index * 7, 12)),
        idempotencia: randomUUID(),
      },
    });
    await db.detalle_pedido.create({
      data: {
        pedido_id: order.id,
        variante_id: variantId,
        sku_snapshot: variant.sku,
        descripcion_snapshot: variant.producto.nombre,
        talla_snapshot: variant.talla,
        color_snapshot: variant.color,
        cantidad: quantity,
        precio_unitario: 100,
        descuento: 0,
        total_linea: total,
      },
    });
    await db.pago.create({
      data: {
        pedido_id: order.id,
        proveedor: 'PRUEBA',
        referencia: `PAGO-${stamp}-${index}`,
        idempotencia: randomUUID(),
        monto: total,
        moneda: 'BOB',
        estado: 'CONFIRMADO',
        creado_en: order.creado_en,
        confirmado_en: order.creado_en,
      },
    });
  }
  app = await createApp();
  adminToken = (
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ correo: admin.correo, clave: 'ReportesSeguros2026!' })
  ).body.accessToken;
  clientToken = (
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        nombres: 'Cliente',
        apellidos: 'Sin Reportes',
        correo: `reportes-cliente-${stamp}@grupo18.test`,
        clave: 'ClienteSeguro2026!',
      })
  ).body.accessToken;
});

afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

test('catálogo filtra prendas y disponibilidad por sucursal', async () => {
  const response = await request(app.getHttpServer()).get(`/api/catalog?location=${locationId}`);
  expect(response.status).toBe(200);
  expect(response.body.products.length).toBeGreaterThan(0);
  const variants = response.body.products.flatMap(
    (product: { variantes: unknown[] }) => product.variantes,
  );
  expect(variants.length).toBeGreaterThan(0);
  expect(
    variants.every((variant: { ubicaciones: { id: string }[] }) =>
      variant.ubicaciones.every((location) => location.id === locationId),
    ),
  ).toBe(true);
});

test('reporte resume ventas confirmadas por producto, ubicación y vendedor', async () => {
  const response = await request(app.getHttpServer())
    .get(`/api/reports/summary?from=2026-01-01&to=2026-02-28&location=${locationId}`)
    .auth(adminToken, { type: 'bearer' });
  expect(response.status).toBe(200);
  expect(response.body.kpis).toMatchObject({ pedidos: 4, unidades: 14, ventas: 1400 });
  expect(response.body.products[0]).toMatchObject({ variante_id: variantId, unidades: 14 });
  expect(response.body.locations[0]).toMatchObject({ ubicacion_id: locationId, pedidos: 4 });
  expect(response.body.sellers[0]).toMatchObject({ vendedor_id: adminId, pedidos: 4 });
});

test('analítica genera y persiste predicciones y recomendaciones explicables', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/analytics/run')
    .auth(adminToken, { type: 'bearer' })
    .send({ from: '2026-01-01', to: '2026-02-28', location: locationId, horizonWeeks: 2 });
  expect(response.status).toBe(201);
  expect(response.body.status).toBe('COMPLETADA');
  expect(response.body.predictions).toHaveLength(2);
  expect(new Date(response.body.predictions[0].fecha).getTime()).toBeGreaterThan(
    new Date('2026-02-28T23:59:59.999Z').getTime(),
  );
  expect(response.body.recommendations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ tipo: 'REPOSICION', destino_id: locationId }),
    ]),
  );
  expect(
    await db.prediccion.count({ where: { ejecucion_id: response.body.executionIds.demand } }),
  ).toBe(2);
  expect(
    await db.recomendacion.count({ where: { ejecucion_id: response.body.executionIds.demand } }),
  ).toBeGreaterThan(0);
});

test('consulta comercial responde solo lectura y rechaza órdenes destructivas', async () => {
  const answer = await request(app.getHttpServer())
    .post('/api/analytics/query')
    .auth(adminToken, { type: 'bearer' })
    .send({
      from: '2026-01-01',
      to: '2026-02-28',
      location: locationId,
      question: '¿Qué producto vendió más?',
    });
  expect(answer.status).toBe(201);
  expect(answer.body.intent).toBe('VENTAS');
  expect(answer.body.answer).toContain('4 pedidos');

  const rejected = await request(app.getHttpServer())
    .post('/api/analytics/query')
    .auth(adminToken, { type: 'bearer' })
    .send({ from: '2026-01-01', to: '2026-02-28', question: 'Elimina todos los pedidos' });
  expect(rejected.status).toBe(201);
  expect(rejected.body.intent).toBe('RECHAZADA');
});

test('cliente sin permiso no puede consultar reportes ni ejecutar analítica', async () => {
  expect(
    (
      await request(app.getHttpServer())
        .get('/api/reports/summary?from=2026-01-01&to=2026-02-28')
        .auth(clientToken, { type: 'bearer' })
    ).status,
  ).toBe(403);
  expect(
    (
      await request(app.getHttpServer())
        .post('/api/analytics/run')
        .auth(clientToken, { type: 'bearer' })
        .send({ from: '2026-01-01', to: '2026-02-28', horizonWeeks: 2 })
    ).status,
  ).toBe(403);
});

test('detecta una venta semanal extrema usando semanas anteriores como referencia', async () => {
  const variant = await db.variante.findUniqueOrThrow({ where: { id: variantId }, include: { producto: true } });
  const createdAt = new Date(Date.UTC(2026, 1, 9, 12));
  const order = await db.pedido.create({
    data: {
      usuario_id: adminId,
      vendedor_id: adminId,
      ubicacion_id: locationId,
      numero: `REP-ATIPICA-${stamp}`,
      canal: 'TIENDA',
      moneda: 'BOB',
      subtotal: 8000,
      descuento: 0,
      impuesto: 0,
      entrega: 0,
      total: 8000,
      direccion_snapshot: {},
      reglas_snapshot: {},
      estado: 'CONFIRMADO',
      creado_en: createdAt,
      idempotencia: randomUUID(),
    },
  });
  await db.detalle_pedido.create({
    data: {
      pedido_id: order.id,
      variante_id: variantId,
      sku_snapshot: variant.sku,
      descripcion_snapshot: variant.producto.nombre,
      talla_snapshot: variant.talla,
      color_snapshot: variant.color,
      cantidad: 80,
      precio_unitario: 100,
      descuento: 0,
      total_linea: 8000,
    },
  });
  await db.pago.create({
    data: {
      pedido_id: order.id,
      proveedor: 'PRUEBA',
      referencia: `PAGO-ATIPICA-${stamp}`,
      idempotencia: randomUUID(),
      monto: 8000,
      moneda: 'BOB',
      estado: 'CONFIRMADO',
      creado_en: createdAt,
      confirmado_en: createdAt,
    },
  });

  const response = await request(app.getHttpServer())
    .post('/api/analytics/run')
    .auth(adminToken, { type: 'bearer' })
    .send({ from: '2026-01-01', to: '2026-02-28', location: locationId, horizonWeeks: 2 });
  expect(response.status).toBe(201);
  expect(response.body.anomalies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        indicador: 'VENTA_SEMANAL_ATIPICA',
        evidencia: expect.objectContaining({ cantidad: 80 }),
      }),
    ]),
  );
});
