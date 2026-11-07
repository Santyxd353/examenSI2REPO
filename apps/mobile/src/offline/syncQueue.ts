import { api, captureSessionScope, assertCurrentSessionScope } from '../api';
import { runSyncBatch } from './syncEngine';
import { nativeRecordCipher, sha256 } from './nativeStorage';
import { offlineScopeKey, type OfflineScope } from './scope';
import type { SQLiteIntentRepository } from './sqliteIntentRepository';

const inFlight = new Map<string, Promise<unknown>>();
/** Cada reintento conserva el sobre firmado; no se sobreescribe una intención tras un conflicto. */
export function syncOfflineQueue(repository: SQLiteIntentRepository, scope: OfflineScope) {
  const key = offlineScopeKey(scope);
  if (inFlight.has(key)) return inFlight.get(key)!;
  const session = captureSessionScope();
  const result = runSyncBatch(repository, scope, {
    digest: sha256,
    guard: (current) => {
      const check = nativeRecordCipher.guard(current);
      return () => {
        assertCurrentSessionScope(session);
        check();
      };
    },
    send: (body) => api<unknown>('/offline/sync', { method: 'POST', body: JSON.stringify(body) }),
  }).finally(() => {
    if (inFlight.get(key) === result) inFlight.delete(key);
  });
  inFlight.set(key, result);
  return result;
}
