const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { mkdtemp } = require('node:fs/promises');
const { resolve } = require('node:path');
const { chromium } = require('@playwright/test');
const { PLAN_CATALOG } = require('@lumina/contracts');

async function main() {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: 'apps/web/vite.config.ts',
    server: { port: 42209, strictPort: true },
  });
  await server.listen();
  const origin = 'http://127.0.0.1:42209';
  const profile = await mkdtemp(resolve('.local', 'vault-qa-'));
  let context;
  async function open() {
    context = await chromium.launchPersistentContext(profile, { headless: true });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.route(origin + '/vault-qa', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Vault QA</title>' }),
    );
    await page.goto(origin + '/vault-qa');
    return page;
  }
  const tenantId = randomUUID(),
    actorId = randomUUID(),
    locationId = randomUUID();
  const bootstrap = {
    schemaVersion: '1.0',
    tenantId,
    actorId,
    keyVersion: 1,
    keyBase64: randomBytes(32).toString('base64'),
    permissions: ['inventario:gestionar'],
    locationIds: [locationId],
    issuedAt: new Date().toISOString(),
    entitlements: {
      schemaVersion: '1.0',
      tenantId,
      planCode: 'esencial',
      status: 'TRIAL',
      periodFrom: '2026-11-01T04:00:00.000Z',
      periodTo: '2026-11-15T04:00:00.000Z',
      readOnly: false,
      cancelAtPeriodEnd: false,
      currency: 'BOB',
      priceMinor: 14900,
      billingMode: null,
      limits: PLAN_CATALOG.esencial.limits,
      features: PLAN_CATALOG.esencial.features,
      usage: {
        locations: 1,
        staff: 1,
        products: 0,
        avatarsCommitted: 0,
        avatarsReserved: 0,
        savedReports: 0,
        aiCommitted: 0,
        aiReserved: 0,
      },
    },
  };
  try {
    let page = await open();
    const result = await page.evaluate(
      async ({ bootstrap, locationId }) => {
        const scope = await import('/src/offline/scope.ts');
        const queue = await import('/src/offline/queue.ts');
        const database = await import('/src/offline/database.ts');
        const deviceId = await scope.getDeviceId();
        const current = await scope.activateSession('qa', bootstrap.actorId, deviceId, {
          ...bootstrap,
          deviceId,
        });
        const intent = await queue.enqueueIntent(current, {
          kind: 'STOCK_DELTA',
          entityId: crypto.randomUUID(),
          baseVersion: 1,
          dependsOn: [],
          payload: {
            variantId: crypto.randomUUID(),
            locationId,
            deltaFisico: 3,
            reason: 'Conteo QA privado',
          },
        });
        await queue.markSending(current, [intent.operationId]);
        const raw = await database.withTransaction(['vault'], 'readonly', (stores) =>
          database.request(stores.vault.getAll()),
        );
        return {
          deviceId,
          operationId: intent.operationId,
          hash: intent.payloadHash,
          encrypted: !JSON.stringify(raw).includes('Conteo QA privado'),
        };
      },
      { bootstrap, locationId },
    );
    assert.equal(result.encrypted, true);
    await context.close();
    page = await open();
    const reopened = await page.evaluate(
      async ({ result, bootstrap }) => {
        const scope = await import('/src/offline/scope.ts');
        const queue = await import('/src/offline/queue.ts');
        const vault = await import('/src/offline/vault.ts');
        const same = await scope.restoreSession('qa');
        const otherStore = await scope.restoreSession('otra-tienda');
        await queue.recoverSending(same);
        const [saved] = await queue.listQueue(same);
        await scope.lockSession(same, 'keep');
        const locked = await scope.restoreSession('qa');
        const lateWriteRejected = await vault.putJson(same, 'test:late', { ok: true }).then(
          () => false,
          () => true,
        );
        const otherActor = crypto.randomUUID();
        const different = await scope.activateSession('qa', otherActor, result.deviceId, {
          ...bootstrap,
          actorId: otherActor,
          deviceId: result.deviceId,
        });
        const otherCount = (await queue.listQueue(different)).length;
        const recovered = await scope.activateSession('qa', bootstrap.actorId, result.deviceId, {
          ...bootstrap,
          deviceId: result.deviceId,
        });
        const [sameIntent] = await queue.listQueue(recovered);
        return { otherStore, locked, lateWriteRejected, otherCount, saved, sameIntent };
      },
      { result, bootstrap },
    );
    assert.equal(reopened.otherStore, null);
    assert.equal(reopened.locked, null);
    assert.equal(reopened.lateWriteRejected, true);
    assert.equal(reopened.otherCount, 0);
    assert.equal(reopened.saved.status, 'PENDING');
    assert.equal(reopened.saved.intent.operationId, result.operationId);
    assert.equal(reopened.sameIntent.intent.payloadHash, result.hash);
    console.log(
      'Chromium verificó persistencia cifrada al cerrar/reabrir, recuperación SENDING y bloqueo de la identidad anterior.',
    );
  } finally {
    await context?.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
