import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@lumina/contracts';
import { executeReport } from '@lumina/reporting';
import { readReportDataset } from '../src/modules/reports/datasetDownload';

const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
test('el conjunto móvil verificado produce el mismo dashboard que el motor compartido y rechaza páginas mezcladas', async () => {
  const fixture = JSON.parse(
    readFileSync('../../packages/contracts/fixtures/report-golden-v1.json', 'utf8'),
  );
  const dataset = { ...fixture.dataset, datasetId: randomUUID() };
  const { sha256: _ignored, ...unsigned } = dataset;
  dataset.sha256 = await digest(canonicalJson(unsigned));
  const kinds = ['sales', 'orders', 'payments', 'returns', 'refunds', 'stock'];
  const rows = kinds.flatMap((kind) => dataset[kind].map((fact: any) => ({ kind, fact })));
  const metadata = { ...dataset };
  for (const kind of kinds) delete metadata[kind];
  const manifest = { ...metadata, expiresAt: '2026-11-08T12:00:00Z' };
  const scope = { tenantId: dataset.tenantId, actorId: dataset.ownerId, deviceId: randomUUID() };
  const page = {
    datasetId: dataset.datasetId,
    asOf: dataset.asOf,
    sha256: dataset.sha256,
    offset: 0,
    nextOffset: null,
    rows,
  };
  const downloaded = await readReportDataset(scope, manifest, {
    digest,
    guard: () => {},
    get: async () => page,
  });
  const definition = { ...fixture.definition, datasetId: dataset.datasetId };
  assert.deepEqual(executeReport(definition, downloaded), executeReport(definition, dataset));
  await assert.rejects(
    readReportDataset(scope, manifest, {
      digest,
      guard: () => {},
      get: async () => ({ ...page, asOf: '2026-11-07T23:00:00Z' }),
    }),
  );
});
