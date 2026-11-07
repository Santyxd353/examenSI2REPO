// Browser UI/offline acceptance with explicitly controlled analysis-result fixtures.
require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdtemp, mkdir, readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(database.hostname))
    throw new Error('Usa PostgreSQL local.');
  database.pathname = '/vestidor18_test';
  for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[key] = database.toString();
  const port = 3032,
    origin = 'http://127.0.0.1:' + port;
  await mkdir('.local', { recursive: true });
  const workspace = await mkdtemp(resolve('.local', 'analysis-web-qa-'));
  process.env.STORAGE_ROOT = resolve(workspace, 'storage');
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.WEB_ORIGIN = origin;
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  const { createApp } = require('../dist/api/app');
  const { TenantRegistry } = require('../dist/api/tenancy/platform');
  const { provisionTenant } = require('../dist/api/tenancy/provision');
  const { AnalysisJobViewSchema } = require('../packages/contracts/dist');
  const app = await createApp(),
    registry = app.get(TenantRegistry);
  const slug = 'qa-analisis-' + randomUUID().slice(0, 8),
    email = slug + '@qa.test',
    password = 'AnalisisWeb2026!';
  const base = {
    schemaVersion: '1.0',
    source: 'DEMOSTRACION_SINTETICA',
    action: 'FORECAST',
    asOf: '2026-09-30T23:00:00Z',
    period: { from: '2026-10-01', to: '2026-10-02' },
    limitations: ['Fixture sintético de aceptación de la interfaz.'],
    locationIds: ['demo-ubicacion-01', 'demo-ubicacion-02'],
    model: { id: randomUUID(), version: 'modelo-qa-v1', algorithm: 'RandomForestRegressor' },
    metrics: [],
    forecast: [],
    suggestions: [],
    alerts: [],
  };
  const make = (action, result) =>
    AnalysisJobViewSchema.parse({
      id: randomUUID(),
      action,
      source: 'DEMOSTRACION_SINTETICA',
      status: 'COMPLETED',
      createdAt: '2026-11-07T12:00:00Z',
      startedAt: '2026-11-07T12:00:01Z',
      completedAt: '2026-11-07T12:00:03Z',
      errorCode: null,
      message: null,
      result: { ...base, ...result, action },
    });
  const forecast = make('FORECAST', {
    forecast: [
      {
        date: '2026-10-01',
        variantId: 'demo-variante-001',
        locationId: 'demo-ubicacion-01',
        channel: 'WEB',
        predictedUnits: 2,
      },
      {
        date: '2026-10-02',
        variantId: 'demo-variante-001',
        locationId: 'demo-ubicacion-01',
        channel: 'WEB',
        predictedUnits: 3,
      },
      {
        date: '2026-10-02',
        variantId: 'demo-variante-001',
        locationId: 'demo-ubicacion-02',
        channel: 'WEB',
        predictedUnits: 7,
      },
    ],
  });
  const demand = make('TRAIN_DEMAND', {
    metrics: [
      {
        name: 'MAE',
        partition: 'PRUEBA',
        horizonDays: 7,
        value: 2,
        baseline: 1,
        status: 'EVALUABLE',
        reason: null,
        observations: 10,
      },
      {
        name: 'WAPE',
        partition: 'PRUEBA',
        horizonDays: 7,
        value: null,
        baseline: null,
        status: 'NO_APLICA',
        reason: 'SUMA_REAL_CERO',
        observations: 10,
      },
    ],
  });
  let jobs = [forecast, demand];
  let tenant, context, page;
  const errors = [];
  async function open(offline = false) {
    context = await chromium.launchPersistentContext(resolve(workspace, 'chromium'), {
      headless: true,
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    await context.setOffline(offline);
    if (!offline)
      await context.route('**/api/analytics/jobs**', async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          expect(body.source).toBe('DEMOSTRACION_SINTETICA');
          const pending = {
            ...forecast,
            id: body.operationId,
            action: body.action,
            status: 'QUEUED',
            result: null,
            startedAt: null,
            completedAt: null,
          };
          jobs = [pending, ...jobs];
          return route.fulfill({ status: 202, json: pending });
        }
        const id = url.pathname.split('/')[4];
        return route.fulfill({
          json: id
            ? jobs.find((job) => job.id === id)
            : { jobs: jobs.map((job) => ({ ...job, result: null })) },
        });
      });
    page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/?tienda=' + slug);
  }
  async function module() {
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    await page
      .getByRole('complementary', { name: 'Módulos administrativos' })
      .getByRole('button', { name: 'Análisis de datos', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Laboratorio de análisis' })).toBeVisible();
  }
  try {
    await app.listen(port, '127.0.0.1');
    tenant = await provisionTenant(
      {
        slug,
        name: 'Análisis web QA',
        ownerEmail: email,
        ownerPassword: password,
        planCode: 'negocio',
      },
      registry,
    );
    await open();
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await module();
    await expect(page.getByRole('region', { name: 'Resultado del análisis' })).toContainText(
      '12 unidades',
    );
    await page.getByLabel('Resultado hasta').fill('2026-10-03');
    await expect(page.getByRole('alert')).toContainText(
      'Las fechas seleccionadas quedan fuera del corte',
    );
    await page.getByLabel('Resultado hasta').fill('2026-10-02');
    await page.getByRole('button', { name: 'Iniciar análisis', exact: true }).click();
    await expect(
      page.getByText('El análisis quedó en cola. Puedes continuar trabajando.'),
    ).toBeVisible();
    await page.getByLabel('Análisis guardado').selectOption(demand.id);
    await expect(page.getByText('N/A · SUMA_REAL_CERO')).toBeVisible();
    await expect(page.getByText('En alguna métrica de error')).toBeVisible();
    await page.getByLabel('Análisis guardado').selectOption(forecast.id);
    await expect(page.getByRole('heading', { name: 'Demanda prevista' })).toBeVisible();
    await page.getByRole('button', { name: 'Guardar análisis sin conexión' }).click();
    await expect(
      page.getByText('Resultado cifrado guardado para consultar sin conexión.'),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
      .toBe(true);
    await page.screenshot({ path: resolve(workspace, 'analisis-escritorio.png'), fullPage: true });
    await context.close();
    await open(true);
    await module();
    await expect(page.getByRole('region', { name: 'Resultado del análisis' })).toContainText(
      '12 unidades',
    );
    await page.getByLabel('Ubicación del resultado').selectOption('demo-ubicacion-01');
    await expect(page.getByRole('region', { name: 'Resultado del análisis' })).toContainText(
      '5 unidades',
    );
    await page.getByLabel('Resultado hasta').fill('2026-10-01');
    await expect(page.getByRole('region', { name: 'Resultado del análisis' })).toContainText(
      '2 unidades',
    );
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar resultado' }).click();
    expect(await readFile(await (await downloaded).path(), 'utf8')).toContain(
      'DEMOSTRACION_SINTETICA',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: resolve(workspace, 'analisis-offline-movil.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    console.log(
      'Interfaz ML, métricas N/A y referencia, cola, copia cifrada, reinicio offline, filtros y exportación verificados. ' +
        workspace,
    );
  } catch (error) {
    await page
      ?.screenshot({ path: resolve(workspace, 'analisis-error.png'), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context?.close();
    if (tenant)
      for (const table of ['billing_event', 'subscription', 'tenant'])
        await registry.pool.query(
          'DELETE FROM platform.' +
            table +
            ' WHERE ' +
            (table === 'tenant' ? 'id' : 'tenant_id') +
            '=$1',
          [tenant.id],
        );
    await app.close();
    if (tenant) {
      const name = new URL(tenant.databaseUrl).pathname.slice(1);
      if (!/^store_[a-f0-9]{32}$/.test(name)) throw new Error('Base temporal inesperada.');
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
