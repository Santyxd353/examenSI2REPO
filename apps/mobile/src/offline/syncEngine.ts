import { SyncBatchSchema } from '@lumina/contracts';
import { orderedPending } from './dependencyGraph';
import type { OfflineIntent } from './intentRepository';
import type { OfflineScope } from './scope';
import { prepareWireIntent, validateSyncResults, type ValidatedResult } from './protocol';
import { applySyncReceipt } from './syncReceipt';

type Repository = {
  listIntents(scope: OfflineScope): Promise<OfflineIntent[]>;
  reconcile(
    scope: OfflineScope,
    intents: readonly OfflineIntent[],
    results: readonly ValidatedResult[],
  ): Promise<void>;
};
export async function runSyncBatch(
  repository: Repository,
  scope: OfflineScope,
  deps: {
    digest(text: string): Promise<string>;
    send(body: unknown): Promise<unknown>;
    guard(scope: OfflineScope): () => void;
  },
) {
  const check = deps.guard(scope);
  let local = await repository.listIntents(scope);
  check();
  // Un bloqueo no impide enviar otras altas/ajustes independientes.
  let changed = true;
  while (changed) {
    changed = false;
    local = local.map((item) => {
      if (item.state !== 'PENDING') return item;
      if (
        item.dependsOn.some(
          (id) =>
            !local.some(
              (parent) =>
                parent.operationId === id && ['PENDING', 'APPLIED'].includes(parent.state),
            ),
        )
      ) {
        changed = true;
        return { ...item, state: 'BLOCKED', message: 'Una dependencia requiere revisión.' };
      }
      return item;
    });
  }
  const operations = await Promise.all(
    orderedPending(local)
      .slice(0, 50)
      .map((item) => prepareWireIntent(item, deps.digest)),
  );
  check();
  if (!operations.length) {
    await repository.reconcile(scope, local, []);
    check();
    return [];
  }
  const reply = await deps.send(SyncBatchSchema.parse({ schemaVersion: '1.0', operations }));
  check();
  const results = validateSyncResults(reply, operations);
  check();
  const byId = new Map(results.map((item) => [item.operationId, item]));
  for (const operation of operations) {
    const result = byId.get(operation.operationId)!;
    if (
      result.status === 'APPLIED' &&
      operation.dependsOn.some((id) => byId.has(id) && byId.get(id)!.status !== 'APPLIED')
    )
      throw new Error('El servidor confirmó una operación cuya dependencia no se aplicó.');
    if (result.status === 'BLOCKED') {
      local = local.map((item) =>
        item.operationId === result.operationId
          ? { ...item, state: result.retryable ? 'PENDING' : 'BLOCKED', message: result.message }
          : item,
      );
    } else {
      local = applySyncReceipt(local, {
        operationId: result.operationId,
        status: result.status,
        serverVersion: result.serverVersion,
        message: result.message,
      });
      local = local.map((item) =>
        item.operationId === result.operationId ? { ...item, message: result.message } : item,
      );
    }
  }
  check();
  await repository.reconcile(scope, local, results);
  check();
  return results;
}
