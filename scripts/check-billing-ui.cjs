require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { PrismaClient } = require('@prisma/client');
const { Client } = require('pg');
const { hash } = require('bcryptjs');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Solo QA local.');
  url.pathname = '/vestidor18_test';
  for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[key] = url.toString();
  const origin = 'http://127.0.0.1:3022';
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.WEB_ORIGIN = origin;
  const operatorPassword = `PlataformaQA${randomBytes(8).toString('hex')}!`;
  process.env.PLATFORM_OPERATOR_USERNAME = 'operadora-ui-qa';
  process.env.PLATFORM_OPERATOR_PASSWORD_HASH = await hash(operatorPassword, 10);
  process.env.PLATFORM_OPERATOR_JWT_SECRET = randomBytes(48).toString('hex');
  const app = await require('../dist/api/app').createApp();
  await app.listen(3022, '127.0.0.1');
  const registry = app.get(require('../dist/api/tenancy/platform').TenantRegistry);
  const db = new PrismaClient();
  await require('../dist/api/tenancy/defaults').seedTenantRoles(db);
  const actor = randomUUID(),
    email = `${actor}@ui-qa.test`,
    password = 'AdministradoraUI2026!';
  const slug = 'ui-plan-' + randomUUID().replaceAll('-', '').slice(0, 12);
  const adminRole = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
  await db.usuario.create({
    data: {
      id: actor,
      nombres: 'UI',
      apellidos: 'Planes',
      correo: email,
      clave_hash: await hash(password, 10),
      estado: 'ACTIVO',
      preferencias: {},
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: adminRole.id, asignado_en: new Date() } },
    },
  });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  mkdirSync('.local', { recursive: true });
  let storeDatabase;
  try {
    const operator = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    operator.on('pageerror', (e) => errors.push(e.message));
    await operator.goto(origin + '/?plataforma=1');
    await expect(
      operator.getByRole('heading', { name: 'Acceso de plataforma', exact: true }),
    ).toBeVisible();
    await operator.getByLabel('Usuario de plataforma', { exact: true }).fill('operadora-ui-qa');
    await operator.getByLabel('Contraseña de plataforma', { exact: true }).fill(operatorPassword);
    await operator.getByRole('button', { name: 'Entrar a plataforma', exact: true }).click();
    await expect(
      operator.getByRole('heading', { name: 'Administrar tiendas', exact: true }),
    ).toBeVisible();
    await operator.getByLabel('Nombre de la tienda', { exact: true }).fill('Tienda UI femenina');
    await operator.getByLabel('Identificador de tienda', { exact: true }).fill(slug);
    await operator
      .getByLabel('Correo de la administradora', { exact: true })
      .fill(`${slug}@ui-qa.test`);
    await operator.getByLabel('Contraseña inicial', { exact: true }).fill('PropietariaUI2026!');
    await operator.getByLabel('Plan inicial', { exact: true }).selectOption('esencial');
    await operator.getByRole('button', { name: 'Preparar tienda', exact: true }).click();
    await expect(operator.getByText('Tienda preparada', { exact: true })).toBeVisible({
      timeout: 45000,
    });
    await expect(operator.getByText(slug, { exact: true })).toBeVisible();
    await operator.setViewportSize({ width: 390, height: 844 });
    expect(await operator.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const header = await operator.locator('.platform-top').boundingBox();
    const exit = await operator
      .getByRole('button', { name: 'Salir de plataforma', exact: true })
      .boundingBox();
    expect(header.y + header.height).toBeGreaterThanOrEqual(exit.y + exit.height + 12);
    await operator.screenshot({ path: '.local/billing-operator-mobile.png', fullPage: true });
    await operator.getByRole('button', { name: 'Salir de plataforma', exact: true }).click();
    await expect(
      operator.getByRole('heading', { name: 'Acceso de plataforma', exact: true }),
    ).toBeVisible();
    await operator.context().setOffline(true);
    await operator.getByLabel('Usuario de plataforma', { exact: true }).fill('operadora-ui-qa');
    await operator.getByLabel('Contraseña de plataforma', { exact: true }).fill(operatorPassword);
    await operator.getByRole('button', { name: 'Entrar a plataforma', exact: true }).click();
    await expect(operator.getByRole('alert')).toContainText('Se perdió la conexión');
    await operator.context().setOffline(false);

    const business = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    business.on('pageerror', (e) => errors.push(e.message));
    await business.goto(origin);
    await business.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await business.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await business.getByLabel('Contraseña', { exact: true }).fill(password);
    await business
      .getByRole('dialog')
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await business.getByRole('button', { name: 'Administración', exact: true }).click();
    await business
      .locator('.business-sidebar')
      .getByRole('button', { name: 'Mi negocio y plan', exact: true })
      .click();
    await expect(
      business.getByRole('heading', { name: 'Mi negocio y plan', exact: true }),
    ).toBeVisible();
    await expect(
      business.getByRole('heading', { name: 'Consumo del período', exact: true }),
    ).toBeVisible();
    for (const name of ['Esencial', 'Profesional', 'Negocio'])
      await expect(business.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(business.getByText('Sin cobro comercial', { exact: true })).toBeVisible();
    await business.setViewportSize({ width: 390, height: 844 });
    expect(await business.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await business.screenshot({ path: '.local/billing-business-mobile.png', fullPage: true });
    await business.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
    console.log(
      'PASS: portal global, provisión real, login separado, planes/consumo y ancho móvil en Chromium.',
    );
  } finally {
    await browser.close();
    const row = (
      await registry.pool.query('SELECT id,database_name FROM platform.tenant WHERE slug=$1', [
        slug,
      ])
    ).rows[0];
    if (row) {
      storeDatabase = row.database_name;
      await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [row.id]);
      await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [row.id]);
      await registry.pool.query('DELETE FROM platform.tenant WHERE id=$1', [row.id]);
    }
    await db.sesion.deleteMany({ where: { usuario_id: actor } });
    await db.usuario_rol.deleteMany({ where: { usuario_id: actor } });
    await db.usuario.deleteMany({ where: { id: actor } });
    await db.$disconnect();
    await app.close();
    if (storeDatabase) {
      if (!/^store_[a-f0-9]{32}$/.test(storeDatabase))
        throw new Error('Base de limpieza no autorizada.');
      const cleanup = new Client({ connectionString: url.toString() });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE "${storeDatabase}"`);
      await cleanup.end();
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
