import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash, webcrypto } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createOfflineAccess } from '../src/offline/access';
import { createRecordCipher } from '../src/offline/recordCipher';
import { SQLiteIntentRepository } from '../src/offline/sqliteIntentRepository';
import { migrateOfflineDatabase } from '../src/offline/migrations';
import { saveOfflineDashboard, loadOfflineDashboard } from '../src/modules/reports/offlineReport';

const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() };
const secret = Buffer.alloc(32, 7).toString('base64');
const crypto = {
  async seal(value: unknown, key: string, aad: string) {
    const iv = webcrypto.getRandomValues(new Uint8Array(12));
    const aes = await webcrypto.subtle.importKey(
      'raw',
      Buffer.from(key, 'base64'),
      'AES-GCM',
      false,
      ['encrypt'],
    );
    const data = Buffer.from(
      await webcrypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: Buffer.from(aad) },
        aes,
        Buffer.from(JSON.stringify(value)),
      ),
    );
    return {
      algorithm: 'A256GCM' as const,
      nonce: Buffer.from(iv).toString('base64'),
      ciphertext: data.subarray(0, -16).toString('base64'),
      tag: data.subarray(-16).toString('base64'),
      aad,
    };
  },
  async open<T>(data: any, key: string, aad: string): Promise<T> {
    const aes = await webcrypto.subtle.importKey(
      'raw',
      Buffer.from(key, 'base64'),
      'AES-GCM',
      false,
      ['decrypt'],
    );
    const bytes = await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Buffer.from(data.nonce, 'base64'), additionalData: Buffer.from(aad) },
      aes,
      Buffer.concat([Buffer.from(data.ciphertext, 'base64'), Buffer.from(data.tag, 'base64')]),
    );
    return JSON.parse(Buffer.from(bytes).toString());
  },
};
function fixture() {
  const access = createOfflineAccess();
  access.bind(scope);
  let key = secret;
  let previous: string[] = [];
  const cipher = createRecordCipher({
    access,
    digest,
    crypto,
    keys: async () => ({ active: key, previous }),
  });
  const db = new DatabaseSync(':memory:');
  const adapter: any = {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, ...params: any[]) => db.prepare(sql).run(...params),
    getAllAsync: async (sql: string, ...params: any[]) => db.prepare(sql).all(...params),
    getFirstAsync: async (sql: string, ...params: any[]) => db.prepare(sql).get(...params) ?? null,
    withExclusiveTransactionAsync: async (work: any) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        await work(adapter);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return {
    access,
    cipher,
    db,
    adapter,
    rotate: () => {
      previous = [key];
      key = Buffer.alloc(32, 8).toString('base64');
    },
  };
}
test('el cifrado autentica cuenta y registro, conserva claves anteriores y bloquea respuestas tardías', async () => {
  const f = fixture();
  const encoded = await f.cipher.seal(scope, 'report', 'one', { ventas: 14900 });
  assert.ok(!encoded.includes('14900'));
  assert.deepEqual((await f.cipher.open(scope, 'report', 'one', encoded)).value, { ventas: 14900 });
  await assert.rejects(f.cipher.open(scope, 'report', 'two', encoded));
  f.rotate();
  assert.deepEqual((await f.cipher.open(scope, 'report', 'one', encoded)).value, { ventas: 14900 });
  const guard = f.cipher.guard(scope);
  f.access.lock();
  assert.throws(guard, /sesión|bloqueado/);
  await assert.rejects(f.cipher.open(scope, 'report', 'one', encoded));
  f.access.bind({ ...scope, actorId: randomUUID() });
  await assert.rejects(f.cipher.open(scope, 'report', 'one', encoded));
  f.db.close();
});
test('SQLite confirma intención cifrada junto con proyección, conserva el hash al reabrir y migra legados sin inventar datos', async () => {
  const f = fixture();
  await migrateOfflineDatabase(f.adapter);
  const repo = new SQLiteIntentRepository(f.adapter, f.cipher, digest);
  const operationId = randomUUID(),
    entityId = randomUUID(),
    variantId = randomUUID(),
    locationId = randomUUID();
  const draft = {
    operationId,
    scope,
    kind: 'STOCK_DELTA',
    entityId,
    createdAt: '2026-11-07T12:00:00Z',
    baseVersion: 1,
    dependsOn: [],
    state: 'PENDING' as const,
    payload: JSON.stringify({
      variantId,
      locationId,
      deltaFisico: 3,
      reason: 'Recepción mercancía',
    }),
  };
  await repo.enqueue(draft, {
    scope,
    entityId,
    version: 1,
    payload: JSON.stringify({ physical: 13 }),
  });
  const raw = f.db.prepare('SELECT payload FROM offline_intent').get() as any;
  assert.ok(!raw.payload.includes('Recepción'));
  assert.ok(!raw.payload.includes(variantId));
  const first = (await repo.listIntents(scope))[0];
  assert.equal(first.entityId, entityId);
  assert.equal(
    first.payload,
    (await new SQLiteIntentRepository(f.adapter, f.cipher, digest).listIntents(scope))[0].payload,
  );
  assert.equal(JSON.parse((await repo.listProjections(scope))[0].payload).physical, 13);
  await assert.rejects(
    repo.enqueue(
      { ...draft, operationId: randomUUID() },
      { scope, entityId: randomUUID(), version: 1, payload: '{}' },
    ),
    /proyección/,
  );
  await assert.rejects(
    repo.enqueue(
      { ...draft, operationId: randomUUID() },
      { scope, entityId, version: 1, payload: 'malformed' },
    ),
  );
  assert.equal((await repo.listIntents(scope)).length, 1);
  await f.adapter.runAsync(
    'INSERT INTO offline_intent VALUES (?,?,?,?,?,?,?,?,?,?)',
    randomUUID(),
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
    'CATALOG_CREATE',
    '{"product":{"nombre":"Legado"}}',
    null,
    '[]',
    'PENDING',
    '2026-11-06T12:00:00Z',
  );
  const legacy = (await repo.listIntents(scope)).find((item) => item.kind === 'CATALOG_CREATE')!;
  assert.equal(legacy.state, 'BLOCKED');
  assert.match(legacy.message!, /incompleta|anterior/);
  assert.ok(
    !(
      f.db.prepare('SELECT payload FROM offline_intent WHERE kind=?').get('CATALOG_CREATE') as any
    ).payload.includes('Legado'),
  );
  await repo.discard(scope, legacy.operationId);
  assert.equal(
    (await repo.listIntents(scope)).find((item) => item.operationId === legacy.operationId)?.state,
    'DISCARDED',
  );
  assert.equal((await repo.listIntents(scope)).length, 2);
  f.access.lock();
  await assert.rejects(repo.listIntents(scope));
  f.db.close();
});
test('si la sesión se cierra durante el INSERT, SQLite revierte la intención y su proyección', async () => {
  const f = fixture();
  await migrateOfflineDatabase(f.adapter);
  const run = f.adapter.runAsync;
  f.adapter.runAsync = async (sql: string, ...params: any[]) => {
    const result = await run(sql, ...params);
    if (sql.includes('INSERT INTO offline_intent')) f.access.lock();
    return result;
  };
  const repo = new SQLiteIntentRepository(f.adapter, f.cipher, digest),
    entityId = randomUUID();
  await assert.rejects(
    repo.enqueue(
      {
        operationId: randomUUID(),
        scope,
        kind: 'STOCK_DELTA',
        entityId,
        createdAt: '2026-11-07T12:00:00Z',
        baseVersion: 1,
        dependsOn: [],
        state: 'PENDING',
        payload: JSON.stringify({
          variantId: randomUUID(),
          locationId: randomUUID(),
          deltaFisico: 1,
          reason: 'Recepción de prueba',
        }),
      },
      { scope, entityId, version: 1, payload: '{}' },
    ),
  );
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM offline_intent').get() as any).n, 0);
  assert.equal((f.db.prepare('SELECT count(*) AS n FROM offline_projection').get() as any).n, 0);
  f.db.close();
});
test('los dashboards quedan cifrados en SQLite y no se pueden recuperar después del logout', async () => {
  const f = fixture();
  await migrateOfflineDatabase(f.adapter);
  const report = {
    kpis: { pedidos: 2, ventas: 149, unidades: 3, ticketPromedio: 74.5 },
    summary: 'Corte privado',
    generatedBy: 'QA',
    products: [],
    locations: [],
  };
  await saveOfflineDashboard(f.adapter, scope, 'one', report, f.cipher);
  const raw = f.db.prepare('SELECT payload FROM offline_report_snapshot').get() as any;
  assert.ok(!raw.payload.includes('Corte privado'));
  assert.deepEqual((await loadOfflineDashboard(f.adapter, scope, 'one', f.cipher))!.report, report);
  f.access.lock();
  await assert.rejects(loadOfflineDashboard(f.adapter, scope, 'one', f.cipher));
  f.db.close();
});
