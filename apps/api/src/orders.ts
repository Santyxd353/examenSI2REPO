import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthGuard, AuthRequest, requirePermission } from './auth';
import { Db } from './db';
import { RealtimeGateway } from './realtime';
import {
  lockOperation,
  auditedReplay,
  recordAuditedOperation,
  assertRequestHash,
} from './commerce/idempotency';
import { claimedQuantity, minor, proportionalRefund } from './commerce/returns';
import { lockActiveLocations, requireLocationScope } from './inventory/scope';

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const status = z.enum([
  'PENDIENTE_PAGO',
  'CONFIRMADO',
  'PREPARANDO',
  'DESPACHADO',
  'ENTREGADO',
  'CERRADO',
  'CANCELADO',
]);
const channel = z.enum(['WEB', 'APP', 'TIENDA']);
const transition = z
  .object({
    status: z.enum(['PREPARANDO', 'DESPACHADO', 'ENTREGADO', 'CERRADO']),
    tracking: z.string().trim().min(3).max(150).optional(),
    reason: z.string().trim().min(3).max(400),
  })
  .strict();
const cancellation = z
  .object({ reason: z.string().trim().min(10).max(400), idempotency: uuid })
  .strict();
const returnReview = z
  .object({
    decision: z.enum(['APROBAR', 'RECHAZAR']),
    resolution: z.string().trim().min(10).max(400),
    locationId: uuid.optional(),
    idempotency: uuid,
    items: z
      .array(
        z
          .object({
            returnDetailId: uuid,
            acceptedQuantity: z.number().int().min(0).max(100),
            observation: z.string().trim().max(400).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();

const allowedTransitions: Record<string, string[]> = {
  CONFIRMADO: ['PREPARANDO'],
  PREPARANDO: ['DESPACHADO'],
  DESPACHADO: ['ENTREGADO'],
  ENTREGADO: ['CERRADO'],
};

@Controller('admin/orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RealtimeGateway) private realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(
    @Req() req: AuthRequest,
    @Query('status') rawStatus = '',
    @Query('channel') rawChannel = '',
  ) {
    requirePermission(req.user, 'pedidos:gestionar');
    const parsedStatus = rawStatus ? status.parse(rawStatus) : undefined;
    const parsedChannel = rawChannel ? channel.parse(rawChannel) : undefined;
    return this.db.pedido.findMany({
      where: {
        ...(parsedStatus ? { estado: parsedStatus } : {}),
        ...(parsedChannel ? { canal: parsedChannel } : {}),
      },
      orderBy: { creado_en: 'desc' },
      take: 100,
      include: {
        usuario_pedido_usuario_idTousuario: {
          select: { nombres: true, apellidos: true, correo: true, telefono: true },
        },
        ubicacion: { select: { nombre: true, tipo: true } },
        detalle_pedido: true,
        pago: true,
        historial_pedido: { orderBy: { creado_en: 'asc' } },
        devolucion: {
          include: {
            detalle_devolucion: { include: { detalle_pedido: true } },
            reembolso: true,
          },
          orderBy: { solicitada_en: 'desc' },
        },
      },
    });
  }

  @Patch(':id/status')
  async updateStatus(@Req() req: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    requirePermission(req.user, 'pedidos:gestionar');
    const id = uuid.parse(rawId);
    const input = transition.parse(body);
    return this.db.$transaction(
      async (tx) => {
        await lockOperation(tx, 'order', id);
        const order = await tx.pedido.findUnique({ where: { id } });
        if (!order) throw new BadRequestException('Pedido no encontrado.');
        if (!allowedTransitions[order.estado]?.includes(input.status))
          throw new BadRequestException(
            `No se puede cambiar un pedido ${order.estado} a ${input.status}.`,
          );
        if (input.status === 'DESPACHADO' && !input.tracking)
          throw new BadRequestException('Registra el código o referencia de seguimiento.');
        const claimed = await tx.pedido.updateMany({
          where: { id, estado: order.estado },
          data: {
            estado: input.status,
            ...(input.tracking ? { seguimiento: input.tracking } : {}),
            ...(input.status === 'ENTREGADO' ? { entregado_en: new Date() } : {}),
          },
        });
        if (claimed.count !== 1)
          throw new BadRequestException(
            'El pedido cambió. Actualiza la pantalla e intenta otra vez.',
          );
        await tx.historial_pedido.create({
          data: {
            pedido_id: id,
            actor_id: req.user.id,
            estado_anterior: order.estado,
            estado_nuevo: input.status,
            motivo: input.reason,
            creado_en: new Date(),
          },
        });
        return tx.pedido.findUniqueOrThrow({
          where: { id },
          include: {
            usuario_pedido_usuario_idTousuario: {
              select: { nombres: true, apellidos: true, correo: true, telefono: true },
            },
            ubicacion: { select: { nombre: true, tipo: true } },
            detalle_pedido: true,
            pago: true,
            historial_pedido: { orderBy: { creado_en: 'asc' } },
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  @Patch(':id/cancel')
  async cancel(@Req() req: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    requirePermission(req.user, 'pedidos:gestionar');
    const id = uuid.parse(rawId);
    const input = cancellation.parse(body);
    const context = {
      actorId: req.user.id,
      operationId: input.idempotency,
      action: 'ORDER_CANCEL',
      entityId: id,
    };
    const changed = await this.db.$transaction(
      async (tx) => {
        const replay = await auditedReplay<{ locationId: string; variantIds: string[] }>(
          tx,
          context,
          input,
        );
        if (replay) return replay.value;
        await lockOperation(tx, 'order', id);
        const previous = await tx.reembolso.findUnique({
          where: { idempotencia: input.idempotency },
          include: { devolucion: true },
        });
        if (previous) {
          if (previous.devolucion?.pedido_id !== id)
            throw new BadRequestException('Este identificador ya fue utilizado.');
          assertRequestHash(previous.motivo, input.reason);
          const oldOrder = await tx.pedido.findUniqueOrThrow({ where: { id } });
          return { locationId: oldOrder.ubicacion_id!, variantIds: [] };
        }
        const order = await tx.pedido.findUnique({
          where: { id },
          include: {
            detalle_pedido: true,
            pago: true,
            devolucion: { where: { estado: { not: 'RECHAZADA' } } },
          },
        });
        if (!order) throw new BadRequestException('Pedido no encontrado.');
        if (!['CONFIRMADO', 'PREPARANDO'].includes(order.estado))
          throw new BadRequestException('Solo se cancelan pedidos confirmados o en preparación.');
        if (!order.ubicacion_id)
          throw new BadRequestException(
            'El pedido no tiene una ubicación para reintegrar el stock.',
          );
        if (order.devolucion.length)
          throw new BadRequestException('El pedido ya tiene una cancelación o devolución activa.');
        const payment = order.pago.find((item) => item.estado === 'CONFIRMADO');
        if (!payment) throw new BadRequestException('El pedido no tiene un pago confirmado.');
        const refunded = await tx.reembolso.aggregate({
          where: { pago_id: payment.id, estado: 'CONFIRMADO' },
          _sum: { monto: true },
        });
        const remainingMinor = minor(payment.monto) - minor(refunded._sum.monto ?? 0);
        if (remainingMinor <= 0)
          throw new BadRequestException('El pago no tiene saldo pendiente de reembolso.');
        await requireLocationScope(tx, req.user, order.ubicacion_id);
        await lockActiveLocations(tx, [order.ubicacion_id]);

        const now = new Date();
        const refundRequest = await tx.devolucion.create({
          data: {
            pedido_id: order.id,
            usuario_id: order.usuario_id,
            tipo: 'CANCELACION',
            estado: 'RESUELTA',
            motivo: input.reason,
            resolucion: 'Cancelación administrativa aprobada con reintegro y reembolso simulado.',
            revisado_por: req.user.id,
            solicitada_en: now,
            resuelta_en: now,
          },
        });
        const variantIds: string[] = [];
        for (const line of order.detalle_pedido) {
          const inventory = await tx.inventario.findUnique({
            where: {
              variante_id_ubicacion_id: {
                variante_id: line.variante_id,
                ubicacion_id: order.ubicacion_id,
              },
            },
          });
          if (!inventory)
            throw new BadRequestException(
              `No existe inventario para reintegrar ${line.sku_snapshot}.`,
            );
          await tx.inventario.update({
            where: { id: inventory.id },
            data: { fisico: { increment: line.cantidad }, version: { increment: 1 } },
          });
          const detail = await tx.detalle_devolucion.create({
            data: {
              devolucion_id: refundRequest.id,
              detalle_pedido_id: line.id,
              cantidad: line.cantidad,
              cantidad_apta: line.cantidad,
              ubicacion_id: order.ubicacion_id,
              observacion: 'Cancelación antes del despacho; stock reintegrado.',
              reintegrada_en: now,
            },
          });
          await tx.movimiento_stock.create({
            data: {
              inventario_id: inventory.id,
              grupo_operacion: refundRequest.id,
              tipo: 'DEVOLUCION',
              delta_fisico: line.cantidad,
              delta_reservado: 0,
              delta_comprometido: 0,
              motivo: `Cancelación ${order.numero} · detalle ${detail.id}`,
              actor_id: req.user.id,
              pedido_id: order.id,
              creado_en: now,
            },
          });
          variantIds.push(line.variante_id);
        }
        await tx.reembolso.create({
          data: {
            pago_id: payment.id,
            devolucion_id: refundRequest.id,
            idempotencia: input.idempotency,
            referencia: `CANCEL-${order.numero}`,
            monto: remainingMinor / 100,
            estado: 'CONFIRMADO',
            motivo: input.reason,
            creado_en: now,
            confirmado_en: now,
          },
        });
        await tx.pago.update({ where: { id: payment.id }, data: { estado: 'REEMBOLSADO' } });
        await tx.pedido.update({ where: { id }, data: { estado: 'CANCELADO' } });
        await tx.historial_pedido.create({
          data: {
            pedido_id: order.id,
            actor_id: req.user.id,
            estado_anterior: order.estado,
            estado_nuevo: 'CANCELADO',
            motivo: input.reason,
            creado_en: now,
          },
        });
        const result = { locationId: order.ubicacion_id, variantIds };
        await recordAuditedOperation(tx, context, input, result);
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    this.realtime.inventoryChanged(changed.locationId, {
      variantIds: changed.variantIds,
      reason: 'CANCELACION',
    });
    return this.db.pedido.findUniqueOrThrow({ where: { id } });
  }

  @Patch('returns/:id/review')
  async reviewReturn(@Req() req: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    requirePermission(req.user, 'pedidos:gestionar');
    const id = uuid.parse(rawId);
    const input = returnReview.parse(body);
    if (new Set(input.items.map((item) => item.returnDetailId)).size !== input.items.length)
      throw new BadRequestException('No repitas una prenda en la revisión.');
    const context = {
      actorId: req.user.id,
      operationId: input.idempotency,
      action: 'RETURN_REVIEW',
      entityId: id,
    };
    const changed = await this.db.$transaction(
      async (tx) => {
        const replay = await auditedReplay<{ locationId: string | null; variantIds: string[] }>(
          tx,
          context,
          input,
        );
        if (replay) return replay.value;
        const link = await tx.devolucion.findUnique({ where: { id }, select: { pedido_id: true } });
        if (!link) throw new BadRequestException('Solicitud de devolución no encontrada.');
        await lockOperation(tx, 'order', link.pedido_id);
        const prior = await tx.reembolso.findUnique({
          where: { idempotencia: input.idempotency },
          include: { devolucion: { include: { detalle_devolucion: true } } },
        });
        if (prior) {
          if (prior.devolucion_id !== id)
            throw new BadRequestException('Este identificador ya fue utilizado.');
          assertRequestHash(prior.motivo, input.resolution);
          if (
            input.decision !== 'APROBAR' ||
            input.items.length !== prior.devolucion?.detalle_devolucion.length ||
            input.items.some(
              (item) =>
                prior.devolucion?.detalle_devolucion.find(
                  (detail) => detail.id === item.returnDetailId,
                )?.cantidad_apta !== item.acceptedQuantity,
            )
          )
            assertRequestHash('legacy-review', 'different-review');
          return { locationId: null, variantIds: [] as string[] };
        }
        const request = await tx.devolucion.findUnique({
          where: { id },
          include: {
            detalle_devolucion: { include: { detalle_pedido: true } },
            pedido: { include: { pago: true } },
          },
        });
        if (!request || request.tipo !== 'DEVOLUCION')
          throw new BadRequestException('Solicitud de devolución no encontrada.');
        if (request.estado !== 'SOLICITADA')
          throw new BadRequestException('La devolución ya fue revisada.');
        const now = new Date();
        if (input.decision === 'RECHAZAR') {
          const claimed = await tx.devolucion.updateMany({
            where: { id, estado: 'SOLICITADA' },
            data: {
              estado: 'RECHAZADA',
              resolucion: input.resolution,
              revisado_por: req.user.id,
              resuelta_en: now,
            },
          });
          if (claimed.count !== 1) throw new BadRequestException('La devolución ya fue revisada.');
          const result = { locationId: null as string | null, variantIds: [] as string[] };
          await recordAuditedOperation(tx, context, input, result);
          return result;
        }
        const locationId = input.locationId || request.pedido.ubicacion_id;
        if (!locationId)
          throw new BadRequestException('Selecciona una ubicación para recibir la devolución.');
        await requireLocationScope(tx, req.user, locationId);
        await lockActiveLocations(tx, [locationId]);
        if (input.items.length !== request.detalle_devolucion.length)
          throw new BadRequestException('Revisa la cantidad de cada prenda solicitada.');
        const inputs = new Map(input.items.map((item) => [item.returnDetailId, item]));
        let refundMinor = 0;
        const variantIds: string[] = [];
        for (const detail of request.detalle_devolucion.sort((a, b) =>
          a.detalle_pedido.variante_id.localeCompare(b.detalle_pedido.variante_id),
        )) {
          const reviewed = inputs.get(detail.id);
          if (!reviewed || reviewed.acceptedQuantity > detail.cantidad)
            throw new BadRequestException('Una cantidad aceptada supera lo solicitado.');
          const acceptedBefore = await claimedQuantity(tx, detail.detalle_pedido_id, false);
          const amount = proportionalRefund(
            detail.detalle_pedido.total_linea,
            detail.detalle_pedido.cantidad,
            acceptedBefore,
            reviewed.acceptedQuantity,
          );
          await tx.detalle_devolucion.update({
            where: { id: detail.id },
            data: {
              cantidad_apta: reviewed.acceptedQuantity,
              ubicacion_id: locationId,
              observacion: reviewed.observation,
              reintegrada_en: reviewed.acceptedQuantity ? now : null,
            },
          });
          if (!reviewed.acceptedQuantity) continue;
          const inventory = await tx.inventario.findUnique({
            where: {
              variante_id_ubicacion_id: {
                variante_id: detail.detalle_pedido.variante_id,
                ubicacion_id: locationId,
              },
            },
          });
          if (!inventory)
            throw new BadRequestException(
              `No existe inventario para reintegrar ${detail.detalle_pedido.sku_snapshot}.`,
            );
          await tx.inventario.update({
            where: { id: inventory.id },
            data: {
              fisico: { increment: reviewed.acceptedQuantity },
              version: { increment: 1 },
            },
          });
          await tx.movimiento_stock.create({
            data: {
              inventario_id: inventory.id,
              grupo_operacion: request.id,
              tipo: 'DEVOLUCION',
              delta_fisico: reviewed.acceptedQuantity,
              delta_reservado: 0,
              delta_comprometido: 0,
              motivo: `Devolución ${request.pedido.numero} · ${input.resolution}`,
              actor_id: req.user.id,
              pedido_id: request.pedido_id,
              creado_en: now,
            },
          });
          refundMinor += amount;
          variantIds.push(detail.detalle_pedido.variante_id);
        }
        if (refundMinor <= 0)
          throw new BadRequestException('Acepta al menos una unidad o rechaza la solicitud.');
        const payment = request.pedido.pago.find((item) =>
          ['CONFIRMADO', 'REEMBOLSADO'].includes(item.estado),
        );
        if (!payment) throw new BadRequestException('No existe un pago para reembolsar.');
        const previousRefunds = await tx.reembolso.aggregate({
          where: { pago_id: payment.id, estado: 'CONFIRMADO' },
          _sum: { monto: true },
        });
        const refundedBefore = minor(previousRefunds._sum.monto || 0);
        if (refundedBefore + refundMinor > minor(payment.monto))
          throw new BadRequestException('El reembolso supera el pago confirmado.');
        await tx.reembolso.create({
          data: {
            pago_id: payment.id,
            devolucion_id: request.id,
            idempotencia: input.idempotency,
            referencia: `DEV-${request.id}`,
            monto: refundMinor / 100,
            estado: 'CONFIRMADO',
            motivo: input.resolution,
            creado_en: now,
            confirmado_en: now,
          },
        });
        if (refundedBefore + refundMinor === minor(payment.monto))
          await tx.pago.update({ where: { id: payment.id }, data: { estado: 'REEMBOLSADO' } });
        const claimed = await tx.devolucion.updateMany({
          where: { id, estado: 'SOLICITADA' },
          data: {
            estado: 'RESUELTA',
            resolucion: input.resolution,
            revisado_por: req.user.id,
            resuelta_en: now,
          },
        });
        if (claimed.count !== 1) throw new BadRequestException('La devolución ya fue revisada.');
        const result = { locationId, variantIds };
        await recordAuditedOperation(tx, context, input, result);
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    if (changed.locationId && changed.variantIds.length)
      this.realtime.inventoryChanged(changed.locationId, {
        variantIds: changed.variantIds,
        reason: 'DEVOLUCION',
      });
    return this.db.devolucion.findUniqueOrThrow({
      where: { id },
      include: { detalle_devolucion: true, reembolso: true },
    });
  }
}
