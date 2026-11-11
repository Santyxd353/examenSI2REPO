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
let token: string, customerToken: string, ownerToken: string;
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
    await app.get(AuthService).mobileRegister({
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
  const trialEnd = Date.parse(response.body.tenant.trialEndsAt);
  expect(trialEnd - Date.now()).toBeGreaterThan(13.99 * 86400000);
  expect(trialEnd - Date.now()).toBeLessThan(14.01 * 86400000);
  expect(JSON.stringify(response.body)).not.toMatch(
    /postgresql|clave_hash|ownerPassword|PropietariaSegura/,
  );
  const login = await request(app.getHttpServer())
    .post('/api/auth/mobile/login')
    .set('X-Tenant-Slug', slug)
    .send({ correo: `${slug}@qa.test`, clave: 'PropietariaSegura2026!' });
  expect(login.status).toBe(201);
  expect(login.body.user.roles).toContain('Administrador');
  ownerToken = login.body.accessToken;
  const database = (
    await registry.pool.query('SELECT database_name FROM platform.tenant WHERE id=$1', [tenant!.id])
  ).rows[0].database_name;
  const check = new Client({ connectionString: registry.databaseUrlFor(database) });
  await check.connect();
  try {
    const counts = (
      await check.query(
        'SELECT (SELECT count(*) FROM producto)::int AS products,(SELECT count(*) FROM usuario)::int AS users,(SELECT count(*) FROM ubicacion)::int AS locations',
      )
    ).rows[0];
    expect(counts).toEqual({ products: 0, users: 1, locations: 1 });
    expect((await check.query('SELECT nombre FROM ubicacion')).rows[0].nombre).toBe(
      'Sucursal principal',
    );
  } finally {
    await check.end();
  }
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

test('dashboard y ficha son exclusivos del operador y no exponen conexiones ni credenciales', async () => {
  for (const path of ['dashboard', `tenants/${tenant!.id}`]) {
    expect((await request(app.getHttpServer()).get('/api/platform/operator/' + path)).status).toBe(
      401,
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/platform/operator/' + path)
          .auth(customerToken, { type: 'bearer' })
      ).status,
    ).toBe(401);
    const response = await request(app.getHttpServer())
      .get('/api/platform/operator/' + path)
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(
      /database_name|postgresql|password|refresh_hash|capability|checkout_url|sk_test|whsec_/i,
    );
  }
  const detail = await request(app.getHttpServer())
    .get('/api/platform/operator/tenants/' + tenant!.id)
    .auth(token, { type: 'bearer' });
  expect(detail.body.tenant).toMatchObject({
    slug,
    planCode: 'pro',
    state: 'TRIAL',
    effectiveStatus: 'TRIALING',
  });
  expect(detail.body.payments).toEqual([]);
  expect(
    (
      await request(app.getHttpServer())
        .get('/api/platform/operator/tenants/not-a-uuid')
        .auth(token, { type: 'bearer' })
    ).status,
  ).toBe(400);
  expect(
    (
      await request(app.getHttpServer())
        .get('/api/platform/operator/tenants/' + randomUUID())
        .auth(token, { type: 'bearer' })
    ).status,
  ).toBe(404);
});

test('el directorio de tenants no es público ni accesible con una cuenta comercial', async () => {
  for (const path of ['/api/platform/stores', '/API/PLATFORM/STORES']) {
    const anonymous = await request(app.getHttpServer()).get(path);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(anonymous.body)).not.toContain(slug);
    for (const commercialToken of [customerToken, ownerToken]) {
      const denied = await request(app.getHttpServer())
        .get(path)
        .auth(commercialToken, { type: 'bearer' });
      expect(denied.status).toBe(401);
      expect(Array.isArray(denied.body)).toBe(false);
    }
  }
  expect((await request(app.getHttpServer()).head('/api/platform/stores')).status).toBe(401);
  const control = await request(app.getHttpServer())
    .get('/api/platform/stores')
    .auth(token, { type: 'bearer' });
  expect(control.status).toBe(200);
  expect(control.body).toContainEqual({ slug, name: 'Tienda Operada QA' });
});

