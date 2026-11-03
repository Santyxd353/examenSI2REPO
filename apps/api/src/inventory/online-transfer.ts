import { Prisma } from '@prisma/client';
import { OnlineTransfer } from '@lumina/contracts';
import { randomUUID } from 'crypto';
import { Identity, requirePermission } from '../auth';
import { assertRequestHash, lockOperation, requestHash } from '../commerce/idempotency';
import { requireLocationScope } from './scope';
import { transferStock } from './inventory.service';

export async function onlineTransfer(
  tx: Prisma.TransactionClient,
  actor: Identity,
  input: OnlineTransfer,
) {
  requirePermission(actor, 'inventario:gestionar');
  for (const location of [input.origenId, input.destinoId])
    await requireLocationScope(tx, actor, location);
  const operationId = input.operationId ?? randomUUID();
  const hash = requestHash({ actorId: actor.id, ...input });
  await lockOperation(tx, 'operation', operationId);
  const previous = await tx.operacion_sincronizacion.findUnique({ where: { id: operationId } });
  if (previous) {
    assertRequestHash(previous.hash_intencion, hash);
    // Hash binds actor/device and operation type is independently checked.
    assertRequestHash(previous.tipo, 'ONLINE_TRANSFER');
    return previous.resultado as unknown as Awaited<ReturnType<typeof transferStock>>;
  }
  const result = await transferStock(
    tx,
    { actor, operationId },
    {
      variantId: input.varianteId,
      originId: input.origenId,
      targetId: input.destinoId,
      quantity: input.cantidad,
      reason: input.motivo,
    },
  );
  if (input.deviceId)
    await tx.operacion_sincronizacion.create({
      data: {
        id: operationId,
        actor_id: actor.id,
        dispositivo_instalacion_id: input.deviceId,
        tipo: 'ONLINE_TRANSFER',
        entidad_tipo: 'inventario',
        entidad_id: result.origen.id,
        hash_intencion: hash,
        estado_resultado: 'APPLIED',
        resultado: JSON.parse(JSON.stringify(result)),
        recibida_en: new Date(),
        confirmada_en: new Date(),
      },
    });
  return result;
}
