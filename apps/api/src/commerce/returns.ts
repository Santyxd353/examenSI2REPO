import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export async function claimedQuantity(
  tx: Prisma.TransactionClient,
  detailId: string,
  includePending = true,
) {
  // Caller holds the parent order lock; row lock also coordinates direct line writers.
  await tx.$queryRaw`SELECT id FROM detalle_pedido WHERE id=${detailId}::uuid FOR UPDATE`;
  const rows = await tx.detalle_devolucion.findMany({
    where: { detalle_pedido_id: detailId, devolucion: { estado: { not: 'RECHAZADA' } } },
    include: { devolucion: { select: { estado: true } } },
  });
  return rows.reduce(
    (sum, row) =>
      sum +
      (row.devolucion.estado === 'RESUELTA'
        ? row.cantidad_apta
        : includePending
          ? row.cantidad
          : 0),
    0,
  );
}
export function minor(value: Prisma.Decimal | number | string) {
  return new Prisma.Decimal(value)
    .mul(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();
}
export function proportionalRefund(
  total: Prisma.Decimal,
  quantity: number,
  prior: number,
  accepted: number,
) {
  if (prior + accepted > quantity)
    throw new BadRequestException(
      'La cantidad aceptada supera las unidades pendientes de devolución.',
    );
  // Cumulative rounding allocates the last cent exactly once across partial returns.
  const cumulative = (units: number) =>
    total
      .mul(100)
      .mul(units)
      .div(quantity)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
  return cumulative(prior + accepted) - cumulative(prior);
}
