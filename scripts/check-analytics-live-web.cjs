// Read-only browser acceptance against an active local check-analytics-api tenant.
require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new Error('La verificación necesita PostgreSQL local.');
  url.pathname = '/vestidor18_test';
  for (const name of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[name] = url.toString();
  const connection = new Client({ connectionString: url.toString() });
  await connection.connect();
  let row;
  try {
    row = (
      await connection.query(
        "SELECT slug FROM platform.tenant WHERE slug ~ '^qa-ml-[a-f0-9]{8}$' ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
  } finally {
    await connection.end();
  }
  if (!row) throw new Error('Inicia primero check-analytics-api.cjs.');
  const port = 3033,
    origin = 'http://127.0.0.1:' + port;
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.WEB_ORIGIN = origin;
  const app = await require('../dist/api/app').createApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await app.listen(port, '127.0.0.1');
    await page.goto(origin + '/?tienda=' + row.slug);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(row.slug + '@qa.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('Analisis2026!Prueba');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    await page
      .getByRole('complementary', { name: 'Módulos administrativos' })
      .getByRole('button', { name: 'Análisis de datos', exact: true })
      .click();
    const select = page.getByLabel('Análisis guardado');
    await expect(select.locator('option')).toHaveCount(3);
    const dataset = await select.locator('option').allTextContents();
    await select.selectOption({
      label: dataset.find((label) => label.startsWith('Preparar dataset')),
    });
    await expect(page.getByRole('heading', { name: 'Dataset preparado' })).toBeVisible();
    await expect(page.getByText('197.100 filas', { exact: true })).toBeVisible();
    await expect(page.getByText('2025-10-01 a 2026-06-12')).toBeVisible();
    await page.screenshot({
      path: resolve('.local', 'analytics-live-dataset.png'),
      fullPage: true,
    });
    await select.selectOption({
      label: dataset.find((label) => label.startsWith('Entrenar demanda')),
    });
    await expect(page.getByText('El servidor está procesando este análisis.')).toBeVisible();
    expect(errors).toEqual([]);
    console.log('Chromium leyó el dataset persistido y el entrenamiento activo desde la API real.');
  } finally {
    await browser.close();
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
