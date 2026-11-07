const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');

async function main() {
  const api = require('../dist/api/contracts');
  const reporting = require('@lumina/reporting');
  const reportFixture = require('../packages/contracts/fixtures/report-golden-v1.json');
  const report = reporting.executeReport(reportFixture.definition, reportFixture.dataset);
  const fixture = JSON.parse(
    readFileSync(resolve('packages/contracts/fixtures/offline-intent-v1.json'), 'utf8'),
  );
  const { payloadHash, ...unsigned } = fixture;
  const expected = api.canonicalIntentJson(unsigned);
  assert.equal(createHash('sha256').update(expected).digest('hex'), payloadHash);
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    plugins: [
      {
        name: 'shared-contract-test-shell',
        configureServer(instance) {
          instance.middlewares.use('/__contract_smoke', (_request, response) => {
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><title>Contrato</title>');
          });
        },
      },
    ],
  });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/__contract_smoke`);
    const result = await page.evaluate(
      async ({ unsigned, reportFixture }) => {
        const contracts = await import('/src/contracts.ts');
        const json = contracts.canonicalIntentJson(unsigned);
        const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
        const report = contracts.executeReport(reportFixture.definition, reportFixture.dataset);
        return {
          json,
          hash: [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join(''),
          priceMinor: contracts.PLAN_CATALOG.pro.priceMinor,
          report,
          csv: contracts.exportReportCsv(report),
          week: contracts.isoWeek(contracts.boliviaDate('2026-01-01T02:00:00.000Z')),
        };
      },
      { unsigned, reportFixture },
    );
    assert.equal(result.json, expected);
    assert.equal(result.hash, payloadHash);
    assert.equal(result.priceMinor, 29900);
    assert.deepEqual(result.report, report);
    assert.equal(
      result.report.kpis.ventas_confirmadas_bob.value,
      reportFixture.expected.salesMinor,
    );
    assert.equal(result.csv, reporting.exportReportCsv(report));
    assert.equal(result.week, '2026-W01');
    console.log('CommonJS y Chromium/Vite: DTO, hash, reporte, CSV y semana ISO idénticos.');
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
