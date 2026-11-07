import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AnalyticsJobV1 } from '@lumina/contracts';
import { readAnalyticsOutput } from '../src/analytics/worker-bridge';

const job: AnalyticsJobV1 = {
  schemaVersion: '1.0',
  jobId: randomUUID(),
  tenantId: randomUUID(),
  actorId: randomUUID(),
  action: 'GENERATE_DATASET',
  source: 'DEMOSTRACION_SINTETICA',
  datasetId: 'demo-femenino-seed42-v1',
  workDir: '.local/qa',
  parameters: {},
};
let root: string;
const file = 'results/' + job.jobId + '.json';
const data = {
  schemaVersion: '1.0',
  jobId: job.jobId,
  tenantId: job.tenantId,
  actorId: job.actorId,
  action: job.action,
  source: job.source,
  datasetId: job.datasetId,
  modelId: null,
  horizonDays: null,
  generatedAt: '2026-11-06T17:20:00+00:00',
  manifest: { rowCount: 197100 },
  limitations: ['Demostración sintética.'],
};
const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'analytics-bridge-'));
  await mkdir(join(root, 'results'));
});
afterEach(async () => {
  const resolved = join(tmpdir(), root.split(/[\\/]/).at(-1)!);
  if (root === resolved && /^analytics-bridge-[A-Za-z0-9]+$/.test(root.split(/[\\/]/).at(-1)!))
    await rm(root, { recursive: true, force: true });
});

test('accepts the exact result from the authorized worker scope', async () => {
  const bytes = JSON.stringify(data);
  await writeFile(join(root, file), bytes);
  await expect(
    readAnalyticsOutput(root, job, {
      ok: true,
      jobId: job.jobId,
      resultPath: file,
      sha256: digest(bytes),
    }),
  ).resolves.toEqual(data);
});

test('rejects another tenant, corrupt bytes and path escape', async () => {
  const bytes = JSON.stringify({ ...data, tenantId: randomUUID() });
  await writeFile(join(root, file), bytes);
  const response = { ok: true, jobId: job.jobId, resultPath: file, sha256: digest(bytes) };
  await expect(readAnalyticsOutput(root, job, response)).rejects.toMatchObject({
    code: 'ANALYTICS_SCOPE_MISMATCH',
  });
  await expect(
    readAnalyticsOutput(root, job, { ...response, sha256: '0'.repeat(64) }),
  ).rejects.toMatchObject({ code: 'ANALYTICS_HASH_MISMATCH' });
  await expect(
    readAnalyticsOutput(root, job, { ...response, resultPath: '../other.json' }),
  ).rejects.toMatchObject({ code: 'ANALYTICS_PROTOCOL_INVALID' });
});
