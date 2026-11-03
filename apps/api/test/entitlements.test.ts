import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { Client } from 'pg';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import { AuthService } from '../src/auth';
import { Db } from '../src/db';
import { TenantRegistry } from '../src/tenancy/platform';
import { provisionTenant } from '../src/tenancy/provision';
import { runForTenant, TenantContext } from '../src/tenancy/context';
import { seedTenantRoles } from '../src/tenancy/defaults';
import { EntitlementsSchema } from '@lumina/contracts';

let app: INestApplication, db: Db, registry: TenantRegistry, tenant: TenantContext;
let ownerToken: string, originalToken: string, customerToken: string;
const rootOwnerId = randomUUID();
const slug = `cuotas-${randomUUID().replaceAll('-', '').slice(0, 14)}`;
const password = 'EsencialPrueba2026!';

beforeAll(async () => {
  app = await createApp();
  db = app.get(Db);
  registry = app.get(TenantRegistry);
  await seedTenantRoles(db);
  const adminRole = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  await db.usuario.create({
    data: {
      id: rootOwnerId,
      nombres: 'Admin',
      apellidos: 'Cuotas',
      correo: `${rootOwnerId}@qa.test`,
      clave_hash: await hash(password, 10),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: adminRole.id, asignado_en: new Date() } },
    },
  });
  originalToken = (
    await app.get(AuthService).mobileLogin({ correo: `${rootOwnerId}@qa.test`, clave: password })
  ).accessToken;
  tenant = await provisionTenant(
    {
      slug,
      name: 'Cuotas Esencial QA',
      ownerEmail: `${slug}@qa.test`,
      ownerPassword: password,
      planCode: 'esencial',
    },
    registry,
  );
  ownerToken = (
    await runForTenant(tenant, () =>
      app.get(AuthService).mobileLogin({ correo: `${slug}@qa.test`, clave: password }),
    )
  ).accessToken;
  customerToken = (
    await runForTenant(tenant, () =>
      app
        .get(AuthService)
        .mobileRegister({
          nombres: 'Clienta',
          apellidos: 'Sin plaza',
          correo: `${slug}-clienta@qa.test`,
          clave: password,
        }),
    )
  ).accessToken;
}, 60000);

afterAll(async () => {
  if (db) {
    await db.sesion.deleteMany({ where: { usuario_id: rootOwnerId } });
    await db.usuario_rol.deleteMany({ where: { usuario_id: rootOwnerId } });
    await db.usuario.deleteMany({ where: { id: rootOwnerId } });
  }
  if (tenant) {
    const name = new URL(tenant.databaseUrl).pathname.slice(1);
    if (!/^store_[a-f0-9]{32}$/.test(name)) throw new Error('Limpieza no autorizada.');
    await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [tenant.id]);
    await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [tenant.id]);
    await registry.pool.query('DELETE FROM platform.tenant WHERE id=$1', [tenant.id]);
    await app.close();
    const cleanup = new Client({ connectionString: process.env.DATABASE_URL });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE "${name}"`);
    await cleanup.end();
  } else await app?.close();
}, 30000);

test('API publica tres planes exactos sin proveedor ni claves secretos', async () => {
  const response = await request(app.getHttpServer()).get('/api/tenant/plans');
  expect(response.status).toBe(200);
  expect(response.body.plans.map((p: { priceMinor: number }) => p.priceMinor)).toEqual([
    14900, 29900, 59900,
  ]);
  expect(response.body.plans.map((p: { code: string }) => p.code)).toEqual([
    'esencial',
    'pro',
    'negocio',
  ]);
  expect(JSON.stringify(response.body)).not.toMatch(/sk_test|sk_live|whsec_/);
});

test('suscripción autorizada cuenta propietaria, ubicación y excluye compradoras', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/tenant/subscription')
    .set('X-Tenant-Slug', slug)
    .auth(ownerToken, { type: 'bearer' });
  expect(response.status).toBe(200);
  const value = EntitlementsSchema.parse(response.body);
  expect(value.tenantId).toBe(tenant.id);
  expect(value.planCode).toBe('esencial');
  expect(value.priceMinor).toBe(14900);
  expect(value.status).toBe('TRIAL');
  expect(value.usage.staff).toBe(1);
  expect(value.usage.locations).toBe(1);
  expect(value.usage.products).toBe(0);
  expect(value.features.demand).toBe(false);
  expect(value.limits.avatarsPerPeriod).toBe(30);
});

test('tokens de otro negocio y compradora no consultan consumos administrativos', async () => {
  const wrongStore = await request(app.getHttpServer())
    .get('/api/tenant/subscription')
    .set('X-Tenant-Slug', slug)
    .auth(originalToken, { type: 'bearer' });
  expect(wrongStore.status).toBe(401);
  const customer = await request(app.getHttpServer())
    .get('/api/tenant/subscription')
    .set('X-Tenant-Slug', slug)
    .auth(customerToken, { type: 'bearer' });
  expect(customer.status).toBe(403);
  expect(customer.body.code).toBe('FORBIDDEN');
});

test('Lúmina anterior se identifica como compatibilidad sin agregar cuarto plan de venta', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/tenant/subscription')
    .auth(originalToken, { type: 'bearer' });
  expect(response.status).toBe(200);
  expect(response.body.legacyPilot).toBe(true);
  expect(response.body.priceMinor).toBe(0);
  expect(response.body.billingMode).toBeNull();
});

test('el cerrojo de control conserva la versión hasta terminar la escritura comercial', async () => {
  const gate = registry as TenantRegistry & {
    withWriteAccess<T>(
      context: TenantContext,
      work: (fresh: TenantContext) => Promise<T>,
    ): Promise<T>;
  };
  let entered!: () => void,
    release!: () => void,
    changed = false;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  const operation = gate.withWriteAccess(tenant, async (fresh) => {
    await gate.withWriteAccess(fresh, async (nested) => {
      expect(nested).toBe(fresh);
    });
    entered();
    await pause;
    return fresh.subscription?.version;
  });
  // If the method is missing, observe that rejection before waiting for a callback.
  await Promise.race([started, operation.then(() => undefined)]);
  const control = await registry.pool.connect();
  const change = (async () => {
    try {
      await control.query('BEGIN');
      await control.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `lumina:subscription:${tenant.id}`,
      ]);
      await control.query('UPDATE platform.subscription SET version=version+1 WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await control.query('COMMIT');
      changed = true;
    } finally {
      control.release();
    }
  })();
  try {
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(changed).toBe(false);
  } finally {
    release();
  }
  const oldVersion = await operation;
  await change;
  const newVersion = await gate.withWriteAccess(
    tenant,
    async (fresh) => fresh.subscription?.version,
  );
  expect(newVersion).toBe((oldVersion ?? 0) + 1);
});

test('vencimiento posterior a la captura del contexto se revalida al escribir', async () => {
  const gate = registry as TenantRegistry & {
    withWriteAccess<T>(
      context: TenantContext,
      work: (fresh: TenantContext) => Promise<T>,
    ): Promise<T>;
  };
  await registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [tenant.id],
  );
  try {
    await expect(
      gate.withWriteAccess(tenant, async () => 'no debe ejecutarse'),
    ).rejects.toMatchObject({ status: 402 });
  } finally {
    await registry.pool.query(
      "UPDATE platform.subscription SET trial_ends_at=now()+interval '14 days' WHERE tenant_id=$1",
      [tenant.id],
    );
  }
});
