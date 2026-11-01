import { api } from '../api';
import { orderedPending } from './dependencyGraph';
import type { OfflineScope } from './scope';
import { applySyncReceipt, type SyncReceipt } from './syncReceipt';
import type { SQLiteIntentRepository } from './sqliteIntentRepository';

type SyncReply = { receipts: SyncReceipt[] };

/** Sincroniza un lote ordenado; volver a llamar tras una caída de red es seguro por operationId. */
export async function syncOfflineQueue(repository: SQLiteIntentRepository, scope: OfflineScope) {
  const local = await repository.listIntents(scope);
  const operations = orderedPending(local).slice(0, 50);
  if (!operations.length) return [] as SyncReceipt[];
  const reply = await api<SyncReply>('/offline/sync', {
    method: 'POST',
    body: JSON.stringify({
      deviceId: scope.deviceId,
      operations: operations.map(({ operationId, kind, baseVersion, payload }) => ({ operationId, kind, baseVersion, payload })),
    }),
  });
  let reconciled = local;
  for (const receipt of reply.receipts) reconciled = applySyncReceipt(reconciled, receipt);
  await repository.replaceStates(scope, reconciled);
  return reply.receipts;
}
