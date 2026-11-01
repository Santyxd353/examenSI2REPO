import type { OfflineIntent } from './intentRepository';

export type SyncReceipt = Readonly<{
  operationId: string;
  status: 'APPLIED' | 'CONFLICT' | 'REJECTED';
  serverVersion?: number;
  message?: string;
}>;

/**
 * Los recibos son idempotentes: repetir exactamente el mismo recibo deja la
 * cola en el mismo estado. Un rechazo o conflicto bloquea sus dependientes.
 */
export function applySyncReceipt(intents: readonly OfflineIntent[], receipt: SyncReceipt): OfflineIntent[] {
  let found = false;
  const updated = intents.map((intent) => {
    if (intent.operationId !== receipt.operationId) return intent;
    found = true;
    if (receipt.status === 'APPLIED') return { ...intent, state: 'APPLIED' as const };
    return { ...intent, state: 'CONFLICT' as const };
  });
  if (!found) throw new Error('El recibo de sincronización no corresponde a una operación local.');
  if (receipt.status === 'APPLIED') return updated;

  const blocked = new Set<string>([receipt.operationId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const intent of updated) {
      if (intent.dependsOn.some((id) => blocked.has(id)) && !blocked.has(intent.operationId)) {
        blocked.add(intent.operationId);
        changed = true;
      }
    }
  }
  return updated.map((intent) =>
    intent.operationId !== receipt.operationId && blocked.has(intent.operationId)
      ? { ...intent, state: 'BLOCKED' as const }
      : intent,
  );
}
