// Pago alojado de extremo a extremo. Requiere el build del API, Chromium y Stripe TEST.
require('dotenv/config');
const { chromium } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const url = new URL(process.env.DATABASE_URL);
url.pathname = '/vestidor18_test';
process.env.PLATFORM_DATABASE_URL = url.href;
const { TenantRegistry } = require('../dist/api/tenancy/platform');
const registry = new TenantRegistry();
const id = randomUUID();
const slug = 'qa-' + id;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
async function run() {
  if (!process.env.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw Error('Solo sandbox');
  await registry.initialize();
  const db = registry.pool;
  let browser, sid;
  try {
    await db.query(
      "INSERT INTO platform.tenant(id,slug,name,database_name,state) VALUES($1,$2,'QA',$3,'ACTIVE')",
      [id, slug, 'qa_' + id.replace(/-/g, '')],
    );
    await db.query(
      "INSERT INTO platform.subscription(tenant_id,plan_code,status,provider) VALUES($1,'piloto','ACTIVE','NONE')",
      [id],
    );
    const created = await registry.billing.start(
      id,
      { code: 'negocio', currency: 'BOB', monthlyAmount: 599 },
      randomUUID(),
    );
    sid = (
      await db.query('SELECT pending_checkout FROM platform.subscription WHERE tenant_id=$1', [id])
    ).rows[0].pending_checkout;
    if (!sid.startsWith('cs_test_') || new URL(created.url).hostname !== 'checkout.stripe.com')
      throw Error('Se esperaba Checkout TEST');
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(created.url, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill('lumina-qa@example.com');
    await page.locator('#cardNumber').fill('4242424242424242');
    await page.locator('#cardExpiry').fill('1234');
    await page.locator('#cardCvc').fill('123');
    await page.locator('#billingName').fill('Lumina QA');
    const country = page.locator('#billingCountry');
    if (await country.isVisible()) await country.selectOption('BO');
    const zip = page.locator('#billingPostalCode');
    if (await zip.isVisible()) await zip.fill('00000');
    await page.locator('button[type=submit]').click();
    await page.waitForURL('**/api/tenant/subscription/return', { timeout: 35000 });
    await registry.billing.refresh(id);
    const before = (await registry.resolve(slug)).subscription;
    if (before.plan !== 'negocio' || before.status !== 'ACTIVE') throw Error('Pago sin confirmar');
    await registry.billing.cancel(id);
    await registry.billing.refresh(id);
    const after = (await registry.resolve(slug)).subscription;
    if (!after.cancelAtEnd || after.periodEnd !== before.periodEnd || after.status !== 'ACTIVE')
      throw Error('Fecha de baja incorrecta');
    console.log('Stripe TEST: pago alojado, activación y cancelación a fin de ciclo verificados.');
  } finally {
    await browser?.close();
    if (sid) {
      const sess = await stripe.checkout.sessions.retrieve(sid);
      if (sess.status === 'open') await stripe.checkout.sessions.expire(sid);
      if (sess.subscription) await stripe.subscriptions.cancel(sess.subscription);
    }
    await db.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [id]);
    await db.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [id]);
    await db.query('DELETE FROM platform.tenant WHERE id=$1', [id]);
    await registry.onModuleDestroy();
  }
}
run().catch((e) => {
  console.error(
    String(e.message)
      .replace(/https?:\/\/\S+/g, '[url]')
      .slice(0, 400),
  );
  process.exitCode = 1;
});
