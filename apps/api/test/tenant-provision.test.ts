import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { writeFile, mkdir, rm, access } from 'fs/promises';
import { resolve } from 'path';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';
import { Db } from '../src/db';
import { TenantRegistry } from '../src/tenancy/platform';
import { provisionTenant } from '../src/tenancy/provision';
import { TenantContext } from '../src/tenancy/context';
import { runForTenant } from '../src/tenancy/context';
import { RealtimeGateway } from '../src/realtime';
import { io, Socket } from 'socket.io-client';
import { AvatarJobs } from '../src/avatar-jobs';

let app: INestApplication;
let registry: TenantRegistry;
let tenant: TenantContext;
let ownerToken: string;
let originalToken: string;
let ownerCookies: string[];
const slug = `prueba-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const email = `${slug}@grupo18.test`;
const filename = `${slug}.txt`;
const password = 'PropietariaSegura2026!';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  registry = app.get(TenantRegistry);
  const original = await request(app.getHttpServer()).post('/api/auth/register').send({
    nombres: 'Cliente',
    apellidos: 'Original',
    correo: email,
    clave: 'ClienteOriginal2026!',
  });
  expect(original.status).toBe(201);
  originalToken = original.body.accessToken;
  tenant = await provisionTenant(
    {
      slug,
      name: 'Tienda de prueba aislada',
      ownerEmail: email,
      ownerPassword: password,
      planCode: 'pro',
    },
    registry,
  );
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Tenant-Slug', slug)
    .send({ correo: email, clave: password });
  expect(login.status).toBe(201);
  expect(login.body.user.roles).toContain('Administrador');
  expect(login.body.user.tenant.slug).toBe(slug);
  ownerToken = login.body.accessToken;
  ownerCookies = login.headers['set-cookie'] as unknown as string[];
}, 60000);

afterAll(async () => {
  await app?.close();
  const url = new URL(process.env.DATABASE_URL!);
  if (url.pathname !== '/vestidor18_test')
    throw new Error('La limpieza solo está permitida en la base de prueba.');
  const cleanup = new Client({ connectionString: url.toString() });
  await cleanup.connect();
  const rows = await cleanup.query<{ id: string; database_name: string }>(
    'SELECT id,database_name FROM platform.tenant WHERE slug=$1',
    [slug],
  );
  for (const row of rows.rows) {
    if (!/^store_[a-f0-9]{32}$/.test(row.database_name)) throw new Error('Base temporal inválida.');
    await cleanup.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [row.id]);
    await cleanup.query('DELETE FROM platform.tenant WHERE id=$1', [row.id]);
    await cleanup.query(`DROP DATABASE IF EXISTS "${row.database_name}"`);
    if (tenant) {
      const expectedDirectory = resolve(
        process.env.STORAGE_ROOT || '.local/storage',
        'tenants',
        row.id,
      );
      if (resolve(tenant.storageDirectory) !== expectedDirectory)
        throw new Error('Directorio temporal fuera de su tienda.');
      await rm(expectedDirectory, { recursive: true, force: true });
    }
  }
  await cleanup.end();
  await rm(resolve(process.env.STORAGE_ROOT || '.local/storage', 'public', filename), {
    force: true,
  });
});

test('una tienda nueva tiene catálogo vacío y su administrador no modifica Lúmina', async () => {
  const catalog = await request(app.getHttpServer()).get('/api/catalog').set('X-Tenant-Slug', slug);
  expect(catalog.status).toBe(200);
  expect(catalog.body.products).toHaveLength(0);
  const location = await request(app.getHttpServer())
    .post('/api/locations')
    .set('X-Tenant-Slug', slug)
    .auth(ownerToken, { type: 'bearer' })
    .send({ nombre: 'Nueva sucursal', tipo: 'TIENDA' });
  expect(location.status).toBe(201);
  expect(await app.get(Db).ubicacion.findUnique({ where: { id: location.body.id } })).toBeNull();
});

test('tokens de tiendas diferentes se rechazan aunque ambas tengan el mismo correo', async () => {
  const other = await request(app.getHttpServer())
    .get('/api/auth/me')
    .set('X-Tenant-Slug', slug)
    .auth(originalToken, { type: 'bearer' });
  expect(other.status).toBe(401);
  const root = await request(app.getHttpServer())
    .get('/api/auth/me')
    .auth(ownerToken, { type: 'bearer' });
  expect(root.status).toBe(401);
});

test('la renovación web usa una cookie distinta para cada tienda', async () => {
  expect(ownerCookies.some((cookie) => cookie.startsWith(`refresh_${slug}=`))).toBe(true);
  const wrong = await request(app.getHttpServer())
    .post('/api/auth/refresh')
    .set('Cookie', ownerCookies);
  expect(wrong.status).toBe(401);
  const right = await request(app.getHttpServer())
    .post('/api/auth/refresh')
    .set('X-Tenant-Slug', slug)
    .set('Cookie', ownerCookies);
  expect(right.status).toBe(201);
  ownerToken = right.body.accessToken;
});

test('archivos públicos con el mismo nombre se sirven desde la tienda de su URL', async () => {
  const root = resolve(process.env.STORAGE_ROOT || '.local/storage', 'public');
  const other = resolve(tenant.storageDirectory, 'public');
  await mkdir(root, { recursive: true });
  await mkdir(other, { recursive: true });
  await writeFile(resolve(root, filename), 'original');
  await writeFile(resolve(other, filename), 'segunda');
  expect((await request(app.getHttpServer()).get(`/assets/${filename}`)).text).toBe('original');
  expect((await request(app.getHttpServer()).get(`/stores/${slug}/assets/${filename}`)).text).toBe(
    'segunda',
  );
  expect((await request(app.getHttpServer()).get(`/STORES/${slug}/ASSETS/${filename}`)).text).toBe(
    'segunda',
  );
  expect(
    (await request(app.getHttpServer()).get(`/STORES/no-existe/ASSETS/${filename}`)).status,
  ).toBe(404);
});

test('eventos de inventario no cruzan tiendas aunque coincida el identificador de ubicación', async () => {
  const location = await app.get(Db).ubicacion.findFirstOrThrow({ where: { activa: true } });
  await runForTenant(tenant, () =>
    app.get(Db).ubicacion.create({
      data: {
        id: location.id,
        nombre: 'Ubicación duplicada de prueba',
        tipo: 'TIENDA',
        activa: true,
      },
    }),
  );
  const port = (app.getHttpServer().address() as { port: number }).port;
  const connect = async (store: string, token: string) => {
    const socket = io(`http://127.0.0.1:${port}/realtime`, {
      transports: ['websocket'],
      auth: { token, tenant: store },
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('No se pudo suscribir a su tienda.'));
      }, 5000);
      socket.once('realtime:error', () => {
        clearTimeout(timer);
        socket.disconnect();
        reject(new Error('La sesión fue rechazada.'));
      });
      socket.once('realtime:ready', () =>
        socket.emit(
          'inventory:subscribe',
          { locationId: location.id },
          (value: { ok: boolean }) => {
            clearTimeout(timer);
            if (!value.ok) {
              socket.disconnect();
              reject(new Error('La ubicación no fue autorizada.'));
            } else resolve();
          },
        ),
      );
    });
    return socket;
  };
  const sockets: Socket[] = [];
  try {
    const original = await connect('lumina', originalToken);
    sockets.push(original);
    const other = await connect(slug, ownerToken);
    sockets.push(other);
    const originalEvents: unknown[] = [];
    const otherEvents: unknown[] = [];
    original.on('inventory:updated', (event) => originalEvents.push(event));
    other.on('inventory:updated', (event) => otherEvents.push(event));
    runForTenant(tenant, () =>
      app
        .get(RealtimeGateway)
        .inventoryChanged(location.id, { variantIds: [], reason: 'PRUEBA_AISLAMIENTO' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(originalEvents).toHaveLength(0);
    expect(otherEvents).toHaveLength(1);
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
});

test('suscripción vencida permite consultar y renovar sesión pero bloquea escrituras de negocio', async () => {
  await registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [tenant.id],
  );
  const info = await request(app.getHttpServer()).get('/api/tenant').set('X-Tenant-Slug', slug);
  expect(info.body.readOnly).toBe(true);
  expect(info.body.subscription.status).toBe('EXPIRED');
  const change = await request(app.getHttpServer())
    .post('/api/locations')
    .set('X-Tenant-Slug', slug)
    .auth(ownerToken, { type: 'bearer' })
    .send({ nombre: 'No debe guardarse', tipo: 'TIENDA' });
  expect(change.status).toBe(402);
  const query = await request(app.getHttpServer())
    .post('/api/analytics/query')
    .set('X-Tenant-Slug', slug)
    .auth(ownerToken, { type: 'bearer' })
    .send({ from: '2026-10-01', to: '2026-10-20', question: '¿Cuántas ventas hubo?' });
  expect(query.status).toBe(201);
  expect(query.body.intent).toBe('VENTAS');
  const analysis = await request(app.getHttpServer())
    .post('/api/analytics/run')
    .set('X-Tenant-Slug', slug)
    .auth(ownerToken, { type: 'bearer' })
    .send({ from: '2026-10-01', to: '2026-10-20' });
  expect(analysis.status).toBe(402);
  await registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()+interval '14 days' WHERE tenant_id=$1",
    [tenant.id],
  );
});

