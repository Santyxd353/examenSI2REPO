import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, inventario } from '@prisma/client';
import {
  UuidSchema,
  StockDeltaInputSchema,
  StockCountInputSchema,
  StockTransferInputSchema,
} from '@lumina/contracts';
import { Identity, requirePermission } from '../auth';
import { lockActiveLocations, requireLocationScope } from './scope';

export type InventoryContext = { actor: Identity; operationId: string; newInventoryId?: string };
const uuid = UuidSchema;
const deltaInput = StockDeltaInputSchema;
const countInput = StockCountInputSchema;
const transferInput = StockTransferInputSchema;
async function authorize(
  tx: Prisma.TransactionClient,
  context: InventoryContext,
  variantId: string,
  locationIds: string[],
) {
  requirePermission(context.actor, 'inventario:gestionar');
  uuid.parse(context.operationId);
  for (const id of [...new Set(locationIds)].sort())
    await requireLocationScope(tx, context.actor, id);
  await lockActiveLocations(tx, locationIds);
  const variant = await tx.variante.findFirst({ where: { id: variantId, activa: true } });
  if (!variant) throw new NotFoundException('La variante no existe o está inactiva.');
  // Covers missing rows as well as existing stock; all multi-location callers use the same order.
  for (const locationId of [...new Set(locationIds)].sort()) {
    const lock = `lumina:stock:${variantId}:${locationId}`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lock},0))`;
  }
}
async function stock(tx: Prisma.TransactionClient, variantId: string, locationId: string) {
  const rows = await tx.$queryRaw<
    inventario[]
  >`SELECT * FROM inventario WHERE variante_id=${variantId}::uuid AND ubicacion_id=${locationId}::uuid FOR UPDATE`;
  return rows[0] || null;
}
function checkPhysical(physical: number, row: inventario | null) {
  if (physical < (row?.reservado ?? 0) + (row?.comprometido ?? 0))
    throw new ConflictException({
      code: 'INSUFFICIENT_STOCK',
      message: 'El saldo físico no puede ser menor que las unidades reservadas y comprometidas.',
    });
  if (!Number.isInteger(physical) || physical > 2147483647)
    throw new BadRequestException('El saldo supera el rango de inventario admitido.');
}
async function save(
  tx: Prisma.TransactionClient,
  row: inventario | null,
  variantId: string,
  locationId: string,
  physical: number,
  expectedId?: string,
) {
  if (expectedId && row && row.id !== expectedId)
    throw new ConflictException({
      code: 'ENTITY_CONFLICT',
      message: 'El inventario tiene otra identidad. Consulta el saldo antes de reconciliarlo.',
    });
  checkPhysical(physical, row);
  return row
    ? tx.inventario.update({
        where: { id: row.id },
        data: { fisico: physical, version: { increment: 1 } },
      })
    : tx.inventario.create({
        data: {
          ...(expectedId ? { id: uuid.parse(expectedId) } : {}),
          variante_id: variantId,
          ubicacion_id: locationId,
          fisico: physical,
          reservado: 0,
          comprometido: 0,
          version: 1,
        },
      });
}
async function movement(
  tx: Prisma.TransactionClient,
  context: InventoryContext,
  row: inventario,
  delta: number,
  type: string,
  reason: string,
  observed?: number,
) {
  return tx.movimiento_stock.create({
    data: {
      inventario_id: row.id,
      grupo_operacion: context.operationId,
      tipo: type,
      delta_fisico: delta,
      delta_reservado: 0,
      delta_comprometido: 0,
      conteo_observado: observed,
      motivo: reason,
      actor_id: context.actor.id,
      creado_en: new Date(),
    },
  });
}
async function audit(
  tx: Prisma.TransactionClient,
  context: InventoryContext,
  action: string,
  entityId: string,
  changes: Prisma.InputJsonValue,
  reason: string,
) {
  await tx.auditoria.create({
    data: {
      actor_id: context.actor.id,
      accion: action,
      entidad: 'inventario',
      entidad_id: entityId,
      correlacion: context.operationId,
      cambios: changes,
      motivo: reason,
      creado_en: new Date(),
    },
  });
}
export async function applyStockDelta(
  tx: Prisma.TransactionClient,
  context: InventoryContext,
  raw: unknown,
) {
  const input = deltaInput.parse(raw);
  await authorize(tx, context, input.variantId, [input.locationId]);
  const previous = await stock(tx, input.variantId, input.locationId);
  const current = await save(
    tx,
    previous,
    input.variantId,
    input.locationId,
    (previous?.fisico ?? 0) + input.deltaFisico,
    context.newInventoryId,
  );
  await movement(tx, context, current, input.deltaFisico, 'AJUSTE', input.reason);
  await audit(
    tx,
    context,
    'STOCK_DELTA',
    current.id,
    {
      physicalBefore: previous?.fisico ?? 0,
      physicalAfter: current.fisico,
      version: current.version,
    },
    input.reason,
  );
  return current;
}
export async function applyStockCount(
  tx: Prisma.TransactionClient,
  context: InventoryContext,
  raw: unknown,
) {
  const input = countInput.parse(raw);
  await authorize(tx, context, input.variantId, [input.locationId]);
  const previous = await stock(tx, input.variantId, input.locationId);
  if ((previous?.version ?? 0) !== input.baseVersion)
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'El inventario cambió desde la consulta. Revisa el saldo y confirma otro conteo.',
      details: { currentVersion: previous?.version ?? 0, physical: previous?.fisico ?? 0 },
    });
  const current = await save(
    tx,
    previous,
    input.variantId,
    input.locationId,
    input.observedPhysical,
    context.newInventoryId,
  );
  await movement(
    tx,
    context,
    current,
    input.observedPhysical - (previous?.fisico ?? 0),
    'CONTEO',
    input.reason,
    input.observedPhysical,
  );
  await audit(
    tx,
    context,
    'STOCK_COUNT',
    current.id,
    {
      physicalBefore: previous?.fisico ?? 0,
      physicalAfter: current.fisico,
      version: current.version,
    },
    input.reason,
  );
  return current;
}
export async function transferStock(
  tx: Prisma.TransactionClient,
  context: InventoryContext,
  raw: unknown,
) {
  const input = transferInput.parse(raw);
  await authorize(tx, context, input.variantId, [input.originId, input.targetId]);
  // Lock rows in location order too, coordinating with sales and other direct writers.
  const byLocation = new Map<string, inventario | null>();
  for (const locationId of [input.originId, input.targetId].sort())
    byLocation.set(locationId, await stock(tx, input.variantId, locationId));
  const origin = byLocation.get(input.originId)!,
    target = byLocation.get(input.targetId)!;
  if (!origin) throw new BadRequestException('La ubicación de origen no tiene esa variante.');
  const sourceAfter = await save(
    tx,
    origin,
    input.variantId,
    input.originId,
    origin.fisico - input.quantity,
  );
  const targetAfter = await save(
    tx,
    target,
    input.variantId,
    input.targetId,
    (target?.fisico ?? 0) + input.quantity,
  );
  await movement(tx, context, sourceAfter, -input.quantity, 'TRANSFERENCIA', input.reason);
  await movement(tx, context, targetAfter, input.quantity, 'TRANSFERENCIA', input.reason);
  await audit(
    tx,
    context,
    'ONLINE_TRANSFER',
    sourceAfter.id,
    {
      originId: input.originId,
      targetId: input.targetId,
      variantId: input.variantId,
      quantity: input.quantity,
      originPhysical: sourceAfter.fisico,
      targetPhysical: targetAfter.fisico,
    },
    input.reason,
  );
  return { grupoOperacion: context.operationId, origen: sourceAfter, destino: targetAfter };
}
