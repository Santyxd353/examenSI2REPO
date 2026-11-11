// Run after build against the isolated QA database; never provision in the commercial database.
require('dotenv/config');
const { chromium } = require('playwright');
const { Client } = require('pg');
const { hash } = require('bcryptjs');
const { randomUUID, randomBytes } = require('crypto');
const { mkdirSync, rmSync } = require('fs');
const { resolve, join } = require('path');
const assert = require('assert/strict');
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  process.env.PLATFORM_DATABASE_URL = url.toString();
  process.env.TENANT_DATABASE_URL = url.toString();
  const base = 'http://127.0.0.1:' + Number(process.env.OPERATOR_UI_PORT || 3024);
  process.env.WEB_ORIGIN = base;
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.STORAGE_ROOT = resolve('.local/operator-ui-storage');
  process.env.PLATFORM_OPERATOR_USERNAME = 'operador-ui';
  const password = randomBytes(16).toString('hex') + 'Qa!';
  process.env.PLATFORM_OPERATOR_PASSWORD_HASH = await hash(password, 12);
  process.env.PLATFORM_OPERATOR_JWT_SECRET = randomBytes(48).toString('hex');
  const app = await require('../dist/api/app').createApp();
  await app.listen(new URL(base).port, '127.0.0.1');
  const browser = await chromium.launch({ headless: true });
  const slug = 'operador-ui-' + randomUUID().slice(0, 8),
    owner = 'administradora@' + slug + '.test';
  const registry = app.get(require('../dist/api/tenancy/platform').TenantRegistry);
  let tenant;
  mkdirSync('.local/operator-ui', { recursive: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/?plataforma=1&plan=esencial');
    await page.getByLabel('Usuario de plataforma').fill('operador-ui');
    await page.getByLabel('Contraseña de plataforma').fill(password);
    await page.getByRole('button', { name: 'Entrar a plataforma', exact: true }).click();
    await page.getByRole('heading', { name: 'Administrar tiendas', exact: true }).waitFor();
    assert.equal(await page.locator('#platform-initial-plan').inputValue(), 'esencial');
    await page.getByLabel('Nombre de la tienda').fill('Operada UI');
    await page.getByLabel('Identificador de tienda').fill(slug);
    await page.getByLabel('Correo de la administradora').fill(owner);
    await page.getByLabel('Contraseña inicial').fill('PropietariaSoloQA2026!');
    await page.getByRole('button', { name: 'Preparar tienda', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Operada UI', exact: true })
      .waitFor({ timeout: 150000 });
    tenant = (
      await registry.pool.query('SELECT id,database_name FROM platform.tenant WHERE slug=$1', [
        slug,
      ])
    ).rows[0];
    assert.ok(tenant);
    assert.match(await page.locator('.operator-handoff').innerText(), /Fin de prueba/);
    await page.getByRole('button', { name: 'Copiar ficha de entrega' }).click();
    await page.getByRole('status').filter({ hasText: 'Ficha copiada' }).waitFor();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(text.includes(slug));
    assert.ok(text.includes(owner));
    assert.equal(text.includes('PropietariaSoloQA2026!'), false);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole('button', { name: 'Resumen', exact: true }).click();
      await page.getByRole('heading', { name: 'Distribución por plan' }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Overview overflow ' + width,
      );
      await page.screenshot({
        path: '.local/operator-ui/overview-' + width + '.png',
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Tiendas registradas', exact: true }).click();
      await page.getByLabel('Buscar por nombre o identificador').fill(slug);
      await page.getByRole('button', { name: 'Buscar', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('.platform-store-list .saas-section-heading span')?.textContent ===
          '1 de 1',
      );
      assert.equal(await page.locator('.operator-stores article').count(), 1);
      await page.getByRole('button', { name: 'Ver ficha', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      assert.match(await page.getByRole('dialog').innerText(), /En prueba/);
      assert.equal(
        await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
        'Detail overflow ' + width,
      );
      await page.screenshot({ path: '.local/operator-ui/detail-' + width + '.png' });
      await page.getByRole('button', { name: 'Cerrar ficha' }).click();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Listing overflow ' + width,
      );
      console.log('PASS: operator summary, search and detail at ' + width + 'px');
    }
    const store = await context.newPage();
    let directoryRequests = 0;
    store.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/platform/stores') directoryRequests++;
    });
    await store.goto(base + '/?tienda=' + slug);
    await store.getByLabel('Tienda actual').filter({ hasText: 'Operada UI' }).waitFor();
    assert.equal(await store.locator('select[aria-label=Tienda]').count(), 0);
    assert.equal(directoryRequests, 0);
    const catalog = await context.request.get(base + '/api/catalog', {
      headers: { 'X-Tenant-Slug': slug },
    });
    assert.equal((await catalog.json()).products.length, 0);
    await page.getByRole('button', { name: 'Salir de plataforma' }).click();
    await page.getByRole('heading', { name: 'Acceso de plataforma' }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      'PASS: manual creation, private handoff, empty own catalog, no global store selector and logout',
    );
  } finally {
    if (!tenant)
      tenant = (
        await registry.pool.query('SELECT id,database_name FROM platform.tenant WHERE slug=$1', [
          slug,
        ])
      ).rows[0];
    if (tenant) {
      await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query('DELETE FROM platform.tenant WHERE id=$1', [tenant.id]);
    }
    await browser.close();
    await app.close();
    if (tenant) {
      assert.match(tenant.database_name, /^store_[a-f0-9]{32}$/);
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      await client.query(`DROP DATABASE "${tenant.database_name}"`);
      await client.end();
      const root = resolve('.local/operator-ui-storage/tenants'),
        target = join(root, tenant.id);
      assert.ok(target.startsWith(root + require('path').sep));
      rmSync(target, { recursive: true, force: true });
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