test('una tienda suspendida no entrega datos ni cae en la tienda inicial', async () => {
  await registry.pool.query("UPDATE platform.tenant SET state='SUSPENDED' WHERE id=$1", [
    tenant.id,
  ]);
  const response = await request(app.getHttpServer())
    .get('/api/catalog')
    .set('X-Tenant-Slug', slug);
  expect(response.status).toBe(403);
  expect(response.body.products).toBeUndefined();
  await registry.pool.query("UPDATE platform.tenant SET state='TRIAL' WHERE id=$1", [tenant.id]);
});

test('el mantenimiento purga fotos vencidas en su propia tienda incluso si está suspendida', async () => {
  const db = app.get(Db);
  const original = await registry.resolve('lumina');
  const captureId = randomUUID();
  const key = `private/${randomUUID()}.jpg`;
  for (const context of [original, tenant]) {
    await runForTenant(context, async () => {
      const user = await db.usuario.findUniqueOrThrow({ where: { correo: email } });
      const consent = await db.consentimiento.create({
        data: {
          usuario_id: user.id,
          version_texto: 'test-1',
          finalidad: 'AVATAR',
          declaracion_adulto: true,
          aceptado_en: new Date(),
        },
      });
      await db.captura_corporal.create({
        data: {
          id: captureId,
          usuario_id: user.id,
          consentimiento_id: consent.id,
          altura_cm: 170,
          estado: 'BORRADOR',
          creada_en: new Date(),
          purgar_antes_de: new Date(
            Date.now() + (context.slug === 'lumina' ? 86400000 : -86400000),
          ),
          foto_temporal: {
            create: { vista: 'FRENTE', clave_objeto: key, mime: 'image/jpeg', bytes: 4 },
          },
        },
      });
      await mkdir(resolve(context.storageDirectory, 'private'), { recursive: true });
      await writeFile(resolve(context.storageDirectory, key), 'test');
    });
  }
  try {
    await registry.pool.query("UPDATE platform.tenant SET state='SUSPENDED' WHERE id=$1", [
      tenant.id,
    ]);
    await app.get(AvatarJobs).sweep();
    await expect(access(resolve(tenant.storageDirectory, key))).rejects.toThrow();
    await expect(access(resolve(original.storageDirectory, key))).resolves.toBeUndefined();
    const purged = await runForTenant(tenant, () =>
      db.captura_corporal.findUniqueOrThrow({ where: { id: captureId } }),
    );
    expect(purged.purgada_en).not.toBeNull();
    expect(purged.altura_cm).toBeNull();
    const kept = await db.captura_corporal.findUniqueOrThrow({ where: { id: captureId } });
    expect(kept.purgada_en).toBeNull();
  } finally {
    await registry.pool.query("UPDATE platform.tenant SET state='TRIAL' WHERE id=$1", [tenant.id]);
    await rm(resolve(original.storageDirectory, key), { force: true });
  }
});

