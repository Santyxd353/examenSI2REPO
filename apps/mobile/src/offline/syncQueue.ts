import { api } from '../api';
import { readyPending } from './dependencyGraph';
import type { OfflineScope } from './scope';
import { applySyncReceipt, type SyncReceipt } from './syncReceipt';
import type { SQLiteIntentRepository } from './sqliteIntentRepository';

type SyncReply = { receipts: SyncReceipt[] };

/** Sincroniza un lote ordenado; volver a llamar tras una caída de red es seguro por operationId. */
export async function syncOfflineQueue(repository: SQLiteIntentRepository, scope: OfflineScope) {
  const receipts: SyncReceipt[] = [];
  for (let round = 0; round < 50; round++) {
    const local = await repository.listIntents(scope);
    const operations = readyPending(local).slice(0, 50 - receipts.length);
    if (!operations.length) return receipts;
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
    for (const receipt of reply.receipts) {
      receipts.push(receipt);
      if (receipt.status === 'APPLIED' && receipt.serverVersion !== undefined)
        await repository.applyParentVersion(scope, receipt.operationId, receipt.serverVersion);
    }
    if (receipts.length >= 50 || reply.receipts.some((receipt) => receipt.status !== 'APPLIED'))
      return receipts;
  }
  return receipts;
}
