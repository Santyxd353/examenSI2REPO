// Browser acceptance against an isolated tenant in local PostgreSQL.
require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdir, mkdtemp, readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(database.hostname))
    throw new Error('La prueba necesita PostgreSQL local.');
  database.pathname = '/vestidor18_test';
  for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[key] = database.toString();
  const port = 3030;
  const origin = 'http://127.0.0.1:' + port;
  await mkdir('.local', { recursive: true });
  const workspace = await mkdtemp(resolve('.local', 'reports-web-qa-'));
  process.env.STORAGE_ROOT = resolve(workspace, 'storage');
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.WEB_ORIGIN = origin;
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  // Empty values also prevent Prisma's local dotenv loader from restoring real keys.
  process.env.REPORT_AI_OPENAI_KEY = '';
  process.env.OPENAI_API_KEY = '';
  process.env.GROQ_API_KEY = '';
  process.env.REPORT_AI_PROVIDER = 'groq';
  const originalFetch = global.fetch;
  const voiceText = 'Ventas de vestidos por categoría';
  global.fetch = async (url, options) => {
    if (String(url) === 'https://api.groq.com/openai/v1/audio/transcriptions') {
      const file = options.body.get('file');
      expect(file.type).toBe('audio/webm');
      expect(file.size).toBeGreaterThan(16);
      return Response.json({ text: voiceText });
    }
    if (String(url) === 'https://api.groq.com/openai/v1/chat/completions') {
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: 'PROPOSE',
                explanation: 'Filtrar vestidos dentro del corte.',
                specification: {
                  title: 'Ventas de vestidos',
                  fact: 'ventas_confirmadas',
                  metrics: ['ventas_confirmadas_bob'],
                  dimensions: ['categoria'],
                  filters: [{ field: 'categoria', operator: 'eq', value: 'Vestidos' }],
                  widgets: [
                    {
                      id: 'canales',
                      chart: 'donut',
                      dimension: 'canal',
                      metric: 'ventas_confirmadas_bob',
                    },
                    {
                      id: 'evolucion',
                      chart: 'line',
                      dimension: 'dia',
                      metric: 'ventas_confirmadas_bob',
                    },
                  ],
                },
              }),
            },
          },
        ],
      });
    }
    return originalFetch(url, options);
  };
  const { createApp } = require('../dist/api/app');
  const { TenantRegistry } = require('../dist/api/tenancy/platform');
  const { provisionTenant } = require('../dist/api/tenancy/provision');
  const app = await createApp();
  const registry = app.get(TenantRegistry);
  const slug = 'qa-reportes-' + randomUUID().slice(0, 8);
  const email = slug + '@qa.test';
  const password = 'ReportesWeb2026!Segura';
  const errors = [];
  let tenant, context, page;
  async function open(offline = false) {
    context = await chromium.launchPersistentContext(resolve(workspace, 'chromium'), {
      headless: true,
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    await context.setOffline(offline);
    page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/?tienda=' + slug);
  }
  async function reports() {
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    await page
      .getByRole('complementary', { name: 'Módulos administrativos' })
      .getByRole('button', { name: 'Reportes y análisis', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Reportes personalizados' })).toBeVisible();
  }
  const kpi = () => page.locator('.report-kpi').first();
  const prepare = () => page.getByRole('button', { name: 'Preparar datos', exact: true }).click();
  try {
    await app.listen(port, '127.0.0.1');
    tenant = await provisionTenant(
      {
        slug,
        name: 'Lúmina reportes QA',
        ownerEmail: email,
        ownerPassword: password,
        planCode: 'pro',
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
    await reports();
    await expect(page.getByRole('region', { name: 'Asistencia para reportes' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Consulta', exact: true }).fill(voiceText);
    await page.getByRole('button', { name: 'Consultar IA', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Puedes seguir usando los filtros manuales.',
    );
    await expect(kpi()).toContainText('Bs 0,00');
    await page
      .getByRole('combobox', { name: 'Fuente', exact: true })
      .selectOption('DEMOSTRACION_SINTETICA');
    await prepare();
    await expect(kpi()).toContainText('Bs 220,00');
    await expect(page.locator('.report-cut')).toContainText('DEMOSTRACIÓN SINTÉTICA');
    await page.getByRole('textbox', { name: 'Consulta', exact: true }).fill(voiceText);
    await page.getByRole('button', { name: 'Consultar IA', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(
      'Puedes seguir usando los filtros manuales.',
    );
    await expect(kpi()).toContainText('Bs 220,00');
    process.env.GROQ_API_KEY = 'qa-no-network';
    process.env.GROQ_REPORTS_MODEL = 'openai/gpt-oss-20b';
    process.env.GROQ_VOICE_MODEL = 'whisper-large-v3-turbo';
    await page.getByRole('button', { name: 'Consultar IA', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Propuesta para revisar' })).toContainText(
      'Ventas de vestidos',
    );
    await page.getByRole('button', { name: 'Generar dashboard', exact: true }).click();
    await expect(kpi()).toContainText('Bs 170,00');
    await expect(page.locator('.report-donut')).toBeVisible();
    await expect(page.locator('.report-line')).toBeVisible();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    }
    await prepare();
    await page.getByRole('button', { name: 'Dictar consulta' }).click();
    await expect(page.getByText('Grabando hasta 30 segundos…')).toBeVisible();
    await page.waitForTimeout(350);
    await page.getByRole('button', { name: 'Detener grabación' }).click();
    await expect(page.getByText('Puedes corregir la transcripción')).toBeVisible();
    await page.getByRole('button', { name: 'Consultar IA', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Propuesta para revisar' })).toContainText(
      'Ventas de vestidos',
    );
    await page.getByRole('button', { name: 'Pasar al formulario' }).click();
    await expect(kpi()).toContainText('Bs 220,00');
    await page.getByRole('button', { name: 'Aplicar filtros y diseño' }).click();
    await expect(kpi()).toContainText('Bs 170,00');
    await prepare();
    await expect(kpi()).toContainText('Bs 220,00');
    await page.getByLabel('Título', { exact: true }).fill('Colección de septiembre');
    await page.getByRole('button', { name: 'Añadir gráfico', exact: true }).click();
    await page.getByLabel('Tipo del gráfico 1').selectOption('donut');
    await page.getByRole('button', { name: 'Guardar diseño', exact: true }).click();
    await expect(page.getByText('Diseño guardado.', { exact: true })).toBeVisible();
    await expect(page.locator('.report-donut')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar copia sin conexión' }).click();
    await expect(page.getByText('Copia cifrada guardada en este dispositivo.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cached = await page.evaluate(async () => {
      const requests = await Promise.all(
        (await caches.keys()).map(async (key) => (await caches.open(key)).keys()),
      );
      return requests.flat().map((request) => new URL(request.url).pathname);
    });
    expect(cached).toContain('/');
    expect(cached.some((path) => path.startsWith('/api/'))).toBe(false);
    await page.screenshot({ path: resolve(workspace, 'reportes-escritorio.png'), fullPage: true });
    await context.close();
    await open(true);
    await reports();
    await expect(page.getByRole('region', { name: 'Asistencia para reportes' })).toHaveCount(0);
    await expect(kpi()).toContainText('Bs 220,00');
    await expect(page.getByRole('heading', { name: 'Colección de septiembre' })).toBeVisible();
    await page.getByRole('button', { name: 'Filtrar Categoría: Vestidos' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(kpi()).toContainText('Bs 170,00');
    await page.getByRole('button', { name: 'Quitar selección Categoría' }).click();
    await page.getByLabel('Campo del filtro').selectOption('categoria');
    await page.getByLabel('Valor del filtro').selectOption('Faldas');
    await page.getByRole('button', { name: 'Añadir filtro' }).click();
    await page.getByRole('button', { name: 'Aplicar filtros y diseño' }).click();
    await expect(kpi()).toContainText('Bs 50,00');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar CSV' }).click();
    const exportFile = await download;
    const contents = await readFile(await exportFile.path(), 'utf8');
    expect(contents).toContain('"origen","DEMOSTRACION_SINTETICA"');
    expect(contents).toContain('"ventas_confirmadas_bob","50.00"');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: resolve(workspace, 'reportes-movil.png'), fullPage: true });
    await page.pdf({
      path: resolve(workspace, 'reporte-offline.pdf'),
      format: 'A4',
      printBackground: true,
    });
    expect(errors).toEqual([]);
    console.log(
      'Chromium verificó IA visible, descarga automática, texto y voz con Groq simulado, dashboard de barras/anillo/línea, 320–1440 px, copia offline, filtros, CSV y PDF. ' +
        workspace,
    );
  } catch (error) {
    await page
      ?.screenshot({ path: resolve(workspace, 'reportes-error.png'), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    global.fetch = originalFetch;
    await context?.close();
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
      const dbName = new URL(tenant.databaseUrl).pathname.slice(1);
      if (!/^store_[a-f0-9]{32}$/.test(dbName)) throw new Error('Base de pruebas inesperada.');
      const connection = new Client({ connectionString: database.toString() });
      await connection.connect();
      try {
        await connection.query('DROP DATABASE "' + dbName + '"');
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
