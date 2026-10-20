import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuthGuard, AuthRequest, Identity, requirePermission } from './auth';
import { Db } from './db';
import { assignAssortment } from './assortment';
import { RealtimeGateway } from './realtime';
import { requireCapacity } from './tenancy/capacity';

const locationInput = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    tipo: z.enum(['TIENDA', 'ALMACEN']),
    direccion: z.string().trim().min(5).max(300).optional(),
    padreId: z.string().uuid().optional(),
  })
  .strict();

const staffInput = z
  .object({
    nombres: z.string().trim().min(2).max(100),
    apellidos: z.string().trim().min(2).max(120),
    correo: z.string().trim().toLowerCase().email().max(160),
    clave: z
      .string()
      .min(10)
      .max(72)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
    rol: z.enum(['Vendedor', 'Analista']),
    ubicaciones: z.array(z.string().uuid()).max(50).default([]),
  })
  .strict();

export function can(user: Identity, permission: string) {
  return user.permissions.includes(permission);
}

export async function requireLocationScope(db: Db, user: Identity, locationId: string) {
  if (can(user, 'ubicaciones:gestionar') || user.roles.includes('Administrador')) return;
  const assignment = await db.usuario_ubicacion.findUnique({
    where: { usuario_id_ubicacion_id: { usuario_id: user.id, ubicacion_id: locationId } },
  });
  if (!assignment) throw new ForbiddenException('No tienes acceso a esta ubicación.');
}

async function lockActiveLocations(tx: Prisma.TransactionClient, ids: string[]) {
  const uniqueIds = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<{ id: string; activa: boolean }[]>`
    SELECT id, activa FROM ubicacion WHERE id=ANY(${uniqueIds}::uuid[]) ORDER BY id FOR SHARE`;
  if (rows.length !== uniqueIds.length || rows.some((row) => !row.activa))
    throw new NotFoundException('La ubicación no existe o está inactiva.');
}

