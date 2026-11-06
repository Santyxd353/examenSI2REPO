import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as timers from 'node:timers';
import { z } from 'zod';
import { AuthGuard, AuthRequest } from './auth';
import { Db } from './db';
import { RealtimeGateway } from './realtime';

const uuid = z.string().uuid();
const cartItem = z.object({ variantId: uuid, quantity: z.number().int().min(0).max(100) }).strict();
const checkout = z
  .object({
    locationId: uuid,
    idempotency: uuid,
    address: z.string().trim().min(10).max(400),
    addressId: uuid.optional(),
  })
  .strict();
const paymentDecision = z
  .object({
    decision: z.enum(['APROBAR', 'RECHAZAR']),
    idempotency: uuid,
    method: z.enum(['TARJETA_PRUEBA', 'QR_PRUEBA']).optional(),
    reference: z
      .string()
      .trim()
      .regex(/^[A-Z0-9-]{4,32}$/)
      .optional(),
  })
  .strict();
const returnRequest = z
  .object({
    reason: z.string().trim().min(10).max(500),
    items: z
      .array(z.object({ detailId: uuid, quantity: z.number().int().min(1).max(100) }).strict())
      .min(1),
  })
  .strict();

type CommerceChannel = 'WEB' | 'APP';

function requestChannel(req: AuthRequest): CommerceChannel {
  return String(req.headers['x-client-channel'] ?? '').toUpperCase() === 'APP' ? 'APP' : 'WEB';
}

function simulatedProvider(channel: CommerceChannel) {
  return channel === 'APP' ? 'SIMULADO_APP' : 'SIMULADO_WEB';
}

