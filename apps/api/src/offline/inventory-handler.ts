import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OfflineIntent } from '@lumina/contracts';
import { Identity, requirePermission } from '../auth';
import { requireLocationScope } from '../inventory/scope';
import { applyStockCount, applyStockDelta } from '../inventory/inventory.service';
export async function inventoryHandler(
  tx: Prisma.TransactionClient,
  actor: Identity,
  op: Extract<OfflineIntent, { kind: 'STOCK_DELTA' | 'STOCK_COUNT' }>,
) {
  requirePermission(actor, 'inventario:gestionar');
  await requireLocationScope(tx, actor, op.payload.locationId);
  const identity = await tx.inventario.findUnique({ where: { id: op.entityId } });
  if (
    identity &&
    (identity.variante_id !== op.payload.variantId ||
      identity.ubicacion_id !== op.payload.locationId)
  )
    throw new BadRequestException('La identidad del inventario pertenece a otro saldo.');
  const row = await tx.inventario.findUnique({
    where: {
      variante_id_ubicacion_id: {
        variante_id: op.payload.variantId,
        ubicacion_id: op.payload.locationId,
      },
    },
  });
  if (row && row.id !== op.entityId)
    throw new BadRequestException(
      'La identidad del inventario no coincide con su variante y ubicación.',
    );
  const context = { actor, operationId: op.operationId, newInventoryId: op.entityId };
  const result =
    op.kind === 'STOCK_DELTA'
      ? await applyStockDelta(tx, context, op.payload)
      : await applyStockCount(tx, context, { ...op.payload, baseVersion: op.baseVersion });
  return {
    version: result.version,
    result: {
      inventoryId: result.id,
      variantId: result.variante_id,
      locationId: result.ubicacion_id,
      physical: result.fisico,
      reserved: result.reservado,
      committed: result.comprometido,
      version: result.version,
    },
  };
}
