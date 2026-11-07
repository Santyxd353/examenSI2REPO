import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  OfflineIntent,
  OperationReceipt,
  OperationReceiptSchema,
  OPERATION_KINDS,
} from '@lumina/contracts';
import { Identity, requirePermission } from '../auth';
import { requireLocationScope } from '../inventory/scope';

export async function authorizeReceipt(
  tx: Prisma.TransactionClient,
  actor: Identity,
  receipt: OperationReceipt,
  kind: string,
) {
  requirePermission(
    actor,
    kind.startsWith('CATALOG_') ? 'catalogo:gestionar' : 'inventario:gestionar',
  );
  if (typeof receipt.result.locationId === 'string')
    await requireLocationScope(tx, actor, receipt.result.locationId);
}
export async function findReceipt(
  tx: Prisma.TransactionClient,
  actor: Identity,
  deviceId: string,
  operationId: string,
  expectedHash?: string,
) {
  const row = await tx.operacion_sincronizacion.findUnique({ where: { id: operationId } });
  if (!row) return null;
  if (
    row.actor_id !== actor.id ||
    row.dispositivo_instalacion_id !== deviceId ||
    !(OPERATION_KINDS as readonly string[]).includes(row.tipo)
  )
    throw new NotFoundException('Comprobante no disponible.');
  const receipt = OperationReceiptSchema.parse(row.resultado);
  await authorizeReceipt(tx, actor, receipt, row.tipo);
  if (expectedHash && row.hash_intencion !== expectedHash)
    throw new ConflictException({
      code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      message: 'El identificador ya tiene otro contenido. Conserva la operación original.',
    });
  return receipt;
}
export async function saveReceipt(
  tx: Prisma.TransactionClient,
  op: OfflineIntent,
  receipt: OperationReceipt,
  receivedAt: Date,
) {
  await tx.operacion_sincronizacion.create({
    data: {
      id: op.operationId,
      actor_id: op.actorId,
      dispositivo_instalacion_id: op.deviceId,
      tipo: op.kind,
      entidad_tipo: op.kind.startsWith('CATALOG_') ? 'producto' : 'inventario',
      entidad_id: op.entityId,
      version_base: op.baseVersion,
      hash_intencion: op.payloadHash,
      estado_resultado: receipt.status,
      resultado: receipt as unknown as Prisma.InputJsonValue,
      recibida_en: receivedAt,
      confirmada_en: new Date(receipt.committedAt),
    },
  });
}
