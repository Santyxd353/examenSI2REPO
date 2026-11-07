import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { AuthService } from '../src/auth';

let f: Awaited<ReturnType<typeof commerceFixture>>;
beforeAll(async () => {
  f = await commerceFixture();
});
afterAll(async () => {
  await f?.close();
});
const create = (rol = 'Vendedor') =>
  f.http('post', '/staff', {
    nombres: 'Ana',
    apellidos: 'Equipo',
    correo: `${randomUUID()}@qa.test`,
    clave: 'EquipoPrueba2026!',
    rol,
    ubicaciones: [],
  });
const row = async (id: string) =>
  (await f.http('get', '/staff')).body.find((p: any) => p.id === id);
const change = async (id: string, values: object) =>
  f.http('patch', `/staff/${id}`, {
    expectedVersion: (await row(id)).version,
    ...values,
  });

test('last_admin: lista propietaria y bloquea suspensión o pérdida del último administrador', async () => {
  const owner = await row(f.actorId);
  expect(owner).toMatchObject({ schemaVersion: '1.0', version: 1, estado: 'ACTIVO' });
  expect(owner.clave_hash).toBeUndefined();
  for (const body of [{ estado: 'SUSPENDIDO', motivo: 'Fin del contrato' }, { rol: 'Analista' }]) {
    const response = await change(f.actorId, body);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('LAST_ADMIN');
  }
});

test('cupo: compradoras no ocupan plaza; suspensión libera plaza y reactivación vuelve a comprobar cupo', async () => {
  await f.inStore(() =>
    f.app.get(AuthService).mobileRegister({
      nombres: 'Cliente',
      apellidos: 'Compradora',
      correo: `${randomUUID()}@qa.test`,
      clave: 'ClientePrueba2026!',
    }),
  );
  const one = await create(),
    two = await create('Analista');
  expect([one.status, two.status]).toEqual([201, 201]);
  expect((await create()).status).toBe(409);
  expect(
    (await change(one.body.id, { estado: 'SUSPENDIDO', motivo: 'Pausa temporal del contrato' }))
      .status,
  ).toBe(200);
  const replacement = await create();
  expect(replacement.status).toBe(201);
  expect((await change(one.body.id, { estado: 'ACTIVO' })).status).toBe(409);
  for (const id of [two.body.id, replacement.body.id])
    expect(
      (await change(id, { estado: 'SUSPENDIDO', motivo: 'Cierre de caso de prueba' })).status,
    ).toBe(200);
  expect((await change(one.body.id, { estado: 'ACTIVO' })).status).toBe(200);
  expect(
    (await change(one.body.id, { estado: 'SUSPENDIDO', motivo: 'Cierre de caso de prueba' }))
      .status,
  ).toBe(200);
});

test('edición versionada: conflicto concurrente, duplicado sin cambios y sesión revocada al cambiar acceso', async () => {
  const person = (await create()).body;
  const login = await f.inStore(() =>
    f.app.get(AuthService).mobileLogin({ correo: person.correo, clave: 'EquipoPrueba2026!' }),
  );
  const before = await row(person.id);
  const edits = await Promise.all(
    ['Ana Rosa', 'Ana María'].map((nombres) =>
      f.http('patch', `/staff/${person.id}`, { expectedVersion: before.version, nombres }),
    ),
  );
  expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  const duplicate = await change(person.id, { correo: f.actor.correo });
  expect(duplicate.status).toBe(409);
  expect((await row(person.id)).correo).toBe(person.correo);
  expect((await change(person.id, { rol: 'Analista' })).status).toBe(200);
  expect(
    (
      await request(f.app.getHttpServer())
        .get('/api/auth/me')
        .set('X-Tenant-Slug', f.tenant.slug)
        .auth(login.accessToken, { type: 'bearer' })
    ).status,
  ).toBe(401);
  expect(
    (await change(person.id, { estado: 'SUSPENDIDO', motivo: 'Contrato finalizado' })).status,
  ).toBe(200);
  const audits = await f.inStore(() =>
    f.db.auditoria.findMany({ where: { entidad_id: person.id } }),
  );
  expect(audits.length).toBeGreaterThanOrEqual(4);
  expect(JSON.stringify(audits)).not.toContain('EquipoPrueba2026!');
  expect(JSON.stringify(audits)).not.toContain('clave_hash');
});

test('roles: vendedora limitada a asignaciones; analista consulta pero no altera ventas o equipo', async () => {
  const first = await f.item(),
    second = await f.item();
  const seller = (await create()).body,
    analyst = (await create('Analista')).body;
  for (const person of [seller, analyst]) {
    expect((await change(person.id, { ubicaciones: [first.locationId] })).status).toBe(200);
    const login = await f.inStore(() =>
      f.app.get(AuthService).mobileLogin({ correo: person.correo, clave: 'EquipoPrueba2026!' }),
    );
    const get = (path: string) =>
      request(f.app.getHttpServer())
        .get(`/api${path}`)
        .set('X-Tenant-Slug', f.tenant.slug)
        .auth(login.accessToken, { type: 'bearer' });
    expect((await get(`/locations/${first.locationId}/inventory`)).status).toBe(200);
    expect((await get(`/locations/${second.locationId}/inventory`)).status).toBe(403);
    expect((await get('/staff')).status).toBe(403);
    expect((await get('/locations')).body.map((l: any) => l.id)).toEqual([first.locationId]);
    if (person.id === analyst.id) {
      expect(
        (
          await request(f.app.getHttpServer())
            .post(`/api/locations/${first.locationId}/inventory/adjustments`)
            .set('X-Tenant-Slug', f.tenant.slug)
            .auth(login.accessToken, { type: 'bearer' })
            .send({ varianteId: first.variantId, delta: 1, motivo: 'No debe permitir' })
        ).status,
      ).toBe(403);
    }
    expect(
      (await change(person.id, { estado: 'SUSPENDIDO', motivo: 'Cierre de caso de prueba' }))
        .status,
    ).toBe(200);
  }
});

test('dos administradoras no pueden quitar concurrentemente ambos accesos', async () => {
  const other = await create('Administrador');
  expect(other.status).toBe(201);
  const login = await f.inStore(() =>
    f.app.get(AuthService).mobileLogin({ correo: other.body.correo, clave: 'EquipoPrueba2026!' }),
  );
  const owner = await row(f.actorId),
    person = await row(other.body.id);
  const results = await Promise.all([
    f.http('patch', `/staff/${f.actorId}`, { expectedVersion: owner.version, rol: 'Analista' }),
    request(f.app.getHttpServer())
      .patch(`/api/staff/${other.body.id}`)
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(login.accessToken, { type: 'bearer' })
      .send({ expectedVersion: person.version, rol: 'Analista' }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const activeAdmins = await f.inStore(() =>
    f.db.usuario.count({
      where: {
        estado: 'ACTIVO',
        usuario_rol: { some: { rol: { nombre: 'Administrador' } } },
      },
    }),
  );
  expect(activeAdmins).toBe(1);
});
