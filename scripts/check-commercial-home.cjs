const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { mkdirSync } = require('node:fs');

async function main() {
  const base = process.env.COMMERCIAL_TEST_URL || 'http://127.0.0.1:4173';
  const output = process.env.COMMERCIAL_TEST_OUTPUT || '.local/commercial-home';
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let context;
  try {
    context = await browser.newContext();
    if (new URL(base).hostname === '127.0.0.1') {
      // Preview serves the built frontend; use only public GET data from the deployed API.
      await context.route('**/api/**', async (route) => {
        if (route.request().method() !== 'GET') return route.fulfill({ status: 401, json: {} });
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: 'https://lumina.20-25-26-113.sslip.io' + url.pathname + url.search,
        });
        return route.fulfill({ response });
      });
      await context.route('**/assets/catalog-women/**', async (route) => {
        const response = await route.fetch({
          url: 'https://lumina.20-25-26-113.sslip.io' + new URL(route.request().url()).pathname,
        });
        return route.fulfill({ response });
      });
    }
    const page = await context.newPage();
    const errors = [];
    let directoryRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.toLowerCase() === '/api/platform/stores')
        directoryRequests++;
    });
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [1440, 1101, 1100, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { level: 1, name: /Tu moda tiene futuro/ }).waitFor();
      assert.equal(await page.locator('.sh-plan').count(), 3);
      assert.equal(await page.locator('.sh-store-link').count(), 0);
      assert.equal(await page.locator('.sh-store-directory').count(), 0);
      assert.equal(directoryRequests, 0, 'The public home must not request a tenant directory');
      assert.equal(await page.locator('a[href*="tienda=universidad"]').count(), 0);
      assert.equal(
        await page.getByRole('heading', { name: 'Un espacio para tu equipo.' }).count(),
        1,
      );
      assert.equal(await page.locator('.sh-hero .sh-actions .sh-button').count(), 3);
      assert.equal(
        await page
          .locator('.sh-hero')
          .getByRole('link', { name: 'Superadmin', exact: true })
          .getAttribute('href'),
        '/?plataforma=1',
      );
      assert.equal(
        await page
          .locator('.sh-hero')
          .getByRole('link', { name: 'Ingresar a mi negocio' })
          .getAttribute('href'),
        '#tiendas',
      );
      assert.equal(
        await page
          .locator('.sh-hero')
          .getByRole('link', { name: 'Planes y registro' })
          .getAttribute('href'),
        '#planes',
      );
      assert.equal(await page.locator('.sh-hero-assurances>div').count(), 3);
      assert.equal(await page.locator('.sh-outfit-image img').evaluate(img=>img.complete&&img.naturalWidth>0),true,'The existing hero product image must load');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `Overflow at ${width}px`,
      );
      if (width <= 1100) {
        await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
        assert.equal(
          await page.getByRole('button', { name: 'Cerrar menú' }).getAttribute('aria-expanded'),
          'true',
        );
        assert.equal(
          await page
            .locator('#sh-navigation')
            .getByRole('link', { name: 'Superadmin', exact: true })
            .getAttribute('href'),
          '/?plataforma=1',
        );
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Abrir menú', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
        await page
          .locator('#sh-navigation')
          .getByRole('link', { name: 'Planes', exact: true })
          .click();
        assert.equal(
          await page.getByRole('button', { name: 'Abrir menú' }).getAttribute('aria-expanded'),
          'false',
        );
      }
      for (const link of await page.locator('#sh-navigation a').all()) {
        if (!(await link.isVisible())) continue;
        const box = await link.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, 'Header link clipped at ' + width);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(output, `commercial-${width}.png`), fullPage: true });
      if (width === 390)
        await page
          .locator('#tiendas')
          .screenshot({ path: join(output, 'business-access-mobile.png') });
      if (width === 390)
        await page.evaluate(() => window.scrollTo(0, 0));
      if (width === 390)
        await page.screenshot({ path: join(output, 'commercial-mobile-hero.png') });
      console.log(
        `PASS: commercial home, plans, no public tenant directory and layout at ${width}px`,
      );
    }
    await page.goto(base);
    await page.getByLabel('Identificador de tu tienda').fill('lumina');
    await page.getByRole('button', { name: 'Abrir mi tienda', exact: true }).click();
    await page.waitForURL('**/?tienda=lumina');
    await page.getByRole('heading', { name: /Primero imagínalo/ }).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.saas-home').count(), 0);
    console.log('PASS: entering a store preserves the storefront');
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('.sh-hero').getByRole('link', { name: 'Superadmin', exact: true }).click();
    await page.waitForURL('**/?plataforma=1');
    await page.getByRole('heading', { name: 'Acceso de plataforma', exact: true }).waitFor();
    assert.equal(
      await page.getByRole('link', { name: 'Ver tienda de demostración' }).getAttribute('href'),
      '/?tienda=lumina',
    );
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        'Superadmin login overflow ' + width,
      );
      assert.equal(
        await page
          .getByRole('link', { name: 'Entrar a mi negocio', exact: true })
          .getAttribute('href'),
        '/#tiendas',
      );
      await page.screenshot({
        path: join(output, 'superadmin-login-' + width + '.png'),
        fullPage: true,
      });
    }
    await page.getByLabel('Contraseña de plataforma').fill('SoloPruebaVisual2026!');
    await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
    assert.equal(await page.getByLabel('Contraseña de plataforma').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
    assert.equal(
      await page.getByLabel('Contraseña de plataforma').getAttribute('type'),
      'password',
    );
    await page.getByLabel('Contraseña de plataforma').fill('');
    console.log('PASS: independent platform access and demo return link');
    for (const query of [
      'checkout=qa',
      'stripe_session_id=qa',
      'stripe_return=app',
      'stripe_cancelled=1',
    ]) {
      await page.goto(base + '/?' + query, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).first().waitFor();
      assert.equal(
        await page.locator('.saas-home').count(),
        0,
        'Payment return must stay in the store',
      );
    }
    assert.deepEqual(errors, []);
    console.log('PASS: legacy payment returns and no JavaScript runtime errors');
  } finally {
    await context?.unrouteAll({ behavior: 'wait' });
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