test('filtros y paginación no interpretan comodines ni SQL del buscador', async () => {
  const get = (query: string) =>
    request(app.getHttpServer())
      .get('/api/platform/operator/tenants?' + query)
      .auth(token, { type: 'bearer' });
  const found = await get(
    new URLSearchParams({ search: slug, state: 'TRIAL', plan: 'pro' }).toString(),
  );
  expect(found.status).toBe(200);
  expect(found.body.total).toBe(1);
  expect(found.body.tenants[0].id).toBe(tenant!.id);
  expect(
    (await get(new URLSearchParams({ search: slug, state: 'ACTIVE' }).toString())).body.total,
  ).toBe(0);
  expect((await get('search=%25')).body.total).toBe(0);
  expect((await get('state=WRONG')).status).toBe(400);
  expect((await get('offset=-1')).status).toBe(400);
  expect((await get('unknown=1')).status).toBe(400);
});

test('la lectura del resumen deriva vencimiento y no cambia vigencia ni negocio', async () => {
  const saved = (
    await registry.pool.query('SELECT * FROM platform.subscription WHERE tenant_id=$1', [
      tenant!.id,
    ])
  ).rows[0];
  await registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [tenant!.id],
  );
  try {
    const before = (
      await registry.pool.query(
        'SELECT row_to_json(s) AS value FROM platform.subscription s WHERE tenant_id=$1',
        [tenant!.id],
      )
    ).rows[0].value;
    const response = await request(app.getHttpServer())
      .get('/api/platform/operator/dashboard')
      .auth(token, { type: 'bearer' });
    expect(response.status).toBe(200);
    expect(response.body.counts.expired).toBeGreaterThanOrEqual(1);
    expect(response.body.counts.attention).toBeLessThanOrEqual(response.body.counts.total);
    expect(response.body.plans.reduce((n: number, p: { count: number }) => n + p.count, 0)).toBe(
      response.body.counts.total,
    );
    const detail = await request(app.getHttpServer())
      .get('/api/platform/operator/tenants/' + tenant!.id)
      .auth(token, { type: 'bearer' });
    expect(detail.body.tenant).toMatchObject({
      state: 'TRIAL',
      status: 'TRIALING',
      effectiveStatus: 'EXPIRED',
    });
    const after = (
      await registry.pool.query(
        'SELECT row_to_json(s) AS value FROM platform.subscription s WHERE tenant_id=$1',
        [tenant!.id],
      )
    ).rows[0].value;
    expect(after).toEqual(before);
  } finally {
    await registry.pool.query(
      'UPDATE platform.subscription SET trial_ends_at=$2 WHERE tenant_id=$1',
      [tenant!.id, saved.trial_ends_at],
    );
  }
});

test('el listado conserva páginas de 50 sin perder filtros ni duplicar registros', async () => {
  const prefix = 'paging-' + randomUUID().slice(0, 8),
    ids = Array.from({ length: 52 }, () => randomUUID());
  try {
    for (let i = 0; i < ids.length; i++) {
      await registry.pool.query(
        "INSERT INTO platform.tenant(id,slug,name,database_name,state) VALUES($1,$2,$3,$4,'FAILED')",
        [ids[i], prefix + '-' + i, 'Página QA ' + i, 'qa_registry_' + ids[i].replaceAll('-', '')],
      );
      await registry.pool.query(
        "INSERT INTO platform.subscription(tenant_id,plan_code,status,provider) VALUES($1,'pro','TRIALING','NONE')",
        [ids[i]],
      );
    }
    const get = (offset: number) =>
      request(app.getHttpServer())
        .get(
          '/api/platform/operator/tenants?' +
            new URLSearchParams({
              search: prefix,
              state: 'FAILED',
              plan: 'pro',
              offset: String(offset),
            }),
        )
        .auth(token, { type: 'bearer' });
    const first = await get(0),
      next = await get(first.body.nextOffset);
    expect(first.body.tenants).toHaveLength(50);
    expect(first.body.total).toBe(52);
    expect(first.body.hasMore).toBe(true);
    expect(next.body.tenants).toHaveLength(2);
    expect(next.body.hasMore).toBe(false);
    expect(new Set([...first.body.tenants, ...next.body.tenants].map((s) => s.id)).size).toBe(52);
  } finally {
    await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=ANY($1::uuid[])', [
      ids,
    ]);
    await registry.pool.query('DELETE FROM platform.tenant WHERE id=ANY($1::uuid[])', [ids]);
  }
});
