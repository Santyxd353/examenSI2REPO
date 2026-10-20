import 'dotenv/config';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app';
import { AuthService } from '../src/auth';
import { storedPath } from '../src/storage';
import { currentTenant, runForTenant, TenantContext } from '../src/tenancy/context';

let app: INestApplication;
let db: PrismaClient;
let auth: AuthService;
let first: TenantContext;
let second: TenantContext;
let session: { accessToken: string; refreshToken: string };

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  first = {
    id: randomUUID(),
    slug: 'prueba-primera',
    name: 'Primera tienda',
    databaseUrl: url.toString(),
    storageDirectory: '.local/test-storage/primera',
    state: 'ACTIVE',
  };
  second = {
    ...first,
    id: randomUUID(),
    slug: 'prueba-segunda',
    name: 'Segunda tienda',
    storageDirectory: '.local/test-storage/segunda',
  };
  app = await createApp();
  auth = app.get(AuthService);
  session = await runForTenant(first, () =>
    auth.mobileRegister({
      nombres: 'Cliente',
      apellidos: 'Aislado',
      correo: `tiendas-${randomUUID()}@grupo18.test`,
      clave: 'ClienteSeguro2026!',
    }),
  );
});

afterAll(async () => {
  await app?.close();
  await db?.$disconnect();
});

test('las peticiones concurrentes mantienen su tienda y directorio', async () => {
  const results = await Promise.all(
    [first, second].map((tenant) =>
      runForTenant(tenant, async () => {
        await new Promise((resolve) => setTimeout(resolve, tenant === first ? 15 : 1));
        return { slug: currentTenant()?.slug, path: storedPath('public/vestido.png') };
      }),
    ),
  );
  expect(results[0].slug).toBe(first.slug);
  expect(results[1].slug).toBe(second.slug);
  expect(results[0].path).not.toBe(results[1].path);
  expect(currentTenant()).toBeUndefined();
});

test('el token de acceso no autoriza otra tienda aunque exista el mismo usuario', async () => {
  await expect(runForTenant(first, () => auth.verify(session.accessToken))).resolves.toMatchObject({
    tenant: { slug: first.slug },
  });
  await expect(runForTenant(second, () => auth.verify(session.accessToken))).rejects.toThrow();
});

test('otra tienda no puede renovar ni revocar la sesión original', async () => {
  await expect(
    runForTenant(second, () => auth.mobileRefresh({ refreshToken: session.refreshToken })),
  ).rejects.toThrow();
  await runForTenant(second, () => auth.mobileLogout({ refreshToken: session.refreshToken }));
  await expect(runForTenant(first, () => auth.verify(session.accessToken))).resolves.toBeDefined();
});

test('un token anterior sin tienda solo mantiene compatibilidad con Lúmina', async () => {
  const { tenant: ignored, ...claims } = jwt.decode(session.accessToken) as jwt.JwtPayload;
  const legacy = jwt.sign(claims, process.env.JWT_SECRET!, { algorithm: 'HS256' });
  const lumina = { ...first, slug: 'lumina' };
  await expect(runForTenant(lumina, () => auth.verify(legacy))).resolves.toBeDefined();
  await expect(runForTenant(second, () => auth.verify(legacy))).rejects.toThrow();
});
