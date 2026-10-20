// Ejecutar después de db:prepare-test y build. Nunca conecta a la base comercial.
require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { randomUUID } = require('crypto');
const { mkdirSync, writeFileSync } = require('fs');
const { resolve } = require('path');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/vestidor18_test';
  process.env.DATABASE_URL = url.toString();
  process.env.PLATFORM_DATABASE_URL = url.toString();
  process.env.TENANT_DATABASE_URL = url.toString();
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  const port = Number(process.env.ADMIN_UI_TEST_PORT || 3021);
  const origin = `http://127.0.0.1:${port}`;
  process.env.WEB_ORIGIN = origin;
  const app = await require('../dist/api/app').createApp();
  await app.listen(port, '127.0.0.1');
  const db = new PrismaClient();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500)
      errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  mkdirSync('.local', { recursive: true });
  try {
    const password = 'SaasUiPrueba2026!';
    const email = `saas-ui-${randomUUID()}@grupo18.test`;
    const role = await db.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
    const admin = await db.usuario.create({
      data: {
        nombres: 'Prueba',
        apellidos: 'Módulos',
        correo: email,
        clave_hash: await hash(password, 12),
        estado: 'ACTIVO',
        preferencias: {},
        creado_en: new Date(),
        usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
      },
    });
    const variant = await db.variante.findUniqueOrThrow({ where: { sku: 'G18-W21-S' } });
    const location = await db.ubicacion.create({
      data: { nombre: `Prueba UI ${randomUUID()}`, tipo: 'TIENDA', activa: true },
    });
    await db.inventario.create({
      data: {
        variante_id: variant.id,
        ubicacion_id: location.id,
        fisico: 5,
        reservado: 0,
        comprometido: 0,
        version: 1,
      },
    });
    await db.disponibilidad_canal.create({
      data: {
        variante_id: variant.id,
        ubicacion_id: location.id,
        canal: 'TIENDA',
        habilitada: true,
        stock_seguridad: 0,
        plazo_reposicion_dias: 0,
      },
    });
    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await page.getByRole('button', { name: 'Administración', exact: true }).click();
    await expect(page.locator('.business-workspace')).toBeVisible();
    const nav = page.locator('.business-sidebar');
    for (const [label, heading] of [
      ['Catálogo y vestidor', 'Catálogo y vestidor'],
      ['Inventario', 'Inventario y movimientos'],
      ['Sucursales y almacenes', 'Sucursales y almacenes'],
      ['Equipo y permisos', 'Equipo y permisos'],
    ]) {
      await nav.getByRole('button', { name: label, exact: true }).click();
      await expect(
        page.getByRole('heading', { name: heading, level: 1, exact: true }),
      ).toBeVisible();
      if (label === 'Catálogo y vestidor')
        await expect(
          page.getByRole('heading', { name: 'Nueva ubicación', exact: true }),
        ).toHaveCount(0);
      if (label === 'Inventario')
        await expect(page.getByRole('heading', { name: 'Nueva prenda', exact: true })).toHaveCount(
          0,
        );
    }
    await nav.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page.locator('.business-kpis')).toBeVisible();
    const secondTab = await page.context().newPage();
    await secondTab.goto(`${origin}/api/health`);
    await secondTab.evaluate(() => localStorage.setItem('lumina.selected-store', 'otra-tienda'));
    await secondTab.close();
    const originalStoreRequest = page.waitForRequest((r) =>
      r.url().includes('/api/reports/summary'),
    );
    await page.locator('.business-refresh').click();
    expect((await originalStoreRequest).headers()['x-tenant-slug']).toBe('lumina');
    await page.screenshot({ path: '.local/saas-admin-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.local/saas-admin-mobile-web.png', fullPage: true });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw Error('La administración desborda el ancho móvil.');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await nav.getByRole('button', { name: 'Vender', exact: true }).click();
    await page.getByLabel(/Sucursal o almacén/).selectOption(location.id);
    await page.getByLabel(/^Prenda/).selectOption(variant.id);
    await page.getByRole('button', { name: 'Añadir', exact: true }).click();
    await page.getByLabel(/Método de pago/).selectOption('QR');
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/api/sales') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Confirmar venta', exact: true }).click();
    const response = await saved;
    const sale = await response.json();
    expect(response.status()).toBe(201);
    await expect(page.locator('.sales-page .message:not(.error)')).toContainText(sale.numero);
    await expect(page.locator('.recent-sales')).toContainText(sale.numero);
    const persisted = await db.pedido.findUniqueOrThrow({ where: { id: sale.id } });
    expect(persisted.vendedor_id).toBe(admin.id);
    expect(persisted.estado).toBe('CONFIRMADO');
    // El informe debe incluir esta venta de la ubicación exclusiva de la prueba.
    await nav.getByRole('button', { name: 'Reportes y análisis', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Reportes/, level: 1 })).toBeVisible();
    for (const [roleName, allowed, denied] of [
      ['Vendedor', 'Vender', 'Reportes y análisis'],
      ['Analista', 'Reportes y análisis', 'Vender'],
    ]) {
      const staffRole = await db.rol.findUniqueOrThrow({ where: { nombre: roleName } });
      const staffEmail = `saas-ui-${randomUUID()}@grupo18.test`;
      await db.usuario.create({
        data: {
          nombres: 'Prueba',
          apellidos: roleName,
          correo: staffEmail,
          estado: 'ACTIVO',
          preferencias: {},
          creado_en: new Date(),
          clave_hash: await hash(password, 12),
          usuario_rol: { create: { rol_id: staffRole.id, asignado_en: new Date() } },
          usuario_ubicacion: { create: { ubicacion_id: location.id } },
        },
      });
      await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await page.getByLabel('Correo electrónico', { exact: true }).fill(staffEmail);
      await page.getByLabel('Contraseña', { exact: true }).fill(password);
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Iniciar sesión', exact: true })
        .click();
      await page.getByRole('button', { name: 'Administración', exact: true }).click();
      await expect(nav.getByRole('button', { name: allowed, exact: true })).toBeVisible();
      await expect(nav.getByRole('button', { name: denied, exact: true })).toHaveCount(0);
      await expect(nav.getByRole('button', { name: 'Equipo y permisos', exact: true })).toHaveCount(
        0,
      );
      await nav.getByRole('button', { name: 'Inventario', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Inventario y movimientos', level: 1, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Nueva prenda', exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    writeFileSync(
      '.local/saas-ui-result.json',
      JSON.stringify(
        {
          modules: true,
          tabIsolation: true,
          mobileOverflow: false,
          saleRecorded: true,
          order: sale.numero,
          errors,
        },
        null,
        2,
      ),
    );
    console.log('Administración modular, ancho móvil, venta persistida y confirmación visual: OK.');
  } catch (error) {
    await page.screenshot({ path: '.local/saas-ui-failure.png', fullPage: true });
    throw error;
  } finally {
    await browser.close();
    await db.$disconnect();
    await app.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
