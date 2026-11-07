// Aceptación local de compra. No usa Stripe externo ni ejecuta un APK.
require('dotenv/config');
require('tsx/cjs');
const { chromium, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
async function main() {
  const database = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(database.hostname))
    throw new Error('Usa PostgreSQL local de pruebas.');
  database.pathname = '/vestidor18_test';
  for (const key of ['DATABASE_URL', 'PLATFORM_DATABASE_URL', 'TENANT_DATABASE_URL'])
    process.env[key] = database.toString();
  const port = Number(process.env.CHECKOUT_UI_PORT || 3034),
    origin = 'http://127.0.0.1:' + port;
  process.env.SERVE_WEB = 'true';
  process.env.WEB_ROOT = resolve('dist/web');
  process.env.WEB_ORIGIN = origin;
  process.env.STRIPE_SECRET_KEY = '';
  const { commerceFixture } = require('../apps/api/test/helpers/commerce.ts');
  const f = await commerceFixture();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1360, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  mkdirSync('.local', { recursive: true });
  try {
    await f.app.listen(port, '127.0.0.1');
    const item = await f.item();
    expect(
      (await f.http('post', '/commerce/cart/items', { variantId: item.variantId, quantity: 1 }))
        .status,
    ).toBe(201);
    const checkout = await f.http('post', '/commerce/checkout', {
      locationId: item.locationId,
      address: 'Avenida de prueba 123, La Paz',
      idempotency: randomUUID(),
    });
    expect(checkout.status).toBe(201);
    const order = checkout.body;
    await page.goto(origin + '/?tienda=' + f.tenant.slug);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(f.tenant.slug + '@qa.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('BillingPrueba2026!');
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Mi carrito', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir QR de prueba', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Finaliza tu compra' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Esperando escaneo…', { exact: true })).toBeVisible();
    await expect(dialog.locator('svg title')).toHaveText('QR de prueba del pedido ' + order.numero);
    await page.screenshot({ path: '.local/checkout-qr-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.local/checkout-qr-mobile.png', fullPage: true });
    const qr = 'LUMINA-PAY-DEMO:' + order.id + ':50.00:BOB';
    const scan = () =>
      f.http('post', '/commerce/demo-wallet/scan', { qr, idempotency: order.id }, 'APP');
    const results = await Promise.all([scan(), scan()]);
    expect(results.map((row) => row.status)).toEqual([201, 201]);
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText('QR escaneado. Pago de demostración confirmado.', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Mi carrito', exact: true }).click();
    const orders = await f.http('get', '/commerce/orders');
    expect(orders.body.find((row) => row.id === order.id)).toMatchObject({
      canal: 'WEB',
      estado: 'CONFIRMADO',
    });
    await f.inStore(async () => {
      expect(
        await f.db.movimiento_stock.count({ where: { pedido_id: order.id, tipo: 'SALIDA' } }),
      ).toBe(1);
      expect(
        (await f.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } })).fisico,
      ).toBe(9);
    });
    expect(errors).toEqual([]);
    await page.screenshot({ path: '.local/checkout-confirmed-mobile.png', fullPage: true });
    console.log(
      'Compra WEB confirmada desde APP por QR: reapertura persistida, un pago, una salida y stock=9. Chromium escritorio/390 px, sin errores de página.',
    );
  } catch (error) {
    await page.screenshot({ path: '.local/checkout-error.png', fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await f.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
