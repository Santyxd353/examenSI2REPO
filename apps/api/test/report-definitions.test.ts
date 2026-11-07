import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { commerceFixture } from './helpers/commerce';
import { AuthService } from '../src/auth';

const fixture = JSON.parse(
  readFileSync('packages/contracts/fixtures/report-golden-v1.json', 'utf8'),
);
let f: Awaited<ReturnType<typeof commerceFixture>>;
const route = '/reports/definitions';
const definition = (title: string) => ({ ...fixture.definition, title });
beforeAll(async () => {
  f = await commerceFixture();
});
afterAll(async () => {
  await f?.close();
});

test('Esencial aplica cupo por tienda bajo concurrencia, editar no consume otro y archivar libera uno', async () => {
  for (const title of ['Primero', 'Segundo'])
    expect((await f.http('post', route, { definition: definition(title) })).status).toBe(201);
  const concurrent = await Promise.all(
    ['Tercero', 'Cuarto'].map((title) => f.http('post', route, { definition: definition(title) })),
  );
  expect(concurrent.map((row) => row.status).sort()).toEqual([201, 409]);
  expect(concurrent.find((row) => row.status === 409)?.body.code).toBe('CAPACITY_EXCEEDED');
  const saved = concurrent.find((row) => row.status === 201)!.body;
  const edit = await f.http('patch', route + '/' + saved.id, {
    expectedVersion: 1,
    definition: definition('Editado'),
  });
  expect(edit.body).toMatchObject({ id: saved.id, version: 2, definition: { title: 'Editado' } });
  expect(
    (
      await f.http('patch', route + '/' + saved.id, {
        expectedVersion: 1,
        definition: definition('Copia atrasada'),
      })
    ).status,
  ).toBe(409);
  const archived = await request(f.app.getHttpServer())
    .delete('/api' + route + '/' + saved.id + '?expectedVersion=2')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' });
  expect(archived.status).toBe(200);
  expect(archived.body).toMatchObject({ state: 'ARCHIVADA', version: 3 });
  expect(
    (await f.http('post', route, { definition: definition('Guardar como nuevo') })).status,
  ).toBe(201);
  const list = await f.http('get', route);
  expect(list.headers['cache-control']).toContain('no-store');
  expect(list.body.definitions).toHaveLength(3);
});

test('reintento de creación usa mismo UUID y otra cuenta con permiso no puede leerlo', async () => {
  const existing = (await f.http('get', route)).body.definitions[0];
  const remove = await request(f.app.getHttpServer())
    .delete('/api' + route + '/' + existing.id + '?expectedVersion=' + existing.version)
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' });
  expect(remove.status).toBe(200);
  const operationId = randomUUID(),
    input = { operationId, definition: definition('Creación recuperable') };
  const first = await f.http('post', route, input);
  expect(first.status).toBe(201);
  expect((await f.http('post', route, input)).body).toEqual(first.body);
  expect(
    (await f.http('post', route, { ...input, definition: definition('Otra carga') })).body.code,
  ).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  const other = await f.inStore(async () => {
    const user = await f.app
      .get(AuthService)
      .mobileRegister({
        nombres: 'Otra',
        apellidos: 'Admin',
        correo: randomUUID() + '@qa.test',
        clave: 'OtraAdmin2026!',
      });
    const role = await f.db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
    await f.db.usuario_rol.create({
      data: { usuario_id: user.user.id, rol_id: role.id, asignado_en: new Date() },
    });
    return user;
  });
  const foreign = await request(f.app.getHttpServer())
    .get('/api' + route + '/' + first.body.id)
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(other.accessToken, { type: 'bearer' });
  expect(foreign.status).toBe(404);
});
