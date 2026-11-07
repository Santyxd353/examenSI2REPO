import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { commerceFixture } from './helpers/commerce';
import { AnalysisJobs } from '../src/analytics/jobs.service';
import { AnalyticsWorkerBridge } from '../src/analytics/worker-bridge';
import { AuthService } from '../src/auth';
import { hash } from 'bcryptjs';
import http from 'supertest';

let f: Awaited<ReturnType<typeof commerceFixture>>;
const request = (extra: object = {}) => ({
  operationId: randomUUID(),
  action: 'GENERATE_DATASET',
  source: 'DEMOSTRACION_SINTETICA',
  ...extra,
});
beforeAll(async () => {
  f = await commerceFixture();
});
afterAll(async () => {
  await f?.close();
});
const setPlan = (code: string) =>
  f.registry.pool.query('UPDATE platform.subscription SET plan_code=$1 WHERE tenant_id=$2', [
    code,
    f.tenant.id,
  ]);

test('enforces the plan, accepts a durable job and recovers the same intent', async () => {
  expect((await f.http('post', '/analytics/jobs', request())).status).toBe(403);
  await setPlan('pro');
  const input = request();
  const first = await f.http('post', '/analytics/jobs', input);
  expect(first.status).toBe(202);
  expect(first.body).toMatchObject({ id: input.operationId, status: 'QUEUED', result: null });
  expect((await f.http('post', '/analytics/jobs', input)).body.id).toBe(first.body.id);
  expect(
    (
      await f.http('post', '/analytics/jobs', {
        ...input,
        action: 'FORECAST',
        modelJobId: randomUUID(),
        horizonDays: 7,
      })
    ).status,
  ).toBe(409);
  expect((await f.http('get', '/analytics/jobs/' + randomUUID())).status).toBe(404);
  expect(
    (await f.http('get', '/analytics/jobs')).body.jobs.map((job: { id: string }) => job.id),
  ).toContain(first.body.id);
  const lease = await f.registry.pool.connect();
  try {
    await lease.query("SELECT pg_advisory_lock(hashtextextended('lumina:analytics:worker:v1',0))");
    await Promise.all([f.app.get(AnalysisJobs).sweep(), f.app.get(AnalysisJobs).sweep()]);
    expect((await f.http('get', '/analytics/jobs/' + input.operationId)).body.status).toBe(
      'QUEUED',
    );
  } finally {
    await lease.query(
      "SELECT pg_advisory_unlock(hashtextextended('lumina:analytics:worker:v1',0))",
    );
    lease.release();
  }
  await f.inStore(async () => {
    const row = await f.db.ejecucion_analitica.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    expect(row.estado).toBe('PENDIENTE');
    await f.db.ejecucion_analitica.update({
      where: { id: row.id },
      data: {
        filtros: {
          ...(row.filtros as object),
          queue: { state: 'RUNNING', startedAt: new Date().toISOString() },
        },
      },
    });
  });
  const worker = jest
    .spyOn(f.app.get(AnalyticsWorkerBridge), 'run')
    .mockRejectedValue(new Error('Unexpected run'));
  await f.app.get(AnalysisJobs).sweep();
  const interrupted = await f.http('get', '/analytics/jobs/' + input.operationId);
  expect(interrupted.body).toMatchObject({ status: 'FAILED', errorCode: 'ANALYTICS_INTERRUPTED' });
  expect(worker).not.toHaveBeenCalled();
  worker.mockRestore();
});

test('keeps real data insufficient and applies an explicit stock rule without stock writes', async () => {
  await setPlan('pro');
  const item = await f.item(2);
  const before = await f.inStore(() =>
    f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
  );
  const real = await f.http('post', '/analytics/jobs', request({ source: 'REAL' }));
  expect(real.status).toBe(202);
  expect(real.body).toMatchObject({
    status: 'INSUFFICIENT_DATA',
    errorCode: 'MODEL_DATA_INSUFFICIENT',
  });
  const restock = await f.http(
    'post',
    '/analytics/jobs',
    request({
      source: 'REAL',
      action: 'SUGGEST_RESTOCK',
      locationIds: [item.locationId],
    }),
  );
  expect(restock.status).toBe(202);
  await f.app.get(AnalysisJobs).sweep();
  const done = await f.http('get', '/analytics/jobs/' + restock.body.id);
  expect(done.body).toMatchObject({
    status: 'COMPLETED',
    result: {
      source: 'REAL',
      suggestions: [{ effect: 'SUGGESTION_ONLY', available: 2, demandSource: 'REGLA_BASICA' }],
    },
  });
  const after = await f.inStore(() =>
    f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
  );
  expect(after).toEqual(before);
  expect((await f.http('get', '/analytics/results/' + restock.body.id)).status).toBe(200);
  await setPlan('esencial');
  expect((await f.http('get', '/analytics/jobs/' + restock.body.id)).status).toBe(403);
});

test('isolates result ownership and denies anomaly and cross-location analysis in Profesional', async () => {
  await setPlan('pro');
  const own = await f.http('post', '/analytics/jobs', request());
  expect(own.status).toBe(202);
  const login = await f.inStore(async () => {
    const role = await f.db.rol.findUniqueOrThrow({ where: { nombre: 'Analista' } });
    const correo = 'analista-' + randomUUID() + '@qa.test';
    const clave = 'Analisis2026!Cuenta';
    await f.db.usuario.create({
      data: {
        nombres: 'Analista',
        apellidos: 'Pruebas',
        correo,
        clave_hash: await hash(clave, 4),
        estado: 'ACTIVO',
        preferencias: {},
        creado_en: new Date(),
        usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
      },
    });
    return f.app.get(AuthService).mobileLogin({ correo, clave });
  });
  const other = await http(f.app.getHttpServer())
    .get('/api/analytics/jobs/' + own.body.id)
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(login.accessToken, { type: 'bearer' });
  expect(other.status).toBe(404);
  expect(
    (
      await f.http(
        'post',
        '/analytics/jobs',
        request({ action: 'TRAIN_ANOMALY', datasetJobId: randomUUID() }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await f.http(
        'post',
        '/analytics/jobs',
        request({ locationIds: ['demo-ubicacion-01', 'demo-ubicacion-02'] }),
      )
    ).status,
  ).toBe(403);
  const foreign = await commerceFixture();
  try {
    await foreign.registry.pool.query(
      "UPDATE platform.subscription SET plan_code='pro' WHERE tenant_id=$1",
      [foreign.tenant.id],
    );
    expect((await foreign.http('get', '/analytics/jobs/' + own.body.id)).status).toBe(404);
  } finally {
    await foreign.close();
  }
});