test('los límites del plan se aplican también ante altas concurrentes', async () => {
  const db = app.get(Db);
  const plan = `quota-${tenant.id.slice(0, 8)}`;
  const used = await runForTenant(tenant, () => db.ubicacion.count({ where: { activa: true } }));
  await registry.pool.query(
    'INSERT INTO platform.plan(code,name,limits,features) VALUES($1,$2,$3,$4)',
    [plan, 'Plan de prueba', { locations: used + 1, staff: 2, products: 1 }, '[]'],
  );
  await registry.pool.query('UPDATE platform.subscription SET plan_code=$1 WHERE tenant_id=$2', [
    plan,
    tenant.id,
  ]);
  const post = (path: string, body: unknown) =>
    request(app.getHttpServer())
      .post(path)
      .set('X-Tenant-Slug', slug)
      .auth(ownerToken, { type: 'bearer' })
      .send(body as object);
  try {
    const locations = await Promise.all(
      [1, 2, 3].map((i) =>
        post('/api/locations', { nombre: `Sucursal cuota ${i}`, tipo: 'TIENDA' }),
      ),
    );
    expect(locations.map((response) => response.status).sort()).toEqual([201, 409, 409]);
    const category = await runForTenant(tenant, () =>
      db.categoria.create({ data: { nombre: 'Vestidos', activa: true } }),
    );
    const products = await Promise.all(
      [1, 2].map((i) =>
        post('/api/catalog', {
          nombre: `Vestido de prueba ${i}`,
          descripcion: 'Prenda para verificar límites',
          material: 'Algodón',
          categoria_id: category.id,
        }),
      ),
    );
    expect(products.map((response) => response.status).sort()).toEqual([201, 409]);
    const staff = await Promise.all(
      [1, 2].map((i) =>
        post('/api/staff', {
          nombres: 'Vendedora',
          apellidos: 'Prueba',
          correo: `${randomUUID()}@grupo18.test`,
          clave: password,
          rol: 'Vendedor',
          ubicaciones: [],
        }),
      ),
    );
    expect(staff.map((response) => response.status).sort()).toEqual([201, 409]);
  } finally {
    await registry.pool.query(
      "UPDATE platform.subscription SET plan_code='pro' WHERE tenant_id=$1",
      [tenant.id],
    );
    await registry.pool.query('DELETE FROM platform.plan WHERE code=$1', [plan]);
  }
});

