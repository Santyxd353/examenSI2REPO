import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuthGuard, AuthRequest, AuthService } from './auth';
import { Db } from './db';
import { lockOperation } from './commerce/idempotency';
import { OutfitPreferencesSchema } from '@lumina/contracts';

const uuid = z.string().uuid();
const phone = z
  .string()
  .trim()
  .min(7)
  .max(30)
  .regex(/^[+0-9()\-\s]+$/, 'El teléfono contiene caracteres no válidos.');
const profileUpdate = z
  .object({
    nombres: z.string().trim().min(2).max(100).optional(),
    apellidos: z.string().trim().min(2).max(120).optional(),
    telefono: phone.nullable().optional(),
    push: z.boolean().optional(),
    preferences: OutfitPreferencesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios para guardar.');
const addressFields = z.object({
  alias: z.string().trim().min(2).max(50),
  destinatario: z.string().trim().min(3).max(160),
  telefono: phone,
  ciudad: z.string().trim().min(2).max(100),
  zona: z.string().trim().min(2).max(100),
  detalle: z.string().trim().min(5).max(400),
  predeterminada: z.boolean().optional().default(false),
});
const addressCreate = addressFields.strict();
const addressUpdate = addressFields
  .extend({ predeterminada: z.boolean().optional() })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios para guardar.');

@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AuthService) private auth: AuthService,
  ) {}

  private async response(userId: string) {
    const user = await this.db.usuario.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        nombres: true,
        apellidos: true,
        correo: true,
        telefono: true,
        preferencias: true,
        direccion: {
          where: { activa: true },
          orderBy: [{ predeterminada: 'desc' }, { alias: 'asc' }],
        },
      },
    });
    return { ...user, identity: await this.auth.identity(userId) };
  }

  private audit(
    tx: Prisma.TransactionClient,
    actorId: string,
    action: string,
    entity: string,
    entityId: string,
    changes: Prisma.InputJsonValue,
  ) {
    return tx.auditoria.create({
      data: {
        actor_id: actorId,
        accion: action,
        entidad: entity,
        entidad_id: entityId,
        cambios: changes,
        correlacion: randomUUID(),
        creado_en: new Date(),
      },
    });
  }

  @Get()
  profile(@Req() req: AuthRequest) {
    return this.response(req.user.id);
  }

  @Patch()
  async updateProfile(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = profileUpdate.parse(body);
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM usuario WHERE id=${req.user.id}::uuid FOR UPDATE`;
      const current = await tx.usuario.findUniqueOrThrow({ where: { id: req.user.id } });
      const preferences = {
        ...((current.preferencias as Record<string, unknown>) || {}),
        ...(input.push === undefined ? {} : { push: input.push }),
        ...(input.preferences === undefined ? {} : { vestidor: input.preferences }),
      };
      await tx.usuario.update({
        where: { id: req.user.id },
        data: {
          ...(input.nombres === undefined ? {} : { nombres: input.nombres }),
          ...(input.apellidos === undefined ? {} : { apellidos: input.apellidos }),
          ...(input.telefono === undefined ? {} : { telefono: input.telefono || null }),
          preferencias: preferences,
        },
      });
      await this.audit(tx, req.user.id, 'ACTUALIZAR_PERFIL', 'usuario', req.user.id, {
        nombres: input.nombres,
        apellidos: input.apellidos,
        telefono: input.telefono,
        push: input.push,
        preferenciasVestidorActualizadas: input.preferences !== undefined,
      });
    });
    return this.response(req.user.id);
  }

  @Post('addresses')
  async createAddress(@Req() req: AuthRequest, @Body() body: unknown) {
    const input = addressCreate.parse(body);
    await this.db.$transaction(
      async (tx) => {
        await lockOperation(tx, 'addresses', req.user.id);
        const count = await tx.direccion.count({
          where: { usuario_id: req.user.id, activa: true },
        });
        const makeDefault = input.predeterminada || count === 0;
        if (makeDefault)
          await tx.direccion.updateMany({
            where: { usuario_id: req.user.id, activa: true, predeterminada: true },
            data: { predeterminada: false },
          });
        const address = await tx.direccion.create({
          data: {
            usuario_id: req.user.id,
            alias: input.alias,
            destinatario: input.destinatario,
            telefono: input.telefono,
            ciudad: input.ciudad,
            zona: input.zona,
            detalle: input.detalle,
            predeterminada: makeDefault,
            activa: true,
          },
        });
        await this.audit(tx, req.user.id, 'CREAR_DIRECCION', 'direccion', address.id, {
          alias: address.alias,
          predeterminada: address.predeterminada,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.response(req.user.id);
  }

  @Patch('addresses/:id')
  async updateAddress(@Req() req: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    const id = uuid.parse(rawId);
    const input = addressUpdate.parse(body);
    await this.db.$transaction(
      async (tx) => {
        await lockOperation(tx, 'addresses', req.user.id);
        const current = await tx.direccion.findFirst({
          where: { id, usuario_id: req.user.id, activa: true },
        });
        if (!current) throw new NotFoundException('Dirección no encontrada.');
        if (input.predeterminada)
          await tx.direccion.updateMany({
            where: { usuario_id: req.user.id, activa: true, predeterminada: true, id: { not: id } },
            data: { predeterminada: false },
          });
        if (input.predeterminada === false && current.predeterminada)
          throw new BadRequestException(
            'Selecciona otra dirección predeterminada antes de quitar esta opción.',
          );
        await tx.direccion.update({ where: { id }, data: input });
        await this.audit(tx, req.user.id, 'ACTUALIZAR_DIRECCION', 'direccion', id, {
          campos: Object.keys(input),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.response(req.user.id);
  }

  @Post('addresses/:id/default')
  async makeDefault(@Req() req: AuthRequest, @Param('id') rawId: string) {
    const id = uuid.parse(rawId);
    await this.db.$transaction(
      async (tx) => {
        await lockOperation(tx, 'addresses', req.user.id);
        const address = await tx.direccion.findFirst({
          where: { id, usuario_id: req.user.id, activa: true },
        });
        if (!address) throw new NotFoundException('Dirección no encontrada.');
        await tx.direccion.updateMany({
          where: { usuario_id: req.user.id, activa: true, predeterminada: true },
          data: { predeterminada: false },
        });
        await tx.direccion.update({ where: { id }, data: { predeterminada: true } });
        await this.audit(tx, req.user.id, 'DIRECCION_PREDETERMINADA', 'direccion', id, {
          predeterminada: true,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.response(req.user.id);
  }

  @Delete('addresses/:id')
  async deleteAddress(@Req() req: AuthRequest, @Param('id') rawId: string) {
    const id = uuid.parse(rawId);
    await this.db.$transaction(
      async (tx) => {
        await lockOperation(tx, 'addresses', req.user.id);
        const address = await tx.direccion.findFirst({
          where: { id, usuario_id: req.user.id, activa: true },
        });
        if (!address) throw new NotFoundException('Dirección no encontrada.');
        await tx.direccion.update({
          where: { id },
          data: { activa: false, predeterminada: false },
        });
        if (address.predeterminada) {
          const replacement = await tx.direccion.findFirst({
            where: { usuario_id: req.user.id, activa: true, id: { not: id } },
            orderBy: { alias: 'asc' },
          });
          if (replacement)
            await tx.direccion.update({
              where: { id: replacement.id },
              data: { predeterminada: true },
            });
        }
        await this.audit(tx, req.user.id, 'ELIMINAR_DIRECCION', 'direccion', id, {
          activa: false,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.response(req.user.id);
  }
}