@Controller('locations')
@UseGuards(AuthGuard)
export class LocationsController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RealtimeGateway) private realtime: RealtimeGateway,
  ) {}

  @Get()
  async list(@Req() req: AuthRequest) {
    if (!can(req.user, 'inventario:consultar') && !can(req.user, 'ubicaciones:gestionar'))
      throw new ForbiddenException('No tienes permiso para consultar ubicaciones.');
    const where = can(req.user, 'ubicaciones:gestionar')
      ? {}
      : { usuario_ubicacion: { some: { usuario_id: req.user.id } } };
    return this.db.ubicacion.findMany({
      where,
      include: {
        _count: { select: { inventario: true, usuario_ubicacion: true } },
        usuario_ubicacion: {
          include: {
            usuario: { select: { id: true, nombres: true, apellidos: true, correo: true } },
          },
        },
      },
      orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
    });
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    requirePermission(req.user, 'ubicaciones:gestionar');
    const data = locationInput.parse(body);
    return this.db.$transaction(async (tx) => {
      // Serialize hierarchy edits; the row lock also coordinates with stock writers.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('vestidor18:ubicacion:jerarquia', 0))`;
      await requireCapacity(tx, 'locations');
      if (data.padreId) await lockActiveLocations(tx, [data.padreId]);
      const location = await tx.ubicacion.create({
        data: {
          nombre: data.nombre,
          tipo: data.tipo,
          direccion: data.direccion,
          padre_id: data.padreId,
          activa: true,
        },
      });
      const variants = await tx.variante.findMany({
        where: { activa: true, producto: { estado: 'PUBLICADO' } },
        select: { id: true },
      });
      await assignAssortment(
        tx,
        variants.map((variant) => variant.id),
        [location.id],
      );
      return location;
    });
  }

  @Patch(':id')
  async update(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'ubicaciones:gestionar');
    const data = locationInput
      .partial()
      .extend({ padreId: z.string().uuid().nullable().optional(), activa: z.boolean().optional() })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .parse(body);
    if (data.padreId === id)
      throw new BadRequestException('Una ubicación no puede contenerse a sí misma.');
    z.string().uuid().parse(id);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('vestidor18:ubicacion:jerarquia', 0))`;
      await tx.$queryRaw`SELECT id FROM ubicacion WHERE id=${id}::uuid FOR UPDATE`;
      const found = await tx.ubicacion.findUnique({ where: { id } });
      if (!found) throw new NotFoundException('Ubicación no encontrada.');
      if (data.activa === true && !found.activa) await requireCapacity(tx, 'locations');
      const effectiveParentId = data.padreId === undefined ? found.padre_id : data.padreId;
      if (effectiveParentId && (data.padreId !== undefined || data.activa === true)) {
        let parent = await tx.ubicacion.findFirst({
          where: { id: effectiveParentId, activa: true },
          select: { id: true, padre_id: true },
        });
        if (!parent) throw new BadRequestException('La ubicación superior no está activa.');
        while (parent?.padre_id) {
          if (parent.padre_id === id)
            throw new BadRequestException('La jerarquía de ubicaciones no puede formar un ciclo.');
          parent = await tx.ubicacion.findUnique({
            where: { id: parent.padre_id },
            select: { id: true, padre_id: true },
          });
        }
      }
      if (data.activa === false && found.activa) {
        const [stock, children] = await Promise.all([
          tx.inventario.count({
            where: {
              ubicacion_id: id,
              OR: [{ fisico: { gt: 0 } }, { reservado: { gt: 0 } }, { comprometido: { gt: 0 } }],
            },
          }),
          tx.ubicacion.count({ where: { padre_id: id, activa: true } }),
        ]);
        if (stock)
          throw new BadRequestException(
            'Transfiere o ajusta a cero todas las existencias antes de desactivar la ubicación.',
          );
        if (children)
          throw new BadRequestException(
            'Desactiva o reasigna primero las ubicaciones dependientes.',
          );
      }
      const location = await tx.ubicacion.update({
        where: { id },
        data: {
          nombre: data.nombre,
          tipo: data.tipo,
          direccion: data.direccion,
          padre_id: data.padreId,
          activa: data.activa,
        },
      });
      if (data.activa === true && !found.activa) {
        const variants = await tx.variante.findMany({
          where: { activa: true, producto: { estado: 'PUBLICADO' } },
          select: { id: true },
        });
        await assignAssortment(
          tx,
          variants.map((variant) => variant.id),
          [id],
        );
      }
      return location;
    });
  }

  @Get(':id/inventory')
  async inventory(@Req() req: AuthRequest, @Param('id') id: string) {
    requirePermission(req.user, 'inventario:consultar');
    await requireLocationScope(this.db, req.user, id);
    const rows = await this.db.inventario.findMany({
      where: { ubicacion_id: id },
      include: { variante: { include: { producto: { select: { nombre: true } } } } },
      orderBy: { variante: { sku: 'asc' } },
    });
    const policies = await this.db.disponibilidad_canal.findMany({
      where: {
        ubicacion_id: id,
        canal: 'WEB',
        variante_id: { in: rows.map((row) => row.variante_id) },
      },
    });
    return rows.map((row) => {
      const policy = policies.find((item) => item.variante_id === row.variante_id);
      const available = row.disponible ?? row.fisico - row.reservado - row.comprometido;
      return {
        ...row,
        stockSeguridad: policy?.stock_seguridad ?? 0,
        plazoReposicionDias: policy?.plazo_reposicion_dias ?? 0,
        alertaStock: (policy?.stock_seguridad ?? 0) > 0 && available <= policy!.stock_seguridad,
      };
    });
  }

  @Get('inventory/alerts')
  async alerts(@Req() req: AuthRequest) {
    requirePermission(req.user, 'inventario:consultar');
    const assignments = can(req.user, 'ubicaciones:gestionar')
      ? null
      : await this.db.usuario_ubicacion.findMany({
          where: { usuario_id: req.user.id },
          select: { ubicacion_id: true },
        });
    const locationIds = assignments?.map((item) => item.ubicacion_id) ?? null;
    if (locationIds?.length === 0) return [];
    const scope = locationIds ? Prisma.sql`AND u.id = ANY(${locationIds}::uuid[])` : Prisma.empty;
    return this.db.$queryRaw<
      {
        ubicacion_id: string;
        ubicacion: string;
        variante_id: string;
        producto: string;
        sku: string;
        talla: string;
        color: string;
        disponible: number;
        stock_seguridad: number;
      }[]
    >`SELECT u.id AS ubicacion_id,u.nombre AS ubicacion,v.id AS variante_id,p.nombre AS producto,
        v.sku,v.talla,v.color,i.disponible::int,d.stock_seguridad
      FROM inventario i
      JOIN ubicacion u ON u.id=i.ubicacion_id
      JOIN variante v ON v.id=i.variante_id
      JOIN producto p ON p.id=v.producto_id
      JOIN disponibilidad_canal d ON d.ubicacion_id=i.ubicacion_id
        AND d.variante_id=i.variante_id AND d.canal='WEB' AND d.habilitada
      WHERE u.activa AND d.stock_seguridad > 0 AND i.disponible <= d.stock_seguridad ${scope}
      ORDER BY (d.stock_seguridad-i.disponible) DESC,u.nombre,p.nombre,v.sku`;
  }

  @Get(':id/movements')
  async movements(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Query('limit') requestedLimit = '50',
  ) {
    requirePermission(req.user, 'inventario:consultar');
    await requireLocationScope(this.db, req.user, id);
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(requestedLimit);
    const rows = await this.db.movimiento_stock.findMany({
      where: { inventario: { ubicacion_id: id } },
      include: {
        usuario: { select: { id: true, nombres: true, apellidos: true } },
        inventario: {
          include: {
            ubicacion: { select: { id: true, nombre: true, tipo: true } },
            variante: {
              select: {
                id: true,
                sku: true,
                talla: true,
                color: true,
                producto: { select: { nombre: true } },
              },
            },
          },
        },
      },
      orderBy: { creado_en: 'desc' },
      take: limit,
    });
    const transferGroups = [
      ...new Set(
        rows.filter((row) => row.tipo === 'TRANSFERENCIA').map((row) => row.grupo_operacion),
      ),
    ];
    const peers = transferGroups.length
      ? await this.db.movimiento_stock.findMany({
          where: { grupo_operacion: { in: transferGroups } },
          include: { inventario: { include: { ubicacion: true } } },
        })
      : [];
    return rows.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      deltaFisico: row.delta_fisico,
      deltaReservado: row.delta_reservado,
      deltaComprometido: row.delta_comprometido,
      conteoObservado: row.conteo_observado,
      motivo: row.motivo,
      creadoEn: row.creado_en,
      grupoOperacion: row.grupo_operacion,
      actor: row.usuario,
      ubicacion: row.inventario.ubicacion,
      variante: row.inventario.variante,
      contraparte:
        peers.find(
          (peer) =>
            peer.grupo_operacion === row.grupo_operacion &&
            peer.inventario_id !== row.inventario_id,
        )?.inventario.ubicacion ?? null,
    }));
  }

  @Post('transfers')
  async transfer(@Req() req: AuthRequest, @Body() body: unknown) {
    requirePermission(req.user, 'inventario:gestionar');
    const data = z
      .object({
        origenId: z.string().uuid(),
        destinoId: z.string().uuid(),
        varianteId: z.string().uuid(),
        cantidad: z.number().int().min(1).max(100000),
        motivo: z.string().trim().min(5).max(400),
      })
      .strict()
      .refine((value) => value.origenId !== value.destinoId, {
        message: 'El origen y el destino deben ser diferentes.',
      })
      .parse(body);
    await Promise.all([
      requireLocationScope(this.db, req.user, data.origenId),
      requireLocationScope(this.db, req.user, data.destinoId),
    ]);
    const [origin, destination, variant] = await Promise.all([
      this.db.ubicacion.findFirst({ where: { id: data.origenId, activa: true } }),
      this.db.ubicacion.findFirst({ where: { id: data.destinoId, activa: true } }),
      this.db.variante.findFirst({ where: { id: data.varianteId, activa: true } }),
    ]);
    if (!origin || !destination || !variant)
      throw new NotFoundException('Ubicación o variante no encontrada.');
    return this.db.$transaction(
      async (tx) => {
        await lockActiveLocations(tx, [data.origenId, data.destinoId]);
        const source = await tx.inventario.findUnique({
          where: {
            variante_id_ubicacion_id: {
              variante_id: data.varianteId,
              ubicacion_id: data.origenId,
            },
          },
        });
        if (!source) throw new BadRequestException('La ubicación de origen no tiene esa variante.');
        const changed = await tx.$queryRaw<{ id: string }[]>`
          UPDATE inventario
          SET fisico = fisico - ${data.cantidad}, version = version + 1
          WHERE id = ${source.id}::uuid
            AND (fisico - reservado - comprometido) >= ${data.cantidad}
          RETURNING id`;
        if (changed.length !== 1)
          throw new BadRequestException('No hay stock disponible suficiente para transferir.');
        const target = await tx.inventario.upsert({
          where: {
            variante_id_ubicacion_id: {
              variante_id: data.varianteId,
              ubicacion_id: data.destinoId,
            },
          },
          update: { fisico: { increment: data.cantidad }, version: { increment: 1 } },
          create: {
            variante_id: data.varianteId,
            ubicacion_id: data.destinoId,
            fisico: data.cantidad,
            reservado: 0,
            comprometido: 0,
            version: 1,
          },
        });
        const group = randomUUID();
        const createdAt = new Date();
        await tx.movimiento_stock.createMany({
          data: [
            {
              inventario_id: source.id,
              grupo_operacion: group,
              tipo: 'TRANSFERENCIA',
              delta_fisico: -data.cantidad,
              delta_reservado: 0,
              delta_comprometido: 0,
              motivo: data.motivo,
              actor_id: req.user.id,
              creado_en: createdAt,
            },
            {
              inventario_id: target.id,
              grupo_operacion: group,
              tipo: 'TRANSFERENCIA',
              delta_fisico: data.cantidad,
              delta_reservado: 0,
              delta_comprometido: 0,
              motivo: data.motivo,
              actor_id: req.user.id,
              creado_en: createdAt,
            },
          ],
        });
        const [sourceAfter, targetAfter] = await Promise.all([
          tx.inventario.findUniqueOrThrow({ where: { id: source.id } }),
          tx.inventario.findUniqueOrThrow({ where: { id: target.id } }),
        ]);
        return { grupoOperacion: group, origen: sourceAfter, destino: targetAfter };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  @Post(':id/inventory/counts')
  async count(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'inventario:gestionar');
    await requireLocationScope(this.db, req.user, id);
    const data = z
      .object({
        varianteId: z.string().uuid(),
        conteoObservado: z.number().int().min(0).max(1000000),
        expectedVersion: z.number().int().min(0),
        motivo: z.string().trim().min(5).max(400),
      })
      .strict()
      .parse(body);
    const [location, variant] = await Promise.all([
      this.db.ubicacion.findFirst({ where: { id, activa: true } }),
      this.db.variante.findFirst({ where: { id: data.varianteId, activa: true } }),
    ]);
    if (!location || !variant) throw new NotFoundException('Ubicación o variante no encontrada.');
    return this.db.$transaction(
      async (tx) => {
        await lockActiveLocations(tx, [id]);
        let inventory = await tx.inventario.findUnique({
          where: { variante_id_ubicacion_id: { variante_id: data.varianteId, ubicacion_id: id } },
        });
        if ((inventory?.version ?? 0) !== data.expectedVersion)
          throw new ConflictException(
            'El inventario cambió desde la consulta. Revisa el saldo actualizado y confirma nuevamente el conteo.',
          );
        const previousPhysical = inventory?.fisico ?? 0;
        if (!inventory) {
          inventory = await tx.inventario.create({
            data: {
              variante_id: data.varianteId,
              ubicacion_id: id,
              fisico: data.conteoObservado,
              reservado: 0,
              comprometido: 0,
              version: 1,
            },
          });
        } else {
          if (data.conteoObservado < inventory.reservado + inventory.comprometido)
            throw new BadRequestException(
              'El conteo no puede ser menor que las unidades reservadas y comprometidas.',
            );
          const changed = await tx.inventario.updateMany({
            where: { id: inventory.id, version: data.expectedVersion },
            data: { fisico: data.conteoObservado, version: { increment: 1 } },
          });
          if (changed.count !== 1)
            throw new ConflictException(
              'El inventario cambió durante el conteo. Revisa el saldo actualizado antes de confirmar.',
            );
          inventory = await tx.inventario.findUniqueOrThrow({ where: { id: inventory.id } });
        }
        await tx.movimiento_stock.create({
          data: {
            inventario_id: inventory.id,
            grupo_operacion: randomUUID(),
            tipo: 'CONTEO',
            delta_fisico: data.conteoObservado - previousPhysical,
            delta_reservado: 0,
            delta_comprometido: 0,
            conteo_observado: data.conteoObservado,
            motivo: data.motivo,
            actor_id: req.user.id,
            creado_en: new Date(),
          },
        });
        return inventory;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  @Patch(':id/inventory/:variantId/threshold')
  async threshold(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: unknown,
  ) {
    requirePermission(req.user, 'inventario:gestionar');
    await requireLocationScope(this.db, req.user, id);
    const data = z
      .object({
        stockSeguridad: z.number().int().min(0).max(100000),
        plazoReposicionDias: z.number().int().min(0).max(365).default(0),
      })
      .strict()
      .parse(body);
    const [location, inventory] = await Promise.all([
      this.db.ubicacion.findFirst({ where: { id, activa: true } }),
      this.db.inventario.findUnique({
        where: { variante_id_ubicacion_id: { variante_id: variantId, ubicacion_id: id } },
      }),
    ]);
    if (!location || !inventory) throw new NotFoundException('Inventario no encontrado.');
    const policy = await this.db.disponibilidad_canal.upsert({
      where: {
        variante_id_ubicacion_id_canal: {
          variante_id: variantId,
          ubicacion_id: id,
          canal: 'WEB',
        },
      },
      update: {
        stock_seguridad: data.stockSeguridad,
        plazo_reposicion_dias: data.plazoReposicionDias,
      },
      create: {
        variante_id: variantId,
        ubicacion_id: id,
        canal: 'WEB',
        habilitada: true,
        stock_seguridad: data.stockSeguridad,
        plazo_reposicion_dias: data.plazoReposicionDias,
      },
    });
    const available =
      inventory.disponible ?? inventory.fisico - inventory.reservado - inventory.comprometido;
    return { ...policy, disponible: available, alertaStock: available <= policy.stock_seguridad };
  }

  @Post(':id/inventory/adjustments')
  async adjust(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'inventario:gestionar');
    await requireLocationScope(this.db, req.user, id);
    const data = z
      .object({
        varianteId: z.string().uuid(),
        delta: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((value) => value !== 0),
        motivo: z.string().trim().min(5).max(400),
      })
      .strict()
      .parse(body);
    const [location, variant] = await Promise.all([
      this.db.ubicacion.findFirst({ where: { id, activa: true } }),
      this.db.variante.findFirst({ where: { id: data.varianteId, activa: true } }),
    ]);
    if (!location || !variant) throw new NotFoundException('Ubicación o variante no encontrada.');
    const updated = await this.db.$transaction(async (tx) => {
      await lockActiveLocations(tx, [id]);
      let inventory = await tx.inventario.findUnique({
        where: { variante_id_ubicacion_id: { variante_id: data.varianteId, ubicacion_id: id } },
      });
      if (!inventory) {
        if (data.delta < 0)
          throw new BadRequestException('No existe stock para realizar la salida.');
        inventory = await tx.inventario.create({
          data: {
            variante_id: data.varianteId,
            ubicacion_id: id,
            fisico: data.delta,
            reservado: 0,
            comprometido: 0,
            version: 1,
          },
        });
      } else {
        if (data.delta < 0) {
          const changed = await tx.$queryRaw<{ id: string }[]>`
            UPDATE inventario
            SET fisico = fisico + ${data.delta}, version = version + 1
            WHERE id = ${inventory.id}::uuid
              AND (fisico - reservado - comprometido) >= ${-data.delta}
            RETURNING id`;
          if (changed.length !== 1)
            throw new BadRequestException('El ajuste supera el stock disponible.');
        } else {
          await tx.inventario.update({
            where: { id: inventory.id },
            data: { fisico: { increment: data.delta }, version: { increment: 1 } },
          });
        }
        inventory = await tx.inventario.findUniqueOrThrow({ where: { id: inventory.id } });
      }
      await tx.movimiento_stock.create({
        data: {
          inventario_id: inventory.id,
          grupo_operacion: randomUUID(),
          tipo: 'AJUSTE',
          delta_fisico: data.delta,
          delta_reservado: 0,
          delta_comprometido: 0,
          motivo: data.motivo,
          actor_id: req.user.id,
          creado_en: new Date(),
        },
      });
      return inventory;
    });
    this.realtime.inventoryChanged(id, {
      variantIds: [data.varianteId],
      reason: 'stock-adjustment',
    });
    return updated;
  }

  @Post(':id/assignments')
  async assign(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'usuarios:gestionar');
    const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).strict().parse(body);
    const roles = await this.db.usuario_rol.findMany({
      where: { usuario_id: usuarioId },
      include: { rol: true },
    });
    if (!roles.some(({ rol }) => rol.nombre === 'Vendedor' || rol.nombre === 'Analista'))
      throw new BadRequestException('Solo se pueden asignar vendedores o analistas.');
    const location = await this.db.ubicacion.findFirst({ where: { id, activa: true } });
    if (!location) throw new NotFoundException('Ubicación no encontrada.');
    return this.db.usuario_ubicacion.upsert({
      where: { usuario_id_ubicacion_id: { usuario_id: usuarioId, ubicacion_id: id } },
      update: {},
      create: { usuario_id: usuarioId, ubicacion_id: id },
    });
  }

  @Delete(':id/assignments/:userId')
  async unassign(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    requirePermission(req.user, 'usuarios:gestionar');
    await this.db.usuario_ubicacion.deleteMany({ where: { usuario_id: userId, ubicacion_id: id } });
    return { ok: true };
  }
}

@Controller('staff')
@UseGuards(AuthGuard)
export class StaffController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  async list(@Req() req: AuthRequest) {
    requirePermission(req.user, 'usuarios:gestionar');
    return this.db.usuario.findMany({
      where: { usuario_rol: { some: { rol: { nombre: { in: ['Vendedor', 'Analista'] } } } } },
      select: {
        id: true,
        nombres: true,
        apellidos: true,
        correo: true,
        estado: true,
        usuario_rol: { select: { rol: { select: { nombre: true } } } },
        usuario_ubicacion: { select: { ubicacion_id: true } },
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    });
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    requirePermission(req.user, 'usuarios:gestionar');
    const data = staffInput.parse(body);
    const uniqueLocations = [...new Set(data.ubicaciones)];
    const existingLocations = await this.db.ubicacion.count({
      where: { id: { in: uniqueLocations }, activa: true },
    });
    if (existingLocations !== uniqueLocations.length)
      throw new BadRequestException('Una o más ubicaciones no existen o están inactivas.');
    const password = await hash(data.clave, 12);
    return this.db.$transaction(async (tx) => {
      await requireCapacity(tx, 'staff');
      const role = await tx.rol.findUniqueOrThrow({ where: { nombre: data.rol } });
      const user = await tx.usuario.create({
        data: {
          nombres: data.nombres,
          apellidos: data.apellidos,
          correo: data.correo,
          clave_hash: password,
          estado: 'ACTIVO',
          preferencias: { push: false },
          creado_en: new Date(),
        },
      });
      await tx.usuario_rol.create({
        data: { usuario_id: user.id, rol_id: role.id, asignado_en: new Date() },
      });
      if (uniqueLocations.length)
        await tx.usuario_ubicacion.createMany({
          data: uniqueLocations.map((ubicacion_id) => ({ usuario_id: user.id, ubicacion_id })),
        });
      return {
        id: user.id,
        nombres: user.nombres,
        apellidos: user.apellidos,
        correo: user.correo,
        rol: data.rol,
      };
    });
  }
}
