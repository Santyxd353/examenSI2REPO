import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { TenantRegistry } from '../src/tenancy/platform';

let app: INestApplication;
let db: PrismaClient;
let registry: TenantRegistry;
let userId = '';
let token = '';
let billingId = '';
let activeLocationIds: string[] = [];

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  const email = `subscription-${randomUUID()}@grupo18.test`;
  const user = await db.usuario.create({
    data: {
      nombres: 'Plan', apellidos: 'Test', correo: email,
      clave_hash: await hash('PruebaSegura2026!', 12), estado: 'ACTIVO', preferencias: {}, creado_en: new Date(),
      usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
    },
  });
  userId = user.id;
  activeLocationIds = (await db.ubicacion.findMany({
    where: { activa: true },
    select: { id: true },
  })).map((location) => location.id);
  if (activeLocationIds.length) {
    await db.ubicacion.updateMany({
      where: { id: { in: activeLocationIds } },
      data: { activa: false },
    });
  }
  app = await createApp();
  registry = app.get(TenantRegistry);
  const login = await request(app.getHttpServer()).post('/api/auth/login')
    .send({ correo: email, clave: 'PruebaSegura2026!' });
  token = login.body.accessToken;
});

afterAll(async () => {
  await registry?.pool.query(`UPDATE platform.subscription SET plan_code='piloto',status='ACTIVE',provider='NONE',current_period_end=NULL WHERE tenant_id=(SELECT id FROM platform.tenant WHERE slug='lumina')`);
  if (billingId) await registry?.pool.query(`DELETE FROM platform.billing_event WHERE external_id=$1`, [billingId]);
  if (activeLocationIds.length) {
    await db.ubicacion.updateMany({
      where: { id: { in: activeLocationIds } },
      data: { activa: true },
    });
  }
  if (userId) {
    await db.sesion.deleteMany({ where: { usuario_id: userId } });
    await db.usuario_rol.deleteMany({ where: { usuario_id: userId } });
    await db.usuario.deleteMany({ where: { id: userId } });
  }
  await app?.close();
  await db?.$disconnect();
});

test('publica precios exactos y confirma el plan TEST de forma idempotente', async () => {
  const plans = await request(app.getHttpServer()).get('/api/tenant/plans').auth(token, { type: 'bearer' });
  expect(plans.status).toBe(200);
  expect(plans.body.map((plan: { code: string; monthlyAmount: number }) => [plan.code, plan.monthlyAmount]))
    .toEqual([['esencial', 149], ['pro', 299], ['negocio', 599]]);

  billingId = randomUUID();
  const payload = { planCode: 'negocio', operationId: billingId };
  const first = await request(app.getHttpServer()).post('/api/tenant/subscription/test-confirm')
    .auth(token, { type: 'bearer' }).send(payload);
  const second = await request(app.getHttpServer()).post('/api/tenant/subscription/test-confirm')
    .auth(token, { type: 'bearer' }).send(payload);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(first.body).toMatchObject({ confirmed: true, provider: 'QR_SIMULATED', subscription: { plan: 'negocio' } });
  expect(await registry.pool.query(`SELECT count(*)::int AS count FROM platform.billing_event WHERE external_id=$1`, [billingId]).then((result) => result.rows[0].count)).toBe(1);
});
