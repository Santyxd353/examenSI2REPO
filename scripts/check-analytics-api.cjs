// Real asynchronous analysis with isolated local PostgreSQL and the pinned Python worker.
require('dotenv/config');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { Client } = require('pg');
const request = require('supertest');

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1'].includes(database.hostname));
  database.pathname = '/vestidor18_test';
  for (const name of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[name] = database.toString();
  process.env.ANALYTICS_PYTHON_PATH = resolve('.local/analytics-venv/Scripts/python.exe');
  const { createApp } = require('../dist/api/app');
  const { TenantRegistry } = require('../dist/api/tenancy/platform');
  const { provisionTenant } = require('../dist/api/tenancy/provision');
  const { runForTenant } = require('../dist/api/tenancy/context');
  const { AuthService } = require('../dist/api/auth');
  const { Db } = require('../dist/api/db');
  const { AnalysisJobs } = require('../dist/api/analytics/jobs.service');
  const app = await createApp();
  const registry = app.get(TenantRegistry);
  const slug = 'qa-ml-' + randomUUID().slice(0, 8);
  const password = 'Analisis2026!Prueba';
  let tenant;
  try {
    tenant = await provisionTenant(
      {
        slug,
        name: 'Análisis local QA',
        ownerEmail: slug + '@qa.test',
        ownerPassword: password,
        planCode: 'negocio',
      },
      registry,
    );
    let login = await runForTenant(tenant, () =>
      app.get(AuthService).mobileLogin({ correo: slug + '@qa.test', clave: password }),
    );
    const call = async (method, path, body, retry = true) => {
      const result = request(app.getHttpServer())
        [method]('/api' + path)
        .set('X-Tenant-Slug', slug)
        .auth(login.accessToken, { type: 'bearer' });
      const response = await (body ? result.send(body) : result);
      if (response.status === 401 && retry) {
        login = await runForTenant(tenant, () =>
          app.get(AuthService).mobileLogin({ correo: slug + '@qa.test', clave: password }),
        );
        return call(method, path, body, false);
      }
      return response;
    };
    async function run(input) {
      const started = Date.now();
      const response = await call('post', '/analytics/jobs', {
        operationId: randomUUID(),
        source: 'DEMOSTRACION_SINTETICA',
        locationIds: ['demo-ubicacion-01', 'demo-ubicacion-02'],
        ...input,
      });
      assert.equal(response.status, 202, JSON.stringify(response.body));
      assert.equal(response.body.status, 'QUEUED');
      assert.ok(Date.now() - started < 5000);
      console.log(input.action, 'encolado', response.body.id);
      await app.get(AnalysisJobs).sweep();
      const done = await call('get', '/analytics/jobs/' + response.body.id);
      assert.equal(done.status, 200);
      assert.equal(done.body.status, 'COMPLETED', JSON.stringify(done.body));
      console.log(input.action, 'completado', Date.now() - started, 'ms');
      return done.body;
    }
    const dataset = await run({ action: 'GENERATE_DATASET' });
    assert.equal(dataset.result.dataset.rows, 197100);
    const demand = await run({ action: 'TRAIN_DEMAND', datasetJobId: dataset.id });
    assert.equal(demand.result.metrics.length, 6);
    assert.equal(await runForTenant(tenant, () => app.get(Db).metrica_modelo.count()), 6);
    const forecast = await run({ action: 'FORECAST', modelJobId: demand.id, horizonDays: 7 });
    assert.ok(forecast.result.forecast.length > 0);
    assert.equal(forecast.result.period.from, '2026-10-01');
    const restock = await run({ action: 'SUGGEST_RESTOCK', forecastJobId: forecast.id });
    assert.ok(restock.result.suggestions.length > 0);
    assert.ok(restock.result.suggestions.every((row) => row.effect === 'SUGGESTION_ONLY'));
    const anomaly = await run({ action: 'TRAIN_ANOMALY', datasetJobId: dataset.id });
    assert.equal(anomaly.result.metrics.length, 14);
    assert.ok(anomaly.result.alerts.length > 0);
    assert.equal(await runForTenant(tenant, () => app.get(Db).pedido.count()), 0);
    const exported = await call('get', '/analytics/results/' + restock.id);
    assert.equal(exported.status, 200);
    await mkdir('.local', { recursive: true });
    await writeFile(
      '.local/analytics-api-qa.json',
      JSON.stringify({ dataset, demand, forecast, restock, anomaly }),
    );
    console.log(
      'HTTP202, cola, métricas persistidas, pronóstico futuro, reposición, anomalías y exportación verificados.',
    );
  } finally {
    if (tenant) {
      for (const table of ['billing_event', 'subscription', 'tenant'])
        await registry.pool.query(
          'DELETE FROM platform.' +
            table +
            ' WHERE ' +
            (table === 'tenant' ? 'id' : 'tenant_id') +
            '=$1',
          [tenant.id],
        );
    }
    await app.close();
    if (tenant) {
      const name = new URL(tenant.databaseUrl).pathname.slice(1);
      assert.match(name, /^store_[a-f0-9]{32}$/);
      const connection = new Client({ connectionString: database.toString() });
      await connection.connect();
      try {
        await connection.query('DROP DATABASE "' + name + '"');
      } finally {
        await connection.end();
      }
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
