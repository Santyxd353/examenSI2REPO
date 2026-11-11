import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { RealtimeGateway } from '../realtime';
import { lockOperation } from './idempotency';

export async function closePendingOrder(
  orderId: string,
  nextState: 'CANCELADO' | 'CONFIRMADO',
  event:
    | {
        id: string;
        decision: 'APROBAR' | 'RECHAZAR';
        method?: 'QR_PRUEBA' | 'STRIPE_TEST';
        reference?: string;
        expectedProvider?: string;
        providerReference?: string;
        requestHash?: string;
      }
    | undefined,
  database: PrismaClient,
  realtime: RealtimeGateway,
) {
  const changed = await database.$transaction(async (tx) => {
    if (event) await lockOperation(tx, 'payment-event', event.id);
    await lockOperation(tx, 'order', orderId);
    const order = await tx.pedido.findUnique({
      where: { id: orderId },
      include: { detalle_pedido: { include: { reserva_stock: true } }, pago: true },
    });
    if (!order || order.estado !== 'PENDIENTE_PAGO') return null;
    if (
      event?.expectedProvider &&
      (order.pago[0]?.proveedor !== event.expectedProvider ||
        (event.providerReference && order.pago[0]?.referencia !== event.providerReference))
    )
      throw new BadRequestException('El método de pago cambió. Actualiza el pedido.');
    if (
      event &&
      (await tx.evento_pago.findUnique({
        where: {
          proveedor_evento_externo: {
            proveedor: order.pago[0]?.proveedor ?? '',
            evento_externo: event.id,
          },
        },
      }))
    )
      throw new BadRequestException('Este identificador de pago ya fue utilizado.');
    const reservations = order.detalle_pedido
      .flatMap((line) => line.reserva_stock)
      .filter((row) => row.estado === 'ACTIVA');
    if (
      nextState === 'CONFIRMADO' &&
      (reservations.length !== order.detalle_pedido.length ||
        reservations.some((row) => row.vence_en <= new Date()))
    )
      throw new BadRequestException('La reserva venció. Crea un pedido nuevo.');
    const claimed = await tx.pedido.updateMany({
      where: { id: orderId, estado: 'PENDIENTE_PAGO' },
      data: { estado: nextState },
    });
    if (claimed.count !== 1) return null;
    const now = new Date();
    for (const reservation of reservations.sort((a, b) =>
      a.inventario_id.localeCompare(b.inventario_id),
    )) {
      const updated = await tx.inventario.updateMany({
        where: {
          id: reservation.inventario_id,
          reservado: { gte: reservation.cantidad },
          ...(nextState === 'CONFIRMADO' ? { fisico: { gte: reservation.cantidad } } : {}),
        },
        data: {
          reservado: { decrement: reservation.cantidad },
          ...(nextState === 'CONFIRMADO' ? { fisico: { decrement: reservation.cantidad } } : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new BadRequestException('El inventario cambió. Intenta nuevamente.');
      await tx.reserva_stock.update({
        where: { id: reservation.id },
        data: { estado: nextState === 'CONFIRMADO' ? 'DESPACHADA' : 'LIBERADA', cerrada_en: now },
      });
      await tx.movimiento_stock.create({
        data: {
          inventario_id: reservation.inventario_id,
          grupo_operacion: order.id,
          tipo: nextState === 'CONFIRMADO' ? 'SALIDA' : 'LIBERACION',
          delta_fisico: nextState === 'CONFIRMADO' ? -reservation.cantidad : 0,
          delta_reservado: -reservation.cantidad,
          delta_comprometido: 0,
          motivo: `${nextState === 'CONFIRMADO' ? 'Pago simulado aprobado' : 'Reserva vencida o pago rechazado'} ${order.numero}`,
          actor_id: order.usuario_id,
          pedido_id: order.id,
          creado_en: now,
        },
      });
    }
    if (nextState === 'CONFIRMADO') {
      await tx.pago.updateMany({
        where: { pedido_id: order.id, estado: 'PENDIENTE' },
        data: { estado: 'CONFIRMADO', confirmado_en: now },
      });
    } else {
      await tx.pago.updateMany({
        where: { pedido_id: order.id, estado: 'PENDIENTE' },
        data: { estado: event ? 'RECHAZADO' : 'CANCELADO' },
      });
    }
    if (event) {
      const provider = order.pago[0]?.proveedor;
      if (!provider) throw new BadRequestException('Pago no disponible.');
      await tx.evento_pago.create({
        data: {
          pago_id: order.pago[0].id,
          proveedor: provider,
          evento_externo: event.id,
          tipo: event.decision,
          firma_verificada: true,
          payload_resumen: {
            simulacion: true,
            metodo: event.method ?? 'NO_ESPECIFICADO',
            referencia: event.reference ?? null,
            requestHash: event.requestHash ?? null,
          },
          recibido_en: now,
          procesado_en: now,
        },
      });
    }
    await tx.historial_pedido.create({
      data: {
        pedido_id: order.id,
        actor_id: event ? order.usuario_id : null,
        estado_anterior: 'PENDIENTE_PAGO',
        estado_nuevo: nextState,
        motivo:
          nextState === 'CONFIRMADO'
            ? 'Pago simulado aprobado por el cliente.'
            : event
              ? 'Pago simulado rechazado por el cliente.'
              : 'Reserva de stock vencida automáticamente.',
        creado_en: now,
      },
    });
    return {
      locationId: order.ubicacion_id,
      variantIds: order.detalle_pedido.map((line) => line.variante_id),
    };
  });
  if (changed?.locationId)
    realtime.inventoryChanged(changed.locationId, {
      variantIds: changed.variantIds,
      reason: nextState,
    });
  return changed;
}
