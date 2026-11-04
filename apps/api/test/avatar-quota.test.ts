import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { commerceFixture } from './helpers/commerce';
import { AvatarJobs } from '../src/avatar-jobs';
import { QuotaService } from '../src/billing/quota.service';
import { EntitlementsService } from '../src/billing/entitlements.service';
import { AuthService } from '../src/auth';
import { runForTenant } from '../src/tenancy/context';

let f: Awaited<ReturnType<typeof commerceFixture>>;
let jobs: AvatarJobs;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
// Real worker rejects repeated views; acceptance is not a successful reconstruction.
function upload(operationId = randomUUID(), height = '170', token?: string) {
  return request(f.app.getHttpServer())
    .post('/api/avatars')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(token || f.token, { type: 'bearer' })
    .field('altura', height)
    .field('consentimiento', 'true')
    .field('adulto', 'true')
    .field('idempotencia', operationId)
    .attach('frente', png, { filename: 'frente.png', contentType: 'image/png' })
    .attach('perfil', png, { filename: 'perfil.png', contentType: 'image/png' })
    .attach('espalda', png, { filename: 'espalda.png', contentType: 'image/png' });
}
beforeAll(async () => {
  f = await commerceFixture();
  jobs = f.app.get(AvatarJobs);
});
afterEach(async () => {
  await f.inStore(() => jobs.tick());
});
afterAll(async () => {
  await f?.close();
});

test('reserva antes de aceptar; repetir no consume y mismo UUID con otra altura se rechaza', async () => {
  const id = randomUUID();
  const first = await upload(id);
  expect(first.status).toBe(201);
  const quota = await f.inStore(() =>
    f.db.consumo_cuota.findUnique({ where: { trabajo_avatar_id: first.body.id } }),
  );
  expect(quota).toMatchObject({ estado: 'RESERVADO', cantidad: 1, actor_id: f.actorId });
  const again = await upload(id);
  expect(again.body.id).toBe(first.body.id);
  const changed = await upload(id, '175');
  expect(changed.status).toBe(409);
  expect(changed.body.code).toBe('IDEMPOTENCY_CONFLICT');
  expect(await f.inStore(() => f.db.consumo_cuota.count({ where: { idempotencia: id } }))).toBe(1);
});

test('fallo real del procesador libera la reserva una vez y purga las fotos', async () => {
  const result = await upload();
  expect(result.status).toBe(201);
  await f.inStore(() => jobs.tick());
  await f.inStore(() => jobs.tick());
  const row = await f.inStore(() =>
    f.db.trabajo_avatar.findUniqueOrThrow({
      where: { id: result.body.id },
      include: { consumo_cuota: true, captura_corporal: true },
    }),
  );
  expect(row).toMatchObject({
    estado: 'FALLIDO',
    avatar_id: null,
    error_codigo: 'VISTAS_REPETIDAS',
  });
  expect(row.consumo_cuota?.estado).toBe('LIBERADO');
  expect(row.captura_corporal?.purgada_en).not.toBeNull();
});

test('recuperación de cola agotada libera cuota y no deja solicitudes sin procesar', async () => {
  const accepted = await upload();
  expect(accepted.status).toBe(201);
  await f.inStore(() =>
    f.db.trabajo_avatar.update({
      where: { id: accepted.body.id },
      data: { estado: 'EN_COLA', intentos: 3 },
    }),
  );
  await f.inStore(() => jobs.tick());
  const row = await f.inStore(() =>
    f.db.trabajo_avatar.findUniqueOrThrow({
      where: { id: accepted.body.id },
      include: { consumo_cuota: true, captura_corporal: true },
    }),
  );
  expect(row).toMatchObject({
    estado: 'FALLIDO',
    error_codigo: 'INTENTOS_AGOTADOS',
    consumo_cuota: { estado: 'LIBERADO' },
    captura_corporal: { estado: 'PURGADA' },
  });
});

