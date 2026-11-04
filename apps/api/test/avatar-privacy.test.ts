import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { copyFile, mkdir, access } from 'fs/promises';
import { resolve } from 'path';
import { commerceFixture } from './helpers/commerce';
import { AvatarJobs } from '../src/avatar-jobs';
import { storedPath } from '../src/storage';
import { runForTenant } from '../src/tenancy/context';
import { AuthService } from '../src/auth';

let f: Awaited<ReturnType<typeof commerceFixture>>;
beforeAll(async () => {
  f = await commerceFixture();
});
afterAll(async () => {
  await f?.close();
});

test('borrado privado permite plan vencido, cancela trabajo, libera reserva y purga capturas', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const operationId = randomUUID();
  const response = await request(f.app.getHttpServer())
    .post('/api/avatars')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' })
    .field('altura', '170')
    .field('consentimiento', 'true')
    .field('adulto', 'true')
    .field('idempotencia', operationId)
    .attach('frente', png, 'frente.png')
    .attach('perfil', png, 'perfil.png')
    .attach('espalda', png, 'espalda.png');
  expect(response.status).toBe(201);
  const created = await f.inStore(async () => {
    const template = await f.db.plantilla_corporal.findFirstOrThrow();
    const id = randomUUID(),
      key = `private/privacy-fixture/${id}.glb`;
    await mkdir(storedPath('private/privacy-fixture'), { recursive: true });
    await copyFile(resolve('.local/storage/public/reference.glb'), storedPath(key));
    const avatar = await f.db.avatar.create({
      data: {
        id,
        usuario_id: f.actorId,
        plantilla_id: template.id,
        version: 1,
        estado: 'EN_REVISION',
        clave_glb: key,
        medidas: { altura: { valor_cm: 170 } },
        parametros_malla: { height: 1.7 },
        creado_en: new Date(),
      },
    });
    await f.db.trabajo_avatar.update({
      where: { id: response.body.id },
      data: { estado: 'PROCESANDO', avatar_id: id },
    });
    return avatar;
  });
  const stranger = await f.inStore(() =>
    f.app
      .get(AuthService)
      .mobileRegister({
        nombres: 'Otra',
        apellidos: 'Persona',
        correo: `${randomUUID()}@qa.test`,
        clave: 'OtraPersona2026!',
      }),
  );
  await f.registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [f.tenant.id],
  );
  const remove = (token: string) =>
    request(f.app.getHttpServer())
      .delete(`/api/avatars/${created.id}`)
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(token, { type: 'bearer' });
  expect((await remove(stranger.accessToken)).status).toBe(404);
  const deletion = await remove(f.token);
  expect(deletion.status).toBe(200);
  expect(deletion.body.estado).toBe('ELIMINANDO');
  expect((await f.http('get', `/avatars/${created.id}/model`)).status).toBe(404);
  expect((await f.http('post', `/avatars/${created.id}/approve`)).status).toBe(402);
  const job = await f.inStore(() =>
    f.db.trabajo_avatar.findUniqueOrThrow({
      where: { id: response.body.id },
      include: { consumo_cuota: true },
    }),
  );
  expect(job.estado).toBe('CANCELADO');
  expect(job.consumo_cuota?.estado).toBe('LIBERADO');
  await runForTenant(await f.registry.resolve(f.tenant.slug), () => f.app.get(AvatarJobs).tick());
  const record = await f.inStore(() =>
    f.db.avatar.findUniqueOrThrow({ where: { id: created.id } }),
  );
  expect(record).toMatchObject({
    estado: 'ELIMINADO',
    clave_glb: null,
    medidas: null,
    parametros_malla: null,
  });
  expect((await remove(f.token)).body.estado).toBe('ELIMINADO');
  expect(
    await f.inStore(() =>
      f.db.foto_temporal.count({
        where: { captura_id: job.captura_id!, clave_objeto: { not: null } },
      }),
    ),
  ).toBe(0);
  await expect(f.inStore(() => access(storedPath(created.clave_glb!)))).rejects.toThrow();
  const audits = await f.inStore(() =>
    f.db.auditoria.findMany({ where: { entidad_id: created.id } }),
  );
  expect(audits.some((a) => a.accion === 'AVATAR_DELETE')).toBe(true);
  expect(JSON.stringify(audits)).not.toContain('valor_cm');
});
