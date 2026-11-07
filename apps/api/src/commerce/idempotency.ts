import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { canonicalJson } from '@lumina/contracts';

export function requestHash(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
// Transaction-scoped and database-local: independent tenants never share this lock.
export async function lockOperation(tx: Prisma.TransactionClient, namespace: string, id: string) {
  const key = `lumina:${namespace}:${id.toLowerCase()}`;
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
}
export function assertRequestHash(previous: unknown, expected: string) {
  if (previous !== expected)
    throw new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message:
        'Este identificador ya pertenece a otra operación. Conserva el UUID únicamente al reenviar la misma solicitud.',
    });
}

type AuditContext = { actorId: string; operationId: string; action: string; entityId: string };
export async function auditedReplay<T>(
  tx: Prisma.TransactionClient,
  context: AuditContext,
  input: unknown,
): Promise<{ value: T } | null> {
  await lockOperation(tx, 'refund-intent', context.operationId);
  const previous = await tx.auditoria.findFirst({
    where: { correlacion: context.operationId },
    orderBy: { creado_en: 'asc' },
  });
  if (!previous) return null;
  const data = (previous.cambios ?? {}) as { requestHash?: string; result: T };
  assertRequestHash(data.requestHash, requestHash({ ...context, input }));
  return { value: data.result };
}
export async function recordAuditedOperation(
  tx: Prisma.TransactionClient,
  context: AuditContext,
  input: unknown,
  result: Prisma.InputJsonValue,
) {
  await tx.auditoria.create({
    data: {
      actor_id: context.actorId,
      accion: context.action,
      entidad: context.action === 'RETURN_REVIEW' ? 'devolucion' : 'pedido',
      entidad_id: context.entityId,
      correlacion: context.operationId,
      cambios: { requestHash: requestHash({ ...context, input }), result },
      creado_en: new Date(),
    },
  });
}
