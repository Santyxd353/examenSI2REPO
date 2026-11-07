// Local browser acceptance. A separate test tenant and a generated QA avatar exercise the real routes.
require('dotenv/config');
require('tsx/cjs');
const { chromium, expect } = require('@playwright/test');
const { randomUUID, randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { mkdtemp, mkdir } = require('node:fs/promises');
const { resolve } = require('node:path');
const { promisify } = require('node:util');
const { PrismaClient } = require('@prisma/client');
const { Client } = require('pg');

async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(database.hostname))
    throw new Error('La prueba necesita PostgreSQL local.');
  database.pathname = '/vestidor18_test';
  for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[key] = database.toString();
  const port = 3029,
    origin = 'http://127.0.0.1:' + port;
  const workspace = await mkdtemp(resolve('.local', 'offline-web-qa-'));
  process.env.STORAGE_ROOT = resolve(workspace, 'storage');
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.WEB_ORIGIN = origin;
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  const { createApp } = require('../dist/api/app');
  const { TenantRegistry } = require('../dist/api/tenancy/platform');
  const { provisionTenant } = require('../dist/api/tenancy/provision');
  const { seedWomen } = require('./seed-women.ts');
  const app = await createApp();
  const registry = app.get(TenantRegistry);
  let tenant, db, context;
  const slug = 'qa-offline-' + randomUUID().slice(0, 8);
  const email = slug + '@qa.test',
    password = 'OfflineWeb2026!Segura',
    url = origin + '/?tienda=' + slug;
  const profile = resolve(workspace, 'chromium');
  const errors = [];
  async function open(offline = false) {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 1360, height: 900 },
    });
    await context.setOffline(offline);
    const page = context.pages()[0] ?? (await context.newPage());
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    return page;
  }
  try {
    await app.listen(port, '127.0.0.1');
    tenant = await provisionTenant(
      {
        slug,
        name: 'Lúmina offline QA',
        ownerEmail: email,
        ownerPassword: password,
        planCode: 'esencial',
      },
      registry,
    );
    db = new PrismaClient({ datasourceUrl: tenant.databaseUrl });
    const location = await db.ubicacion.findFirstOrThrow();
    await seedWomen(db, { storageRoot: tenant.storageDirectory, locationId: location.id });
    const owner = await db.usuario.findUniqueOrThrow({ where: { correo: email } });
    const template = await db.plantilla_corporal.findFirstOrThrow();
    const avatarDir = resolve(tenant.storageDirectory, 'private', 'offline-qa-avatar');
    await mkdir(avatarDir, { recursive: true });
    const parameters = {
      height: 1.7,
      chest_width: 0.4,
      chest_depth: 0.25,
      waist_width: 0.32,
      hip_width: 0.4,
      plantilla: 'g18-1',
    };
    await promisify(execFile)(
      resolve(process.env.PYTHON_PATH),
      [
        '-c',
        'import sys,json;from pathlib import Path;from process import export;export(json.loads(sys.argv[1]),Path(sys.argv[2]))',
        JSON.stringify(parameters),
        avatarDir,
      ],
      {
        cwd: resolve('workers/avatar'),
        env: { ...process.env },
        windowsHide: true,
        timeout: 120000,
      },
    );
    await db.avatar.create({
      data: {
        usuario_id: owner.id,
        plantilla_id: template.id,
        version: 1,
        estado: 'APROBADO',
        clave_glb: 'private/offline-qa-avatar/avatar.glb',
        medidas: { altura: { valor_cm: 170 } },
        creado_en: new Date(),
        aprobado_en: new Date(),
      },
    });
    let page = await open();
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await page.getByRole('button', { name: 'Descargas', exact: true }).click();
    await page.getByLabel('Tallas preferidas').fill('L');
    await page.getByLabel('Marcas favoritas').fill('Nike');
    await page.getByLabel('Autorizo guardar mi avatar aprobado', { exact: false }).check();
    await page.getByRole('button', { name: 'Preparar paquete' }).click();
    await expect(page.getByRole('heading', { name: '10 prendas disponibles' })).toBeVisible({
      timeout: 25000,
    });
    let altered = false;
    await page.route('**/api/offline/outfits/*/files/*', async (route) => {
      if (altered) return route.continue();
      altered = true;
      const response = await route.fetch();
      const bytes = await response.body();
      bytes[28] ^= 1;
      await route.fulfill({ response, body: bytes });
    });
    await page.getByRole('button', { name: 'Descargar paquete' }).click();
    await expect(page.getByRole('heading', { name: '9 de 10 prendas · Parcial' })).toBeVisible({
      timeout: 30000,
    });
    await page.unroute('**/api/offline/outfits/*/files/*');
    await page.getByRole('button', { name: 'Reintentar' }).click();
    await expect(page.getByRole('heading', { name: '10 de 10 prendas · Lista' })).toBeVisible({
      timeout: 30000,
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const cachePaths = await page.evaluate(async () => {
      const keys = await caches.keys(),
        paths = [];
      for (const key of keys)
        for (const request of await (await caches.open(key)).keys())
          paths.push(new URL(request.url).pathname);
      return paths;
    });
    expect(cachePaths).toContain('/');
    expect(
      cachePaths.every((path) => path === '/' || /^\/assets\/[^/]+\.(js|css|woff2?)$/.test(path)),
    ).toBe(true);
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    await page
      .getByRole('complementary', { name: 'Módulos administrativos' })
      .getByRole('button', { name: 'Sincronización', exact: true })
      .click();
    await page.getByRole('button', { name: 'Descargar copia', exact: true }).click();
    await expect(page.getByText('Copia verificada y guardada en este dispositivo.')).toBeVisible();
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Inventario offline', exact: true }).click();
    const variantId = await page.getByLabel('Variante', { exact: true }).inputValue();
    const locationId = await page.getByLabel('Ubicación', { exact: true }).inputValue();
    const stock = await db.inventario.findFirstOrThrow({
      where: { variante_id: variantId, ubicacion_id: locationId },
    });
    await page.getByLabel('Cambio de unidades').fill('3');
    await page.getByLabel('Motivo', { exact: true }).fill('Entrada offline QA');
    await page.getByRole('button', { name: 'Guardar inventario pendiente' }).click();
    await expect(
      page.getByText(
        `Físico en el corte: ${stock.fisico}. Proyección pendiente: ${stock.fisico + 3}.`,
      ),
    ).toBeVisible();
    await page.getByLabel('Operación', { exact: true }).selectOption('STOCK_COUNT');
    await page.getByLabel('Unidades contadas').fill(String(stock.fisico + 4));
    await page.getByLabel('Motivo', { exact: true }).fill('Conteo offline QA');
    await page.getByRole('button', { name: 'Guardar inventario pendiente' }).click();
    await expect(page.getByRole('button', { name: 'Cambios (2)' })).toBeVisible();
    await page.getByRole('button', { name: 'Catálogo offline', exact: true }).click();
    const productName = 'Vestido de prueba offline';
    await page.getByLabel('Nombre', { exact: true }).fill(productName);
    await page
      .getByLabel('Descripción', { exact: true })
      .fill('Vestido para verificar alta y edición offline.');
    await page.getByLabel('Material', { exact: true }).fill('Algodón');
    await page.getByLabel('Marca', { exact: true }).fill('Lúmina QA');
    await page.getByLabel('Categoría', { exact: true }).selectOption({ label: 'Vestidos' });
    await page.getByLabel('SKU', { exact: true }).fill('OFFLINE-QA-S');
    await page.getByLabel('Talla', { exact: true }).fill('S');
    await page.getByLabel('Color', { exact: true }).fill('Malva');
    for (const channel of ['WEB', 'APP', 'TIENDA'])
      await page.getByLabel('Precio ' + channel + ' (Bs)').fill('149.90');
    await page.getByText('Adjuntar recurso local', { exact: true }).click();
    await page
      .getByLabel('Archivo', { exact: true })
      .setInputFiles(resolve('catalog-assets/women/nike-chill-cami.jpg'));
    await page.getByLabel('Licencia o autorización').fill('Referencia académica de prueba');
    await page.getByRole('button', { name: 'Guardar catálogo pendiente' }).click();
    await expect(page.getByRole('button', { name: 'Cambios (3)' })).toBeVisible();
    await page
      .getByLabel('Prenda', { exact: true })
      .selectOption({ label: productName + ' · Pendiente' });
    const updatedName = productName + ' revisado';
    await page.getByLabel('Nombre', { exact: true }).fill(updatedName);
    await page.getByRole('button', { name: 'Guardar catálogo pendiente' }).click();
    await expect(page.getByRole('button', { name: 'Cambios (4)' })).toBeVisible();
    expect(await db.producto.count({ where: { nombre: { in: [productName, updatedName] } } })).toBe(
      0,
    );

    await context.close();
    page = await open(true);
    await expect(page.getByRole('heading', { name: 'Sincronización', exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('button', { name: 'Cambios (4)' })).toBeVisible();
    await page.getByRole('button', { name: 'Descargas', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Descargas', exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('heading', { name: '10 de 10 prendas · Lista' })).toBeVisible();
    await page.locator('.offline-garment').first().click();
    await expect(page.getByText('Tu avatar personal', { exact: true })).toBeVisible();
    await expect(page.locator('.viewer-shell canvas')).toBeVisible();
    await expect(page.locator('.viewer-status')).toHaveCount(0, { timeout: 20000 });
    await page.screenshot({ path: resolve('.local', 'offline-web-3d.png'), fullPage: true });
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    let lost = false;
    await page.route('**/api/offline/sync', async (route) => {
      const result = await route.fetch();
      expect(result.status()).toBe(201);
      lost = true;
      await route.abort('failed');
    });
    await context.setOffline(false);
    await expect.poll(() => lost).toBe(true);
    await expect(page.getByText('Ajuste de stock · Pendiente', { exact: true })).toBeVisible();
    await page.unroute('**/api/offline/sync');
    await page.getByRole('button', { name: 'Enviar pendientes', exact: true }).click();
    await expect(
      page.getByText('3 confirmados, 1 conflictos y 0 bloqueados.', { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect((await db.inventario.findUniqueOrThrow({ where: { id: stock.id } })).fisico).toBe(
      stock.fisico + 3,
    );
    const created = await db.producto.findFirstOrThrow({ where: { nombre: updatedName } });
    expect(created.version).toBe(2);
    expect(
      await db.recurso_catalogo.count({ where: { producto_id: created.id, uso: 'GALERIA' } }),
    ).toBe(1);
    await expect(page.getByText('Conteo · Conflicto', { exact: true })).toBeVisible();
    await page
      .getByRole('button', { name: 'Conciliar con el saldo del corte', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Conciliar inventario' })).toBeVisible();
    await page.getByRole('button', { name: 'Guardar inventario pendiente' }).click();
    await expect(page.getByRole('button', { name: 'Cambios (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Enviar pendientes', exact: true }).click();
    await expect(
      page.getByText('1 confirmados, 0 conflictos y 0 bloqueados.', { exact: true }),
    ).toBeVisible();
    expect((await db.inventario.findUniqueOrThrow({ where: { id: stock.id } })).fisico).toBe(
      stock.fisico + 4,
    );
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Catálogo offline', exact: true }).click();
    await page.getByLabel('Prenda', { exact: true }).selectOption({ label: updatedName });
    await page.getByLabel('Archivar prenda', { exact: true }).check();
    await page.getByLabel('Motivo de archivo', { exact: true }).fill('Retiro offline QA');
    await page.getByRole('button', { name: 'Guardar catálogo pendiente' }).click();
    await expect(page.getByRole('button', { name: 'Cambios (1)' })).toBeVisible();
    await context.setOffline(false);
    await expect
      .poll(async () => (await db.producto.findUniqueOrThrow({ where: { id: created.id } })).estado)
      .toBe('RETIRADO');
    await page.screenshot({ path: resolve('.local', 'offline-web-sync.png'), fullPage: true });
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByRole('button', { name: 'Conservar pendientes' }).click();
    await expect(page.getByRole('button', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Descargas', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log(
      'Chromium reabrió el vestidor y la cola sin red. Diez prendas y avatar renderizados, recursos corruptos recuperados, catálogo y stock confirmados, conflicto conciliado y reenvío sin duplicación.',
    );
  } catch (error) {
    await context
      ?.pages()[0]
      ?.screenshot({ path: resolve('.local', 'offline-web-failure.png'), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await context?.close();
    await db?.$disconnect();
    if (tenant) {
      await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query('DELETE FROM platform.tenant WHERE id=$1', [tenant.id]);
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
