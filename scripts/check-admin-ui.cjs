// Ejecutar después de db:prepare-test y build. Nunca conecta a la base comercial.
require('dotenv/config');
const { chromium, expect } = require('@playwright/test');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { randomUUID } = require('crypto');
const { mkdirSync, writeFileSync } = require('fs');
const { resolve } = require('path');
const { PNG } = require('pngjs');

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
    const category = await db.categoria.findFirstOrThrow({ where: { activa: true } });
    const catalogName = `Vestido UI ${randomUUID().slice(0, 8)}`;
    const catalogProduct = await db.producto.create({
      data: {
        categoria_id: category.id,
        nombre: catalogName,
        descripcion: 'Vestido femenino para comprobación visual local.',
        material: 'Algodón',
        marca: 'QA',
        coleccion: 'Primavera',
        estado: 'PUBLICADO',
        creado_en: new Date(),
      },
    });
    const catalogVariant = await db.variante.create({
      data: {
        producto_id: catalogProduct.id,
        sku: `QA-${randomUUID()}`,
        talla: 'S',
        color: 'Rosa',
        activa: true,
      },
    });
    await db.precio_canal.createMany({
      data: ['WEB', 'APP', 'TIENDA'].map((canal) => ({
        variante_id: catalogVariant.id,
        canal,
        moneda: 'BOB',
        importe: 50,
        descuento_pct: 0,
        desde: new Date(),
      })),
    });
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
    await nav.getByRole('button', { name: 'Equipo y permisos', exact: true }).click();
    const team = page.locator('.team-module');
    await team.getByRole('button', { name: 'Agregar integrante', exact: true }).click();
    const teamForm = team.getByRole('form', { name: 'Datos del integrante' });
    const teammateEmail = `equipo-ui-${randomUUID()}@qa.test`;
    await teamForm.getByLabel('Nombres', { exact: true }).fill('Ana');
    await teamForm.getByLabel('Apellidos', { exact: true }).fill('Prueba UI');
    await teamForm.getByLabel('Correo', { exact: true }).fill(teammateEmail);
    await teamForm.getByLabel('Contraseña inicial', { exact: true }).fill(password);
    await teamForm.getByLabel('Rol', { exact: true }).selectOption('Analista');
    await expect(teamForm.getByText('Consultar reportes', { exact: true })).toBeVisible();
    await teamForm.getByRole('button', { name: 'Guardar integrante', exact: true }).click();
    await expect(teamForm).toHaveCount(0);
    await team.getByLabel('Buscar integrante').fill(teammateEmail);
    let member = team.locator('.management-card').filter({ hasText: teammateEmail });
    await member.getByRole('button', { name: 'Editar', exact: true }).click();
    await teamForm.getByLabel('Estado', { exact: true }).selectOption('SUSPENDIDO');
    await teamForm.getByLabel('Motivo', { exact: true }).fill('Suspensión de prueba visual');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw Error('Equipo desborda en móvil.');
    await team.screenshot({ path: '.local/team-mobile.png' });
    await teamForm.getByRole('button', { name: 'Guardar integrante', exact: true }).click();
    await expect(member.getByText('Suspendida', { exact: true })).toBeVisible();
    expect((await db.usuario.findUniqueOrThrow({ where: { correo: teammateEmail } })).estado).toBe(
      'SUSPENDIDO',
    );
    await member.getByRole('button', { name: 'Editar', exact: true }).click();
    await teamForm.getByLabel('Estado', { exact: true }).selectOption('ACTIVO');
    await teamForm.getByRole('button', { name: 'Guardar integrante', exact: true }).click();
    await expect(member.getByText('Activa', { exact: true })).toBeVisible();
    await context.setOffline(true);
    await expect(
      team.getByRole('button', { name: 'Agregar integrante', exact: true }),
    ).toBeDisabled();
    await expect(member.getByRole('button', { name: 'Editar', exact: true })).toBeDisabled();
    await expect(member.getByText(teammateEmail, { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(member.getByRole('button', { name: 'Editar', exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await nav.getByRole('button', { name: 'Sucursales y almacenes', exact: true }).click();
    const locationsModule = page.locator('.locations-module');
    await locationsModule.getByRole('button', { name: 'Agregar ubicación', exact: true }).click();
    const locationForm = locationsModule.getByRole('form', { name: 'Datos de la ubicación' });
    const branchName = `Sucursal UI ${randomUUID().slice(0, 8)}`;
    await locationForm.getByLabel('Nombre', { exact: true }).fill(branchName);
    await locationForm.getByLabel('Tipo', { exact: true }).selectOption('ALMACEN');
    await locationForm.getByLabel('Responsable', { exact: true }).selectOption(admin.id);
    await locationForm.getByRole('button', { name: 'Guardar ubicación', exact: true }).click();
    await expect(locationForm).toHaveCount(0);
    await locationsModule.getByLabel('Buscar ubicación').fill(branchName);
    const branchCard = locationsModule.locator('.management-card').filter({ hasText: branchName });
    await branchCard.getByRole('button', { name: 'Editar', exact: true }).click();
    await locationForm.getByLabel('Estado', { exact: true }).selectOption('false');
    await locationForm.getByLabel('Motivo', { exact: true }).fill('Cierre de prueba visual');
    await locationForm.getByRole('button', { name: 'Guardar ubicación', exact: true }).click();
    await expect(branchCard.getByText('Inactiva', { exact: true })).toBeVisible();
    await branchCard.getByRole('button', { name: 'Editar', exact: true }).click();
    await locationForm.getByLabel('Estado', { exact: true }).selectOption('true');
    await locationForm.getByRole('button', { name: 'Guardar ubicación', exact: true }).click();
    await expect(branchCard.getByText('Activa', { exact: true })).toBeVisible();
    await locationsModule.screenshot({ path: '.local/locations-desktop.png' });
    const branchPersisted = await db.ubicacion.findFirstOrThrow({ where: { nombre: branchName } });
    expect(branchPersisted).toMatchObject({
      activa: true,
      tipo: 'ALMACEN',
      responsable_id: admin.id,
      version: 3,
    });
    await nav.getByRole('button', { name: 'Catálogo y vestidor', exact: true }).click();
    const manager = page.locator('.catalog-manager');
    await manager.getByLabel('Buscar prenda, marca o código').fill(catalogName);
    await manager.getByRole('button', { name: 'Editar', exact: true }).click();
    const editor = manager.locator('.catalog-editor');
    await editor.getByLabel('Colección', { exact: true }).fill('Colección actualizada');
    await editor.getByLabel('Precio web (Bs)', { exact: true }).fill('59.90');
    await editor.getByLabel('Código de barras', { exact: true }).fill(`QA-${randomUUID()}`);
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1))
      throw Error('El editor de catálogo desborda en móvil.');
    await editor.screenshot({ path: '.local/catalog-editor-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await editor.screenshot({ path: '.local/catalog-editor-desktop.png' });
    await editor.getByRole('button', { name: 'Guardar prenda', exact: true }).click();
    await expect(manager.getByRole('status')).toContainText('Prenda actualizada');
    expect(
      (await db.producto.findUniqueOrThrow({ where: { id: catalogProduct.id } })).coleccion,
    ).toBe('Colección actualizada');
    const updatedPrice = await db.precio_canal.findFirstOrThrow({
      where: { variante_id: catalogVariant.id, canal: 'WEB', hasta: null },
      orderBy: { desde: 'desc' },
    });
    expect(Number(updatedPrice.importe)).toBe(59.9);
    await manager.getByRole('button', { name: 'Fotos', exact: true }).click();
    const photoPanel = manager.locator('.catalog-photo-editor');
    const png = new PNG({ width: 300, height: 300 });
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 217;
      png.data[i + 1] = 143;
      png.data[i + 2] = 172;
      png.data[i + 3] = 255;
    }
    await photoPanel.locator('input[type=file]').setInputFiles({
      name: 'galeria-qa.png',
      mimeType: 'image/png',
      buffer: PNG.sync.write(png),
    });
    await photoPanel
      .getByLabel('Licencia o autorización de las imágenes')
      .fill('Imagen sintética QA');
    await photoPanel.getByRole('button', { name: 'Subir fotos', exact: true }).click();
    await expect(photoPanel.locator('figure')).toHaveCount(1);
    await photoPanel.getByRole('button', { name: 'Ocultar', exact: true }).click();
    await expect(photoPanel.getByRole('button', { name: 'Mostrar', exact: true })).toBeVisible();
    await photoPanel.getByRole('button', { name: 'Cerrar fotos', exact: true }).click();
    page.once('dialog', (dialog) => dialog.accept('Fin de prueba de catálogo'));
    await manager.getByRole('button', { name: 'Archivar', exact: true }).click();
    await expect(manager.locator('.catalog-management-list .status')).toHaveText('ARCHIVADO');
    expect((await db.producto.findUniqueOrThrow({ where: { id: catalogProduct.id } })).estado).toBe(
      'RETIRADO',
    );
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
    await nav.getByRole('button', { name: 'Reportes paramétricos', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Reportes/, level: 1 })).toBeVisible();
    for (const [roleName, allowed, denied] of [
      ['Vendedor', 'Vender', 'Reportes paramétricos'],
      ['Analista', 'Reportes paramétricos', 'Vender'],
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
          teamLifecycle: true,
          locationLifecycle: true,
          catalogEdited: true,
          catalogPhotoManaged: true,
          catalogArchived: true,
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
