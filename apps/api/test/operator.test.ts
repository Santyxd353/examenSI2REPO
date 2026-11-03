import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hash } from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { Client } from 'pg';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { AuthService } from '../src/auth';
import { TenantRegistry, DEFAULT_TENANT_ID } from '../src/tenancy/platform';

let app: INestApplication, registry: TenantRegistry;
let token: string, customerToken: string;
let tenant: { id: string; slug: string } | undefined;
const slug = `operada-${randomUUID().replaceAll('-', '').slice(0, 14)}`;
const old = {
  user: process.env.PLATFORM_OPERATOR_USERNAME,
  hash: process.env.PLATFORM_OPERATOR_PASSWORD_HASH,
  key: process.env.PLATFORM_OPERATOR_JWT_SECRET,
};
beforeAll(async () => {
  process.env.PLATFORM_OPERATOR_USERNAME = 'operadora-qa';
  process.env.PLATFORM_OPERATOR_PASSWORD_HASH = await hash('Plataforma2026!QA', 10);
  process.env.PLATFORM_OPERATOR_JWT_SECRET = randomBytes(48).toString('hex');
  app = await createApp();
  registry = app.get(TenantRegistry);
  customerToken = (
    await app
      .get(AuthService)
      .mobileRegister({
        nombres: 'Clienta',
        apellidos: 'Sin control',
        correo: `${slug}@qa.test`,
        clave: 'ClientaSegura2026!',
      })
  ).accessToken;
}, 30000);
afterAll(async () => {
  let database: string | undefined;
  if (tenant) {
    database = (
      await registry.pool.query('SELECT database_name FROM platform.tenant WHERE id=$1', [
        tenant.id,
      ])
    ).rows[0]?.database_name;
    await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [tenant.id]);
    await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [tenant.id]);
    await registry.pool.query('DELETE FROM platform.tenant WHERE id=$1', [tenant.id]);
  }
  await app?.close();
  if (database) {
    if (!/^store_[a-f0-9]{32}$/.test(database)) throw new Error('Base de limpieza no autorizada.');
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`DROP DATABASE "${database}"`);
    await db.end();
  }
  for (const [key, value] of Object.entries({
    PLATFORM_OPERATOR_USERNAME: old.user,
    PLATFORM_OPERATOR_PASSWORD_HASH: old.hash,
    PLATFORM_OPERATOR_JWT_SECRET: old.key,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}, 30000);

test('login global rechaza contraseña incorrecta y emite token de control separado', async () => {
  const bad = await request(app.getHttpServer())
    .post('/api/platform/operator/login')
    .send({ username: 'operadora-qa', password: 'ContraseñaIncorrecta' });
  expect(bad.status).toBe(401);
  const response = await request(app.getHttpServer())
    .post('/api/platform/operator/login')
    .send({ username: 'operadora-qa', password: 'Plataforma2026!QA' });
  expect(response.status).toBe(201);
  expect(response.body.scope).toBe('PLATFORM_OPERATOR');
  token = response.body.accessToken;
  expect(typeof token).toBe('string');
});

test('identidad comercial no consulta control y token global no inicia sesión en tienda', async () => {
  const denied = await request(app.getHttpServer())
    .get('/api/platform/operator/tenants')
    .auth(customerToken, { type: 'bearer' });
  expect(denied.status).toBe(401);
  const commercial = await request(app.getHttpServer())
    .get('/api/tenant/subscription')
    .auth(token, { type: 'bearer' });
  expect(commercial.status).toBe(401);
});

test('provisión global crea tienda real en prueba y no devuelve conexión o contraseñas', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/platform/operator/tenants')
    .auth(token, { type: 'bearer' })
    .send({
      slug,
      name: 'Tienda Operada QA',
      ownerEmail: `${slug}@qa.test`,
      ownerPassword: 'PropietariaSegura2026!',
      planCode: 'pro',
    });
  expect(response.status).toBe(201);
  tenant = response.body.tenant;
  expect(tenant?.slug).toBe(slug);
  expect(response.body.tenant.state).toBe('TRIAL');
  expect(JSON.stringify(response.body)).not.toMatch(
    /postgresql|clave_hash|ownerPassword|PropietariaSegura/,
  );
  const login = await request(app.getHttpServer())
    .post('/api/auth/mobile/login')
    .set('X-Tenant-Slug', slug)
    .send({ correo: `${slug}@qa.test`, clave: 'PropietariaSegura2026!' });
  expect(login.status).toBe(201);
  expect(login.body.user.roles).toContain('Administrador');
}, 30000);

test('operación global sigue disponible si Lúmina está suspendida, sin abrir sus datos', async () => {
  await registry.pool.query("UPDATE platform.tenant SET state='SUSPENDED' WHERE id=$1", [
    DEFAULT_TENANT_ID,
  ]);
  try {
    const response = await request(app.getHttpServer())
      .get('/api/platform/operator/tenants')
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.tenants)).toBe(true);
    expect(JSON.stringify(response.body)).not.toMatch(
      /database_name|postgresql|stripe_customer_id/,
    );
    const catalog = await request(app.getHttpServer()).get('/api/catalog');
    expect(catalog.status).toBe(403);
  } finally {
    await registry.pool.query("UPDATE platform.tenant SET state='ACTIVE' WHERE id=$1", [
      DEFAULT_TENANT_ID,
    ]);
  }
});