test('reinicio recupera el mismo trabajo y su reserva sin generar otro consumo', async () => {
  const accepted = await upload();
  expect(accepted.status).toBe(201);
  await f.inStore(() =>
    f.db.trabajo_avatar.update({
      where: { id: accepted.body.id },
      data: { estado: 'PROCESANDO', intentos: 1, iniciado_en: new Date(Date.now() - 11 * 60000) },
    }),
  );
  await f.inStore(() => jobs.tick());
  const row = await f.inStore(() =>
    f.db.trabajo_avatar.findUniqueOrThrow({
      where: { id: accepted.body.id },
      include: { consumo_cuota: true },
    }),
  );
  expect(row).toMatchObject({
    estado: 'FALLIDO',
    error_codigo: 'VISTAS_REPETIDAS',
    intentos: 2,
    consumo_cuota: { estado: 'LIBERADO', cantidad: 1 },
  });
  expect(
    await f.inStore(() => f.db.consumo_cuota.count({ where: { trabajo_avatar_id: row.id } })),
  ).toBe(1);
});

test('29 éxitos y una reserva bloquean otra clienta; fallo libera capacidad de la tienda', async () => {
  await f.inStore(async () => {
    const entitlement = await f.app.get(EntitlementsService).forTenant(f.tenant.id);
    const quota = f.app.get(QuotaService);
    for (let index = 0; index < 29; index++) {
      const id = randomUUID();
      await f.db.$transaction(async (tx) => {
        await tx.trabajo_avatar.create({
          data: {
            id,
            usuario_id: f.actorId,
            tipo: 'GENERAR',
            estado: 'COMPLETADO',
            idempotencia: id,
            intentos: 1,
            version_proceso: 'fixture-cuota',
            creado_en: new Date(),
          },
        });
        await quota.reserve(tx, 'AVATAR_GENERACION', id, {
          actorId: f.actorId,
          operationId: id,
          periodFrom: entitlement.periodFrom,
          periodTo: entitlement.periodTo,
          planCode: entitlement.planCode,
          subscriptionVersion: f.tenant.subscription?.version ?? 1,
        });
        await quota.commit(tx, 'AVATAR_GENERACION', id);
      });
    }
  });
  const other = await f.inStore(() =>
    f.app
      .get(AuthService)
      .mobileRegister({
        nombres: 'Otra',
        apellidos: 'Clienta',
        correo: `${randomUUID()}@qa.test`,
        clave: 'OtraClienta2026!',
      }),
  );
  const accepted = await upload();
  expect(accepted.status).toBe(201);
  const rejected = await upload(randomUUID(), '170', other.accessToken);
  expect(rejected.status).toBe(409);
  expect(rejected.body.code).toBe('CAPACITY_EXCEEDED');
  expect(
    await f.inStore(() => f.db.captura_corporal.count({ where: { usuario_id: other.user.id } })),
  ).toBe(0);
  await f.inStore(() => jobs.tick());
  expect((await upload(randomUUID(), '170', other.accessToken)).status).toBe(201);
});

test('captura vencida libera cuota aunque la suscripción haya vencido', async () => {
  const accepted = await upload();
  expect(accepted.status).toBe(201);
  const job = await f.inStore(() =>
    f.db.trabajo_avatar.findUniqueOrThrow({ where: { id: accepted.body.id } }),
  );
  await f.inStore(() =>
    f.db.captura_corporal.update({
      where: { id: job.captura_id! },
      data: { purgar_antes_de: new Date(Date.now() - 1) },
    }),
  );
  await f.registry.pool.query(
    "UPDATE platform.subscription SET trial_ends_at=now()-interval '1 day' WHERE tenant_id=$1",
    [f.tenant.id],
  );
  const scope = await f.registry.resolve(f.tenant.slug);
  expect(scope.readOnly).toBe(true);
  await runForTenant(scope, () => jobs.tick());
  const quota = await f.inStore(() =>
    f.db.consumo_cuota.findUnique({ where: { trabajo_avatar_id: accepted.body.id } }),
  );
  expect(quota?.estado).toBe('LIBERADO');
  await f.reset();
});