test('una provisión fallida conserva su estado de error y no habilita la tienda', async () => {
  const failedSlug = `fallo-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const unavailable = new URL(registry.administrationUrl);
  unavailable.hostname = '127.0.0.1';
  unavailable.port = '1';
  const administration = jest
    .spyOn(registry, 'administrationUrl', 'get')
    .mockReturnValue(unavailable.toString());
  try {
    await expect(
      provisionTenant(
        {
          slug: failedSlug,
          name: 'Tienda incompleta',
          ownerEmail: email,
          ownerPassword: password,
          planCode: 'pro',
        },
        registry,
      ),
    ).rejects.toThrow('no terminó');
    const row = await registry.pool.query('SELECT state FROM platform.tenant WHERE slug=$1', [
      failedSlug,
    ]);
    expect(row.rows[0]?.state).toBe('FAILED');
    const response = await request(app.getHttpServer())
      .get('/api/catalog')
      .set('X-Tenant-Slug', failedSlug);
    expect(response.status).toBe(403);
  } finally {
    administration.mockRestore();
    await registry.pool.query(
      'DELETE FROM platform.subscription WHERE tenant_id IN (SELECT id FROM platform.tenant WHERE slug=$1)',
      [failedSlug],
    );
    await registry.pool.query('DELETE FROM platform.tenant WHERE slug=$1', [failedSlug]);
  }
});
