import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { runForTenant, TenantContext } from '../src/tenancy/context';

const actor = randomUUID(),
  jobs = Array.from({ length: 33 }, () => randomUUID());
const period = {
  actorId: actor,
  periodFrom: '2026-11-01T14:00:00.000Z',
  periodTo: '2026-12-01T14:00:00.000Z',
  planCode: 'esencial' as const,
  subscriptionVersion: 1,
};
let db: PrismaClient;
let scope: TenantContext;
const service = () => new (require('../src/billing/quota.service').QuotaService)();
const context = (id: string) => ({ ...period, operationId: id });
beforeAll(async () => {
  db = new PrismaClient();
  scope = {
    id: randomUUID(),
    slug: 'quota-local',
    name: 'Quota QA',
    databaseUrl: process.env.DATABASE_URL!,
    state: 'ACTIVE',
    storageDirectory: '.local/qa-quota',
    subscription: {
      plan: 'esencial',
      planName: 'Esencial',
      status: 'ACTIVE',
      provider: 'NONE',
      periodEnd: period.periodTo,
      limits: { locations: 1, staff: 3, products: 200 },
      features: [],
    },
  };
  await db.usuario.create({
    data: {
      id: actor,
      nombres: 'Prueba',
      apellidos: 'Cuota',
      correo: `${actor}@qa.test`,
      clave_hash: 'no-login-test',
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
    },
  });
  await db.trabajo_avatar.createMany({
    data: jobs.map((id) => ({
      id,
      usuario_id: actor,
      tipo: 'GENERAR',
      estado: 'EN_COLA',
      idempotencia: id,
      intentos: 0,
      version_proceso: 'qa',
      creado_en: new Date(),
    })),
  });
});
afterAll(async () => {
  await db?.consumo_cuota.deleteMany({ where: { actor_id: actor } });
  await db?.trabajo_avatar.deleteMany({ where: { usuario_id: actor } });
  await db?.usuario.deleteMany({ where: { id: actor } });
  await db?.$disconnect();
});
test('29 confirmadas y dos reservas concurrentes dejan solo una plaza disponible', async () => {
  const quota = service();
  await runForTenant(scope, async () => {
    for (const id of jobs.slice(0, 29))
      await db.$transaction(async (tx) => {
        await quota.reserve(tx, 'AVATAR_GENERACION', id, context(id));
        await quota.commit(tx, 'AVATAR_GENERACION', id);
      });
    const outcomes = await Promise.allSettled(
      jobs
        .slice(29, 31)
        .map((id) =>
          db.$transaction((tx) => quota.reserve(tx, 'AVATAR_GENERACION', id, context(id))),
        ),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await db.consumo_cuota.count({
        where: { actor_id: actor, estado: { in: ['RESERVADO', 'CONFIRMADO'] } },
      }),
    ).toBe(30);
  });
});
test('repetir UUID no consume y liberar fallo devuelve plaza sin desconfirmar éxitos', async () => {
  const quota = service();
  await runForTenant(scope, async () => {
    const existing = await db.consumo_cuota.findFirstOrThrow({
      where: { actor_id: actor, estado: 'RESERVADO' },
    });
    const id = existing.trabajo_avatar_id!;
    const again = await db.$transaction<{ id: string }>((tx) =>
      quota.reserve(tx, 'AVATAR_GENERACION', id, context(id)),
    );
    expect(again.id).toBe(existing.id);
    await db.$transaction((tx) => quota.release(tx, 'AVATAR_GENERACION', id));
    await db.$transaction((tx) => quota.release(tx, 'AVATAR_GENERACION', jobs[0]));
    expect(
      (await db.consumo_cuota.findFirstOrThrow({ where: { trabajo_avatar_id: jobs[0] } })).estado,
    ).toBe('CONFIRMADO');
    await db.$transaction((tx) =>
      quota.reserve(tx, 'AVATAR_GENERACION', jobs[31], context(jobs[31])),
    );
    expect(
      await db.consumo_cuota.count({
        where: { actor_id: actor, estado: { in: ['RESERVADO', 'CONFIRMADO'] } },
      }),
    ).toBe(30);
  });
});