@Controller('commerce')
@UseGuards(AuthGuard)
export class CommerceController implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RealtimeGateway) private realtime: RealtimeGateway,
  ) {}
  private expiryTimer?: ReturnType<typeof timers.setInterval>;
  onModuleInit() {
    const timer = timers.setInterval(
      () =>
        void this.releaseExpired().catch((error) =>
          console.error('No se pudieron liberar reservas:', error),
        ),
      60_000,
    );
    this.expiryTimer = timer;
  }
  onModuleDestroy() {
    if (this.expiryTimer) timers.clearInterval(this.expiryTimer);
  }

  private async activeCart(userId: string, channel: CommerceChannel) {
    return (
      (await this.db.carrito.findFirst({
        where: { usuario_id: userId, canal: channel, estado: 'ACTIVO' },
        orderBy: { actualizado_en: 'desc' },
      })) ??
      this.db.carrito.create({
        data: { usuario_id: userId, canal: channel, estado: 'ACTIVO', actualizado_en: new Date() },
      })
    );
  }

  private async releaseExpired() {
    const expired = await this.db.pedido.findMany({
      where: {
        canal: { in: ['WEB', 'APP'] },
        estado: 'PENDIENTE_PAGO',
        detalle_pedido: {
          some: { reserva_stock: { some: { estado: 'ACTIVA', vence_en: { lte: new Date() } } } },
        },
      },
      select: { id: true },
      take: 50,
    });
    for (const { id } of expired) await this.closePending(id, 'CANCELADO');
  }

  private async closePending(
    orderId: string,
    nextState: 'CANCELADO' | 'CONFIRMADO',
    event?: {
      id: string;
      decision: 'APROBAR' | 'RECHAZAR';
      method?: 'TARJETA_PRUEBA' | 'QR_PRUEBA';
      reference?: string;
    },
  ) {
    const changed = await this.db.$transaction(async (tx) => {
      const order = await tx.pedido.findUnique({
        where: { id: orderId },
        include: { detalle_pedido: { include: { reserva_stock: true } }, pago: true },
      });
      if (!order || order.estado !== 'PENDIENTE_PAGO') return null;
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
      for (const reservation of reservations) {
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
      this.realtime.inventoryChanged(changed.locationId, {
        variantIds: changed.variantIds,
        reason: nextState,
      });
    return changed;
  }

  @Get('cart')
  async getCart(@Req() req: AuthRequest) {
    const cart = await this.activeCart(req.user.id, requestChannel(req));
    return this.db.carrito.findUniqueOrThrow({
      where: { id: cart.id },
      include: { item_carrito: { include: { variante: { include: { producto: true } } } } },
    });
  }

  @Post('cart/items')
  async setItem(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = cartItem.parse(body);
    const cart = await this.activeCart(req.user.id, requestChannel(req));
    if (input.quantity > 0) {
      const variant = await this.db.variante.findFirst({
        where: { id: input.variantId, activa: true, producto: { estado: 'PUBLICADO' } },
      });
      if (!variant) throw new BadRequestException('La prenda no está publicada.');
      await this.db.item_carrito.upsert({
        where: { carrito_id_variante_id: { carrito_id: cart.id, variante_id: input.variantId } },
        create: { carrito_id: cart.id, variante_id: input.variantId, cantidad: input.quantity },
        update: { cantidad: input.quantity },
      });
    } else {
      await this.db.item_carrito.deleteMany({
        where: { carrito_id: cart.id, variante_id: input.variantId },
      });
    }
    await this.db.carrito.update({ where: { id: cart.id }, data: { actualizado_en: new Date() } });
    return this.getCart(req);
  }

  @Get('orders')
  async orders(@Req() req: AuthRequest) {
    await this.releaseExpired();
    return this.db.pedido.findMany({
      where: { usuario_id: req.user.id, canal: requestChannel(req) },
      orderBy: { creado_en: 'desc' },
      take: 20,
      include: {
        detalle_pedido: { include: { reserva_stock: true } },
        pago: true,
        devolucion: { include: { detalle_devolucion: true } },
      },
    });
  }

  @Post('checkout')
  async placeOrder(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = checkout.parse(body);
    const channel = requestChannel(req);
    await this.releaseExpired();
    const previous = await this.db.pedido.findUnique({
      where: { idempotencia: input.idempotency },
      include: { detalle_pedido: true, pago: true },
    });
    if (previous) {
      if (previous.usuario_id !== req.user.id || previous.canal !== channel)
        throw new BadRequestException('Este identificador ya fue utilizado.');
      return previous;
    }
    const cart = await this.activeCart(req.user.id, channel);
    const order = await this.db.$transaction(
      async (tx) => {
        const location = await tx.ubicacion.findFirst({
          where: { id: input.locationId, activa: true },
        });
        if (!location) throw new BadRequestException('La sucursal o almacén no está activo.');
        const savedAddress = input.addressId
          ? await tx.direccion.findFirst({
              where: { id: input.addressId, usuario_id: req.user.id, activa: true },
            })
          : null;
        if (input.addressId && !savedAddress)
          throw new BadRequestException('La dirección guardada no está disponible.');
        const items = await tx.item_carrito.findMany({
          where: { carrito_id: cart.id },
          include: { variante: { include: { producto: true } } },
        });
        if (!items.length) throw new BadRequestException('El carrito está vacío.');
        const now = new Date();
        const lines = [];
        for (const item of items) {
          if (!item.variante.activa || item.variante.producto.estado !== 'PUBLICADO')
            throw new BadRequestException('Una prenda ya no está disponible.');
          const price = await tx.precio_canal.findFirst({
            where: {
              variante_id: item.variante_id,
              canal: channel,
              desde: { lte: now },
              OR: [{ hasta: null }, { hasta: { gt: now } }],
            },
            orderBy: { desde: 'desc' },
          });
          const availability = await tx.disponibilidad_canal.findFirst({
            where: {
              variante_id: item.variante_id,
              ubicacion_id: input.locationId,
              canal: channel,
              habilitada: true,
            },
          });
          const inventory = await tx.inventario.findUnique({
            where: {
              variante_id_ubicacion_id: {
                variante_id: item.variante_id,
                ubicacion_id: input.locationId,
              },
            },
          });
          if (!price || !availability || !inventory)
            throw new BadRequestException(
              `No disponible para compra en ${channel === 'APP' ? 'la aplicación' : 'la web'}: ${item.variante.sku}.`,
            );
          const unit = Number(
            (Number(price.importe) * (1 - Number(price.descuento_pct) / 100)).toFixed(2),
          );
          lines.push({ item, inventory, unit, security: availability.stock_seguridad });
        }
        const total = Number(
          lines.reduce((sum, line) => sum + line.unit * line.item.cantidad, 0).toFixed(2),
        );
        const number = `${channel}-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
        const order = await tx.pedido.create({
          data: {
            usuario_id: req.user.id,
            ubicacion_id: input.locationId,
            carrito_id: cart.id,
            numero: number,
            canal: channel,
            moneda: 'BOB',
            subtotal: total,
            descuento: 0,
            impuesto: 0,
            entrega: 0,
            total,
            direccion_snapshot: savedAddress
              ? {
                  direccionId: savedAddress.id,
                  alias: savedAddress.alias,
                  destinatario: savedAddress.destinatario,
                  telefono: savedAddress.telefono,
                  ciudad: savedAddress.ciudad,
                  zona: savedAddress.zona,
                  detalle: savedAddress.detalle,
                }
              : { detalle: input.address },
            reglas_snapshot: {
              tipo: channel === 'APP' ? 'COMPRA_APP' : 'COMPRA_WEB',
              pago: 'SIMULADO',
              reservaMinutos: 15,
            },
            estado: 'PENDIENTE_PAGO',
            creado_en: now,
            idempotencia: input.idempotency,
          },
        });
        await tx.historial_pedido.create({
          data: {
            pedido_id: order.id,
            actor_id: req.user.id,
            estado_anterior: null,
            estado_nuevo: 'PENDIENTE_PAGO',
            motivo: `Pedido creado desde el canal ${channel}.`,
            creado_en: now,
          },
        });
        for (const line of lines) {
          const updated = await tx.inventario.updateMany({
            where: {
              id: line.inventory.id,
              disponible: { gte: line.item.cantidad + line.security },
            },
            data: { reservado: { increment: line.item.cantidad }, version: { increment: 1 } },
          });
          if (updated.count !== 1)
            throw new BadRequestException(`Stock insuficiente para ${line.item.variante.sku}.`);
          const detail = await tx.detalle_pedido.create({
            data: {
              pedido_id: order.id,
              variante_id: line.item.variante_id,
              sku_snapshot: line.item.variante.sku,
              descripcion_snapshot: line.item.variante.producto.nombre,
              talla_snapshot: line.item.variante.talla,
              color_snapshot: line.item.variante.color,
              cantidad: line.item.cantidad,
              precio_unitario: line.unit,
              descuento: 0,
              total_linea: Number((line.unit * line.item.cantidad).toFixed(2)),
            },
          });
          await tx.reserva_stock.create({
            data: {
              detalle_pedido_id: detail.id,
              inventario_id: line.inventory.id,
              cantidad: line.item.cantidad,
              estado: 'ACTIVA',
              creada_en: now,
              vence_en: new Date(now.getTime() + 15 * 60_000),
            },
          });
          await tx.movimiento_stock.create({
            data: {
              inventario_id: line.inventory.id,
              grupo_operacion: order.id,
              tipo: 'RESERVA',
              delta_fisico: 0,
              delta_reservado: line.item.cantidad,
              delta_comprometido: 0,
              motivo: `Reserva ${channel === 'APP' ? 'app' : 'web'} ${number}`,
              actor_id: req.user.id,
              pedido_id: order.id,
              creado_en: now,
            },
          });
        }
        await tx.pago.create({
          data: {
            pedido_id: order.id,
            proveedor: simulatedProvider(channel),
            referencia: number,
            idempotencia: randomUUID(),
            monto: total,
            moneda: 'BOB',
            estado: 'PENDIENTE',
            creado_en: now,
          },
        });
        await tx.carrito.update({
          where: { id: cart.id },
          data: { estado: 'CONVERTIDO', actualizado_en: now },
        });
        return tx.pedido.findUniqueOrThrow({
          where: { id: order.id },
          include: { detalle_pedido: { include: { reserva_stock: true } }, pago: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.realtime.inventoryChanged(input.locationId, {
      variantIds: order.detalle_pedido.map((line) => line.variante_id),
      reason: 'RESERVA',
    });
    return order;
  }

  @Post('orders/:id/payment')
  async pay(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    uuid.parse(id);
    const input = paymentDecision.parse(body);
    const channel = requestChannel(req);
    const provider = simulatedProvider(channel);
    await this.releaseExpired();
    const order = await this.db.pedido.findFirst({
      where: { id, usuario_id: req.user.id, canal: channel },
      include: { pago: true },
    });
    if (!order) throw new BadRequestException('Pedido no encontrado.');
    const payment = order.pago[0];
    if (!payment || payment.proveedor !== provider)
      throw new BadRequestException('Pago no disponible.');
    const prior = await this.db.evento_pago.findUnique({
      where: {
        proveedor_evento_externo: { proveedor: provider, evento_externo: input.idempotency },
      },
    });
    if (prior && (prior.pago_id !== payment.id || prior.tipo !== input.decision))
      throw new BadRequestException('Este identificador de pago ya fue utilizado.');
    if (!prior) {
      if (order.estado !== 'PENDIENTE_PAGO')
        throw new BadRequestException('Este pedido ya no admite pagos.');
      if (input.decision === 'APROBAR') {
        if (
          !(await this.closePending(id, 'CONFIRMADO', {
            id: input.idempotency,
            decision: input.decision,
            method: input.method,
            reference: input.reference,
          }))
        )
          throw new BadRequestException('El pedido ya fue procesado.');
      } else {
        if (
          !(await this.closePending(id, 'CANCELADO', {
            id: input.idempotency,
            decision: input.decision,
            method: input.method,
            reference: input.reference,
          }))
        )
          throw new BadRequestException('El pedido ya fue procesado.');
      }
    }
    return this.db.pedido.findUniqueOrThrow({
      where: { id },
      include: { detalle_pedido: true, pago: true },
    });
  }

  @Post('orders/:id/returns')
  async requestReturn(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    uuid.parse(id);
    const input = returnRequest.parse(body);
    const channel = requestChannel(req);
    if (new Set(input.items.map((item) => item.detailId)).size !== input.items.length)
      throw new BadRequestException('Cada prenda debe aparecer una sola vez.');
    return this.db.$transaction(
      async (tx) => {
        const order = await tx.pedido.findFirst({
          where: {
            id,
            usuario_id: req.user.id,
            canal: channel,
            estado: { in: ['CONFIRMADO', 'PREPARANDO', 'DESPACHADO', 'ENTREGADO', 'CERRADO'] },
          },
          include: { detalle_pedido: true },
        });
        if (!order) throw new BadRequestException('El pedido no admite devolución.');
        for (const item of input.items) {
          const detail = order.detalle_pedido.find((row) => row.id === item.detailId);
          if (!detail) throw new BadRequestException('La prenda no pertenece al pedido.');
          const claimed = await tx.detalle_devolucion.aggregate({
            where: {
              detalle_pedido_id: item.detailId,
              devolucion: { estado: { not: 'RECHAZADA' } },
            },
            _sum: { cantidad: true },
          });
          if (item.quantity + (claimed._sum.cantidad ?? 0) > detail.cantidad)
            throw new BadRequestException('La cantidad supera lo comprado o ya solicitado.');
        }
        return tx.devolucion.create({
          data: {
            pedido_id: id,
            usuario_id: req.user.id,
            tipo: 'DEVOLUCION',
            estado: 'SOLICITADA',
            motivo: input.reason,
            solicitada_en: new Date(),
            detalle_devolucion: {
              create: input.items.map((item) => ({
                detalle_pedido_id: item.detailId,
                cantidad: item.quantity,
                cantidad_apta: 0,
              })),
            },
          },
          include: { detalle_devolucion: true },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
