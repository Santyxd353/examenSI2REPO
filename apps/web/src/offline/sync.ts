import {
  ResourceStageResponseSchema,
  SyncOperationResultSchema,
  canonicalJson,
  type OfflineIntent,
  type SyncOperationResult,
} from '@lumina/contracts';
import { ApiError } from '../api';
import { assertActive, scopeKey, type OfflineSession } from './scope';
import { listQueue, markSending, recoverSending, updateQueue } from './queue';
import { sessionResponse } from './session';
import { readBytes, sha256 } from './vault';

export const offlineChangesEvent = 'lumina:offline-updated';
const pending = (intent: OfflineIntent) => {
  if (intent.kind === 'CATALOG_CREATE') return intent.payload.product.resources;
  if (intent.kind === 'CATALOG_UPDATE') return intent.payload.patch.resources ?? [];
  return [];
};
async function stageResources(
  session: OfflineSession,
  operation: OfflineIntent,
  signal?: AbortSignal,
) {
  for (const reference of pending(operation)) {
    const file = await readBytes(session, 'resource:' + reference.clientResourceId);
    if (
      !file ||
      file.bytes.byteLength !== reference.bytes ||
      (await sha256(file.bytes)) !== reference.sha256
    )
      throw new Error('El archivo pendiente falta o está dañado.');
    const form = new FormData();
    form.set('metadata', JSON.stringify({ deviceId: session.deviceId, reference }));
    form.set('file', new Blob([file.bytes], { type: reference.mime }), reference.clientResourceId);
    const response = await sessionResponse(session, '/api/offline/resources', {
      method: 'POST',
      body: form,
      signal,
    });
    const result = ResourceStageResponseSchema.parse(await response.json());
    if (canonicalJson(result.reference) !== canonicalJson(reference))
      throw new Error('El archivo confirmado no corresponde a la intención.');
  }
}

export async function syncPending(session: OfflineSession, signal?: AbortSignal) {
  if (!navigator.locks)
    throw new Error('Este navegador no admite la sincronización segura entre pestañas.');
  return navigator.locks.request(
    'lumina-sync:' + scopeKey(session),
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return { applied: 0, conflicts: 0, blocked: 0, running: true };
      await assertActive(session);
      await recoverSending(session);
      const entries = (await listQueue(session))
        .filter((item) => !item.receipt && ['PENDING', 'BLOCKED'].includes(item.status))
        .slice(0, 100);
      const candidates = [];
      let blocked = 0;
      for (const { intent } of entries) {
        signal?.throwIfAborted();
        try {
          await stageResources(session, intent, signal);
          candidates.push(intent);
        } catch (error) {
          signal?.throwIfAborted();
          await assertActive(session);
          const problem = {
            code:
              error instanceof ApiError
                ? (error.code ?? 'RESOURCE_UPLOAD_FAILED')
                : 'RESOURCE_UNAVAILABLE',
            message: (error as Error).message,
            retryable: true,
            correlationId: crypto.randomUUID(),
          };
          await updateQueue(session, intent.operationId, (entry) => ({
            ...entry,
            status: 'BLOCKED',
            problem,
          }));
          blocked++;
        }
      }
      const sending = new Set(
        await markSending(
          session,
          candidates.map((operation) => operation.operationId),
        ),
      );
      const operations = candidates.filter((operation) => sending.has(operation.operationId));
      let applied = 0,
        conflicts = 0;
      try {
        if (operations.length) {
          const response = await sessionResponse(session, '/api/offline/sync', {
            method: 'POST',
            body: JSON.stringify({ schemaVersion: '1.0', operations }),
            signal,
          });
          const raw = (await response.json()) as { results: unknown[] };
          const results = new Map<string, SyncOperationResult>();
          for (const item of raw.results) {
            const value = SyncOperationResultSchema.parse(item);
            if (!sending.has(value.operationId) || results.has(value.operationId))
              throw new Error('Respuesta de sincronización inconsistente.');
            results.set(value.operationId, value);
          }
          for (const operation of operations) {
            const result = results.get(operation.operationId);
            if (!result) throw new Error('Falta el comprobante de una operación.');
            const receipt = result.receipt;
            if (
              receipt &&
              (receipt.tenantId !== session.tenantId ||
                receipt.actorId !== session.actorId ||
                receipt.deviceId !== session.deviceId ||
                receipt.entityId !== operation.entityId ||
                receipt.operationId !== operation.operationId ||
                receipt.payloadHash !== operation.payloadHash)
            )
              throw new Error('El comprobante no coincide con la operación original.');
            if (receipt?.status === 'APPLIED') applied++;
            else if (receipt?.status === 'CONFLICT') conflicts++;
            else blocked++;
            await updateQueue(session, operation.operationId, (entry) => {
              const { problem: _problem, ...original } = entry;
              if (receipt)
                return {
                  ...original,
                  receipt,
                  status: receipt.status === 'REJECTED' ? 'BLOCKED' : receipt.status,
                };
              return { ...original, status: 'BLOCKED', problem: result.blocked! };
            });
          }
        }
        return { applied, conflicts, blocked, running: false };
      } catch (error) {
        await recoverSending(session).catch(() => {});
        throw error;
      } finally {
        window.dispatchEvent(new Event(offlineChangesEvent));
      }
    },
  );
}
