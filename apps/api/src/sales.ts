import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuthGuard, AuthRequest, requirePermission } from './auth';
import { Db } from './db';
import { can, requireLocationScope } from './locations';
import { RealtimeGateway } from './realtime';
import { lockOperation, requestHash, assertRequestHash } from './commerce/idempotency';

const discountedUnitPrice = (price: { importe: Prisma.Decimal; descuento_pct: Prisma.Decimal }) =>
  price.importe
    .mul(new Prisma.Decimal(100).minus(price.descuento_pct))
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
    .toNumber();

const saleSchema = z
  .object({
    locationId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    customerName: z.string().trim().min(2).max(160).optional(),
    paymentMethod: z.enum(['EFECTIVO', 'TARJETA', 'QR']),
    idempotency: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    items: z
      .array(
        z
          .object({
            variantId: z
              .string()
              .uuid()
              .transform((value) => value.toLowerCase()),
            quantity: z.number().int().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((item) => item.variantId)).size === value.items.length,
    'Cada variante debe aparecer una sola vez.',
  );

@Controller('sales')
@UseGuards(AuthGuard)
export class SalesController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RealtimeGateway) private realtime: RealtimeGateway,
  ) {}

  private async locationIds(req: AuthRequest) {
    if (can(req.user, 'ubicaciones:gestionar') || req.user.roles.includes('Administrador'))
      return null;
    return (
      await this.db.usuario_ubicacion.findMany({
        where: { usuario_id: req.user.id },
        select: { ubicacion_id: true },
      })
    ).map((assignment) => assignment.ubicacion_id);
  }

  @Get('context')
  async context(@Req() req: AuthRequest) {
    requirePermission(req.user, 'ventas:registrar');
    const scope = await this.locationIds(req);
    const now = new Date();
    const locations = await this.db.ubicacion.findMany({
      where: { activa: true, ...(scope ? { id: { in: scope } } : {}) },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
      include: {
        inventario: {
          where: { disponible: { gt: 0 } },
          include: {
            variante: {
              include: {
                producto: true,
                precio_canal: {
                  where: {
                    canal: 'TIENDA',
                    desde: { lte: now },
                    OR: [{ hasta: null }, { hasta: { gt: now } }],
                  },
                  orderBy: { desde: 'desc' },
                },
                disponibilidad_canal: {
                  where: { canal: 'TIENDA', habilitada: true },
                },
              },
            },
          },
        },
      },
    });
    return locations.map((location) => ({
      id: location.id,
      nombre: location.nombre,
      tipo: location.tipo,
      variants: location.inventario.flatMap((inventory) => {
        const price = inventory.variante.precio_canal[0];
        if (
          !price ||
          !inventory.variante.activa ||
          inventory.variante.producto.estado !== 'PUBLICADO' ||
          !inventory.variante.disponibilidad_canal.some(
            (policy) => policy.ubicacion_id === location.id,
          )
        )
          return [];
        return [
          {
            id: inventory.variante.id,
            product: inventory.variante.producto.nombre,
            sku: inventory.variante.sku,
            size: inventory.variante.talla,
            color: inventory.variante.color,
            available: inventory.disponible ?? 0,
            price: discountedUnitPrice(price),
          },
        ];
      }),
    }));
  }

  @Get()
  async recent(@Req() req: AuthRequest, @Query('location') location?: string) {
    requirePermission(req.user, 'ventas:registrar');
    const locationId =
      location &&
      z
        .string()
        .uuid()
        .transform((value) => value.toLowerCase())
        .parse(location);
    if (locationId) await requireLocationScope(this.db, req.user, locationId);
    const scope = await this.locationIds(req);
    return this.db.pedido.findMany({
      where: {
        vendedor_id: req.user.roles.includes('Administrador') ? undefined : req.user.id,
        ...(locationId
          ? { ubicacion_id: locationId }
          : scope
            ? { ubicacion_id: { in: scope } }
            : {}),
        reglas_snapshot: { path: ['tipo'], equals: 'VENTA_MOSTRADOR' },
      },
      orderBy: { creado_en: 'desc' },
      take: 20,
      include: { ubicacion: true, detalle_pedido: true, pago: true },
    });
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    requirePermission(req.user, 'ventas:registrar');
    const input = saleSchema.parse(body);
    await requireLocationScope(this.db, req.user, input.locationId);
    input.items.sort((a, b) => a.variantId.localeCompare(b.variantId));
    const hash = requestHash({ actorId: req.user.id, ...input });
    const now = new Date();
    const number = `VTA-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID().slice(0, 8)}`;
    const sale = await this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'order-intent', input.idempotency);
      const previous = await tx.pedido.findUnique({
        where: { idempotencia: input.idempotency },
        include: { ubicacion: true, detalle_pedido: true, pago: true },
      });
      if (previous) {
        if (previous.vendedor_id !== req.user.id || previous.canal !== 'TIENDA')
          throw new BadRequestException('El identificador de venta ya fue utilizado.');
        const stored = previous.reglas_snapshot as { requestHash?: string; metodoPago?: string };
        if (stored.requestHash) assertRequestHash(stored.requestHash, hash);
        else
          assertRequestHash(
            requestHash({
              locationId: previous.ubicacion_id,
              paymentMethod: stored.metodoPago,
              items: previous.detalle_pedido
                .map((line) => ({ variantId: line.variante_id, quantity: line.cantidad }))
                .sort((a, b) => a.variantId.localeCompare(b.variantId)),
            }),
            requestHash({
              locationId: input.locationId,
              paymentMethod: input.paymentMethod,
              items: input.items,
            }),
          );
        return previous;
      }

      const location = await tx.ubicacion.findFirst({
        where: { id: input.locationId, activa: true },
      });
      if (!location) throw new BadRequestException('La sucursal o almacén no está activo.');
      const inventories = await tx.inventario.findMany({
        where: {
          ubicacion_id: input.locationId,
          variante_id: { in: input.items.map((item) => item.variantId) },
        },
        include: {
          variante: {
            include: {
              producto: true,
              precio_canal: {
                where: {
                  canal: 'TIENDA',
                  desde: { lte: now },
                  OR: [{ hasta: null }, { hasta: { gt: now } }],
                },
                orderBy: { desde: 'desc' },
              },
              disponibilidad_canal: {
                where: { canal: 'TIENDA', ubicacion_id: input.locationId, habilitada: true },
              },
            },
          },
        },
      });
      const lines = input.items.map((item) => {
        const inventory = inventories.find((row) => row.variante_id === item.variantId);
        if (!inventory)
          throw new BadRequestException('Una prenda no pertenece al inventario seleccionado.');
        if (!inventory.variante.activa || inventory.variante.producto.estado !== 'PUBLICADO')
          throw new BadRequestException(
            `La prenda ${inventory.variante.sku} ya no está publicada.`,
          );
        if (!inventory.variante.disponibilidad_canal.length)
          throw new BadRequestException(
            `La prenda ${inventory.variante.sku} no está habilitada para venta en esta ubicación.`,
          );
        const price = inventory.variante.precio_canal[0];
        if (!price)
          throw new BadRequestException(
            `No hay precio TIENDA vigente para ${inventory.variante.sku}.`,
          );
        const unit = discountedUnitPrice(price);
        return { item, inventory, unit, total: Number((unit * item.quantity).toFixed(2)) };
      });
      const total = Number(lines.reduce((sum, line) => sum + line.total, 0).toFixed(2));
      const order = await tx.pedido.create({
        data: {
          usuario_id: req.user.id,
          vendedor_id: req.user.id,
          ubicacion_id: input.locationId,
          numero: number,
          canal: 'TIENDA',
          moneda: 'BOB',
          subtotal: total,
          descuento: 0,
          impuesto: 0,
          entrega: 0,
          total,
          direccion_snapshot: { cliente: input.customerName ?? 'Cliente de mostrador' },
          reglas_snapshot: {
            tipo: 'VENTA_MOSTRADOR',
            metodoPago: input.paymentMethod,
            requestHash: hash,
          },
          estado: 'CONFIRMADO',
          creado_en: now,
          idempotencia: input.idempotency,
        },
      });
      await tx.historial_pedido.create({
        data: {
          pedido_id: order.id,
          actor_id: req.user.id,
          estado_anterior: null,
          estado_nuevo: 'CONFIRMADO',
          motivo: 'Venta de mostrador confirmada al registrarse.',
          creado_en: now,
        },
      });
      for (const line of lines) {
        const changed = await tx.inventario.updateMany({
          where: {
            id: line.inventory.id,
            fisico: { gte: line.item.quantity },
            disponible: { gte: line.item.quantity },
          },
          data: { fisico: { decrement: line.item.quantity }, version: { increment: 1 } },
        });
        if (changed.count !== 1)
          throw new BadRequestException(
            `Stock insuficiente para ${line.inventory.variante.sku}. Actualiza la venta.`,
          );
        const detail = await tx.detalle_pedido.create({
          data: {
            pedido_id: order.id,
            variante_id: line.item.variantId,
            sku_snapshot: line.inventory.variante.sku,
            descripcion_snapshot: line.inventory.variante.producto.nombre,
            talla_snapshot: line.inventory.variante.talla,
            color_snapshot: line.inventory.variante.color,
            cantidad: line.item.quantity,
            precio_unitario: line.unit,
            descuento: 0,
            total_linea: line.total,
          },
        });
        await tx.movimiento_stock.create({
          data: {
            inventario_id: line.inventory.id,
            grupo_operacion: order.id,
            tipo: 'SALIDA',
            delta_fisico: -line.item.quantity,
            delta_reservado: 0,
            delta_comprometido: 0,
            motivo: `Venta ${number} · detalle ${detail.id}`,
            actor_id: req.user.id,
            pedido_id: order.id,
            creado_en: now,
          },
        });
      }
      await tx.pago.create({
        data: {
          pedido_id: order.id,
          proveedor: `POS_${input.paymentMethod}`,
          referencia: `${number}-${input.paymentMethod}`,
          idempotencia: randomUUID(),
          monto: total,
          moneda: 'BOB',
          estado: 'CONFIRMADO',
          creado_en: now,
          confirmado_en: now,
        },
      });
      return tx.pedido.findUniqueOrThrow({
        where: { id: order.id },
        include: { ubicacion: true, detalle_pedido: true, pago: true },
      });
    });
    this.realtime.inventoryChanged(input.locationId, {
      variantIds: input.items.map((item) => item.variantId),
      reason: 'VENTA',
    });
    return sale;
  }
}
