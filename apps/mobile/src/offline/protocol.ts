import {
  canonicalIntentJson,
  OfflineIntentSchema,
  SyncOperationResultSchema,
  UnsignedIntentSchema,
  type OfflineIntent as WireIntent,
  type SyncOperationResult,
} from '@lumina/contracts';
import type { OfflineIntent } from './intentRepository';

export async function prepareWireIntent(
  intent: OfflineIntent,
  digest: (text: string) => Promise<string>,
): Promise<WireIntent> {
  const stored: unknown = JSON.parse(intent.payload);
  const frozen = OfflineIntentSchema.safeParse(stored);
  if (frozen.success) {
    const wire = frozen.data;
    if (
      wire.operationId !== intent.operationId ||
      wire.tenantId !== intent.scope.tenantId ||
      wire.actorId !== intent.scope.actorId ||
      wire.deviceId !== intent.scope.deviceId ||
      wire.kind !== intent.kind
    )
      throw new Error('La intención guardada pertenece a otro ámbito.');
    const { payloadHash, ...unsigned } = wire;
    if ((await digest(canonicalIntentJson(unsigned))) !== payloadHash)
      throw new Error('La intención cambió después de guardarse.');
    return wire;
  }
  if (!intent.createdAt || !intent.entityId)
    throw new Error(
      'La operación anterior está incompleta. Revisa sus datos antes de crear otra intención.',
    );
  const unsigned = UnsignedIntentSchema.parse({
    schemaVersion: '1.0',
    operationId: intent.operationId,
    ...intent.scope,
    kind: intent.kind,
    entityId: intent.entityId,
    createdAt: intent.createdAt,
    baseVersion: intent.baseVersion,
    dependsOn: [...intent.dependsOn],
    payload: stored,
  });
  return OfflineIntentSchema.parse({
    ...unsigned,
    payloadHash: await digest(canonicalIntentJson(unsigned)),
  });
}

export type ValidatedResult = {
  operationId: string;
  status: 'APPLIED' | 'CONFLICT' | 'REJECTED' | 'BLOCKED';
  serverVersion?: number;
  message?: string;
  retryable?: boolean;
  source: SyncOperationResult;
};
export function validateSyncResults(
  raw: unknown,
  operations: readonly WireIntent[],
): ValidatedResult[] {
  const body = raw as { results?: unknown[] };
  if (!body || !Array.isArray(body.results) || body.results.length !== operations.length)
    throw new Error('La respuesta de sincronización quedó incompleta.');
  const seen = new Set<string>();
  return body.results.map((rawResult) => {
    const result = SyncOperationResultSchema.parse(rawResult);
    const original = operations.find((operation) => operation.operationId === result.operationId);
    if (!original || seen.has(result.operationId))
      throw new Error('El recibo no corresponde al lote enviado.');
    seen.add(result.operationId);
    if (result.blocked)
      return {
        operationId: result.operationId,
        status: 'BLOCKED',
        message: result.blocked.message,
        retryable: result.blocked.retryable,
        source: result,
      };
    const receipt = result.receipt!;
    if (
      receipt.operationId !== original.operationId ||
      receipt.tenantId !== original.tenantId ||
      receipt.actorId !== original.actorId ||
      receipt.deviceId !== original.deviceId ||
      receipt.entityId !== original.entityId ||
      receipt.payloadHash !== original.payloadHash
    )
      throw new Error('El recibo corresponde a otra intención o cuenta.');
    return {
      operationId: result.operationId,
      status: receipt.status,
      source: result,
      ...(receipt.confirmedVersion === null ? {} : { serverVersion: receipt.confirmedVersion }),
      message: typeof receipt.result.message === 'string' ? receipt.result.message : undefined,
    };
  });
}
