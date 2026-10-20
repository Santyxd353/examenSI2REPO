import 'dotenv/config';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp } from '../src/app';

let app: INestApplication;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  app = await createApp();
});
afterAll(async () => {
  await app?.close();
});

test('Lúmina conserva su espacio y publica únicamente metadatos seguros de la tienda', async () => {
  const response = await request(app.getHttpServer()).get('/api/tenant');
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({ slug: 'lumina', name: 'Lúmina' });
  expect(response.body.databaseUrl).toBeUndefined();
  expect(response.body.databaseName).toBeUndefined();
});

test('una tienda inexistente no recibe por error el catálogo de Lúmina', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/catalog')
    .set('X-Tenant-Slug', 'no-existe-esta-tienda');
  expect(response.status).toBe(404);
  expect(response.body.products).toBeUndefined();
});

test('rechaza un identificador de tienda inválido antes de consultar negocio', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/catalog')
    .set('X-Tenant-Slug', '../lumina');
  expect(response.status).toBe(400);
});
