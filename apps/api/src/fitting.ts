import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  Inject,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { Db } from './db';
import { AuthGuard, AuthRequest } from './auth';
import { storedPath } from './storage';
const modelAccess: Prisma.modelo_prendaWhereInput = {
  estado: 'PUBLICADO',
  OR: [
    { clave_glb: { not: { startsWith: 'private/offline/resources/' } } },
    {
      variante: { activa: true, producto: { estado: 'PUBLICADO', categoria: { activa: true } } },
      plantilla_corporal: { activa: true },
    },
  ],
};
@Controller('fitting')
@UseGuards(AuthGuard)
export class FittingController {
  constructor(@Inject(Db) private db: Db) {}
  @Post() async open(@Req() r: AuthRequest, @Body() body: unknown) {
    const b = z
      .object({ avatarId: z.string().uuid(), canal: z.enum(['WEB', 'APP']).default('WEB') })
      .strict()
      .parse(body);
    const a = await this.db.avatar.findFirst({
      where: { id: b.avatarId, usuario_id: r.user.id, estado: 'APROBADO' },
    });
    if (!a) throw new NotFoundException('Aprueba un avatar antes de entrar al vestidor.');
    return this.db.sesion_vestidor.create({
      data: { usuario_id: r.user.id, avatar_id: a.id, canal: b.canal, iniciada_en: new Date() },
    });
  }
  @Post(':id/try') async tryOn(
    @Req() r: AuthRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const b = z
      .object({ modeloId: z.string().uuid(), eventoId: z.string().uuid() })
      .strict()
      .parse(body);
    const s = await this.db.sesion_vestidor.findFirst({
      where: { id: z.string().uuid().parse(id), usuario_id: r.user.id, finalizada_en: null },
    });
    if (!s?.avatar_id) throw new NotFoundException('Vestidor no disponible.');
    const a = await this.db.avatar.findFirst({
      where: { id: s.avatar_id, estado: 'APROBADO', usuario_id: r.user.id },
    });
    const m = await this.db.modelo_prenda.findFirst({
      where: { id: b.modeloId, ...modelAccess },
    });
    if (!a || !m || m.plantilla_id !== a.plantilla_id)
      throw new BadRequestException('La prenda no es compatible con este avatar.');
    await this.db.evento_vestidor.createMany({
      data: [
        {
          sesion_id: s.id,
          variante_id: m.variante_id,
          modelo_id: m.id,
          evento_cliente: b.eventoId,
          tipo: 'PRUEBA',
          ocurrido_en: new Date(),
        },
      ],
      skipDuplicates: true,
    });
    const event = await this.db.evento_vestidor.findUniqueOrThrow({
      where: { evento_cliente: b.eventoId },
    });
    if (event.sesion_id !== s.id || event.modelo_id !== m.id || event.tipo !== 'PRUEBA')
      throw new BadRequestException('El identificador de evento ya pertenece a otra operación.');
    return { modeloId: m.id };
  }
  @Get('models/:id') async garment(
    @Req() r: AuthRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const m = await this.db.modelo_prenda.findFirst({
      where: { id: z.string().uuid().parse(id), ...modelAccess },
    });
    if (!m) throw new NotFoundException('Prenda 3D no disponible.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('model/gltf-binary').sendFile(storedPath(m.clave_glb), { dotfiles: 'allow' });
  }
}
