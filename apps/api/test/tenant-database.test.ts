import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { Db } from '../src/db';
import { runForTenant, TenantContext } from '../src/tenancy/context';

const id = randomUUID();
const databaseName = `vestidor18_tenant_test_${randomUUID().replaceAll('-', '')}`;
let admin: Client;
let primary: PrismaClient;
let secondary: PrismaClient;
let routed: Db;
let a: TenantContext;
let b: TenantContext;

beforeAll(async () => {
  const base = new URL(process.env.DATABASE_URL!);
  base.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = base.toString();
  admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const other = new URL(base);
  other.pathname = `/${databaseName}`;
  const setup = new Client({ connectionString: other.toString() });
  await setup.connect();
  const migrations = readdirSync(resolve('prisma/migrations'))
    .filter((name) => /^\d/.test(name))
    .sort();
  for (const migration of migrations)
    await setup.query(
      readFileSync(resolve('prisma/migrations', migration, 'migration.sql'), 'utf8'),
    );
  await setup.end();
  primary = new PrismaClient({ datasources: { db: { url: base.toString() } } });
  secondary = new PrismaClient({ datasources: { db: { url: other.toString() } } });
  await primary.categoria.create({ data: { id, nombre: `Original ${id}`, activa: true } });
  await secondary.categoria.create({ data: { id, nombre: `Otra ${id}`, activa: true } });
  a = {
    id: randomUUID(),
    slug: 'lumina',
    name: 'Original',
    databaseUrl: base.toString(),
    storageDirectory: '.local/test-storage',
    state: 'ACTIVE',
  };
  b = { ...a, id: randomUUID(), slug: 'otra-tienda', name: 'Otra', databaseUrl: other.toString() };
  routed = new Db();
}, 30000);

afterAll(async () => {
  await primary?.categoria.deleteMany({ where: { id } });
  await primary?.$disconnect();
  await secondary?.$disconnect();
  await routed?.onModuleDestroy();
  if (admin) {
    if (!/^vestidor18_tenant_test_[a-f0-9]{32}$/.test(databaseName))
      throw new Error('Base de prueba inválida');
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

test('ORM y SQL directo consultan la base de su tienda aun con identificadores iguales', async () => {
  const results = await Promise.all(
    [a, b].map((tenant) =>
      runForTenant(tenant, async () => {
        const row = await routed.categoria.findUniqueOrThrow({ where: { id } });
        const raw = await routed.$queryRaw<
          { nombre: string }[]
        >`SELECT nombre FROM categoria WHERE id=${id}::uuid`;
        return { name: row.nombre, raw: raw[0].nombre };
      }),
    ),
  );
  expect(results).toEqual([
    { name: `Original ${id}`, raw: `Original ${id}` },
    { name: `Otra ${id}`, raw: `Otra ${id}` },
  ]);
});

test('las transacciones no modifican otra tienda', async () => {
  await runForTenant(b, () =>
    routed.$transaction(async (tx) => {
      await tx.categoria.update({ where: { id }, data: { descripcion: 'Solo segunda tienda' } });
    }),
  );
  expect((await secondary.categoria.findUniqueOrThrow({ where: { id } })).descripcion).toBe(
    'Solo segunda tienda',
  );
  expect((await primary.categoria.findUniqueOrThrow({ where: { id } })).descripcion).toBeNull();
});
