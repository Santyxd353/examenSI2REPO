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
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuthGuard, AuthRequest, requirePermission } from './auth';
import { Db } from './db';
import { RealtimeGateway } from './realtime';

import {
  StaffCreateSchema,
  StaffUpdateSchema,
  LocationCreateSchema,
  LocationUpdateSchema,
} from '@lumina/contracts';
import {
  staffRoles,
  staffSelect,
  staffDto,
  locationDto,
  locationInclude,
  createStaff,
  updateStaff,
  createLocation,
  updateLocation,
  changeAssignment,
  passwordHash,
} from './administration';

export { can, requireLocationScope } from './inventory/scope';
import { can, requireLocationScope } from './inventory/scope';
import { applyStockDelta, applyStockCount } from './inventory/inventory.service';
import { onlineTransfer } from './inventory/online-transfer';
import { OnlineTransferSchema } from '@lumina/contracts';

// Preserve the existing online 400 response while offline domain consumers receive 409.
function legacyStockError(error: unknown): never {
  if (
    error instanceof ConflictException &&
    (error.getResponse() as { code?: string }).code === 'INSUFFICIENT_STOCK'
  )
    throw new BadRequestException(error.getResponse());
  throw error;
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
    return (
      await this.db.ubicacion.findMany({
        where,
        include: locationInclude,
        orderBy: [{ activa: 'desc' }, { nombre: 'asc' }],
      })
    ).map(locationDto);
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    requirePermission(req.user, 'ubicaciones:gestionar');
    const data = LocationCreateSchema.parse(body);
    return this.db.$transaction((tx) => createLocation(tx, req.user, data));
  }

  @Patch(':id')
  async update(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'ubicaciones:gestionar');
    z.string().uuid().parse(id);
    const data = LocationUpdateSchema.parse(body);
    return this.db
      .$transaction((tx) => updateLocation(tx, req.user, id, data))
      .catch((error) => {
        if (
          data.expectedVersion === undefined &&
          error instanceof ConflictException &&
          (error.getResponse() as { code?: string }).code === 'LOCATION_DEPENDENCIES'
        )
          throw new BadRequestException(error.getResponse());
        throw error;
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
    const data = OnlineTransferSchema.parse(body);
    const result = await this.db
      .$transaction((tx) => onlineTransfer(tx, req.user, data))
      .catch(legacyStockError);
    for (const locationId of [data.origenId, data.destinoId])
      this.realtime.inventoryChanged(locationId, {
        variantIds: [data.varianteId],
        reason: 'TRANSFERENCIA',
      });
    return result;
  }

  @Post(':id/inventory/counts')
  async count(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    const data = z
      .object({
        varianteId: z.string().uuid(),
        conteoObservado: z.number().int().min(0).max(1000000),
        expectedVersion: z.number().int().min(0),
        motivo: z.string().trim().min(5).max(400),
      })
      .strict()
      .parse(body);
    const result = await this.db
      .$transaction((tx) =>
        applyStockCount(
          tx,
          { actor: req.user, operationId: randomUUID() },
          {
            variantId: data.varianteId,
            locationId: id,
            observedPhysical: data.conteoObservado,
            baseVersion: data.expectedVersion,
            reason: data.motivo,
          },
        ),
      )
      .catch(legacyStockError);
    this.realtime.inventoryChanged(id, { variantIds: [data.varianteId], reason: 'CONTEO' });
    return result;
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
    const result = await this.db
      .$transaction((tx) =>
        applyStockDelta(
          tx,
          { actor: req.user, operationId: randomUUID() },
          {
            variantId: data.varianteId,
            locationId: id,
            deltaFisico: data.delta,
            reason: data.motivo,
          },
        ),
      )
      .catch(legacyStockError);
    this.realtime.inventoryChanged(id, {
      variantIds: [data.varianteId],
      reason: 'stock-adjustment',
    });
    return result;
  }

  @Post(':id/assignments')
  async assign(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'usuarios:gestionar');
    z.string().uuid().parse(id);
    const { usuarioId } = z.object({ usuarioId: z.string().uuid() }).strict().parse(body);
    return this.db.$transaction((tx) => changeAssignment(tx, req.user, id, usuarioId, true));
  }

  @Delete(':id/assignments/:userId')
  async unassign(
    @Req() req: AuthRequest,
    @Param('id') id: string,
    @Param('userId') userId: string,
  ) {
    requirePermission(req.user, 'usuarios:gestionar');
    z.string().uuid().parse(id);
    z.string().uuid().parse(userId);
    return this.db.$transaction((tx) => changeAssignment(tx, req.user, id, userId, false));
  }
}

@Controller('staff')
@UseGuards(AuthGuard)
export class StaffController {
  constructor(@Inject(Db) private db: Db) {}

  @Get()
  async list(@Req() req: AuthRequest) {
    requirePermission(req.user, 'usuarios:gestionar');
    return (
      await this.db.usuario.findMany({
        where: { usuario_rol: { some: { rol: { nombre: { in: staffRoles } } } } },
        select: staffSelect,
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
      })
    ).map(staffDto);
  }

  @Get('roles')
  async roles(@Req() req: AuthRequest) {
    requirePermission(req.user, 'usuarios:gestionar');
    const roles = await this.db.rol.findMany({
      where: { nombre: { in: staffRoles } },
      include: { rol_permiso: { include: { permiso: true } } },
      orderBy: { nombre: 'asc' },
    });
    return roles.map((r) => ({
      schemaVersion: '1.0',
      nombre: r.nombre,
      permisos: r.rol_permiso.map((p) => `${p.permiso.recurso}:${p.permiso.accion}`).sort(),
    }));
  }

  @Post()
  async create(@Req() req: AuthRequest, @Body() body: unknown) {
    requirePermission(req.user, 'usuarios:gestionar');
    const data = StaffCreateSchema.parse(body);
    const password = (await passwordHash(data.clave))!;
    return this.db.$transaction((tx) => createStaff(tx, req.user, data, password));
  }

  @Patch(':id')
  async update(@Req() req: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(req.user, 'usuarios:gestionar');
    z.string().uuid().parse(id);
    const data = StaffUpdateSchema.parse(body);
    const password = await passwordHash(data.clave);
    return this.db.$transaction((tx) => updateStaff(tx, req.user, id, data, password));
  }
}
