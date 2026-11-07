import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson } from '@lumina/contracts';
import { readSnapshotPages } from '../src/offline/snapshotDownload';

const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
test('descarga el corte APP solo si todas las páginas, hashes y ámbito coinciden', async () => {
  const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() };
  const entities = [
    { id: randomUUID(), kind: 'CATEGORY', name: 'Vestidos', active: true },
    { id: randomUUID(), kind: 'CATEGORY', name: 'Faldas', active: true },
  ];
  const doc = {
    schemaVersion: '1.0',
    snapshotId: randomUUID(),
    asOf: '2026-11-07T12:00:00Z',
    expiresAt: '2026-11-08T12:00:00Z',
    scope: { ...scope, channel: 'APP', permissions: ['catalogo:gestionar'], locationIds: [] },
    coverage: {
      complete: true,
      truncated: false,
      rowCount: 2,
      totalKnownRows: 2,
      limit: 50000,
      omissions: [],
    },
    entities,
  };
  const hash = await digest(canonicalJson(doc));
  const page = async (index: number) => ({
    ...doc,
    entities: [entities[index]],
    sha256: hash,
    pageHash: await digest(canonicalJson([entities[index]])),
    offset: index,
    pageSize: 1,
    nextCursor: index === 0 ? 'next' : null,
  });
  const result = await readSnapshotPages(scope, {
    digest,
    get: async (cursor) => page(cursor ? 1 : 0),
    guard: () => {},
  });
  assert.deepEqual(result, doc);
  await assert.rejects(
    readSnapshotPages(scope, {
      digest,
      get: async (cursor) => ({
        ...(await page(cursor ? 1 : 0)),
        scope: { ...doc.scope, actorId: randomUUID() },
      }),
      guard: () => {},
    }),
  );
  await assert.rejects(
    readSnapshotPages(scope, {
      digest,
      get: async (cursor) => ({ ...(await page(cursor ? 1 : 0)), pageHash: '0'.repeat(64) }),
      guard: () => {},
    }),
  );
});
