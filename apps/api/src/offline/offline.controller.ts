import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { BootstrapRequestSchema, BootstrapResponseSchema, UuidSchema } from '@lumina/contracts';
import { AuthGuard, AuthRequest } from '../auth';
import { Db } from '../db';
import { currentTenant } from '../tenancy/context';
import { EntitlementsService } from '../billing/entitlements.service';
import { DeviceKeysService } from './device-keys.service';
import { SyncService } from './sync.service';
import { findReceipt } from './receipts.repository';
@Controller('offline')
@UseGuards(AuthGuard)
export class OfflineController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(DeviceKeysService) private keys: DeviceKeysService,
    @Inject(EntitlementsService) private entitlements: EntitlementsService,
    @Inject(SyncService) private syncService: SyncService,
  ) {}
  @Post('bootstrap') async bootstrap(
    @Req() request: AuthRequest,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const { deviceId } = BootstrapRequestSchema.parse(raw),
      actor = request.user,
      tenant = currentTenant()!;
    const locations = await this.db.ubicacion.findMany({
      where: {
        activa: true,
        ...(actor.roles.includes('Administrador') ||
        actor.permissions.includes('ubicaciones:gestionar')
          ? {}
          : { usuario_ubicacion: { some: { usuario_id: actor.id } } }),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return BootstrapResponseSchema.parse({
      schemaVersion: '1.0',
      tenantId: tenant.id,
      actorId: actor.id,
      deviceId,
      ...(await this.keys.recover(actor.id, deviceId)),
      permissions: actor.permissions,
      locationIds: locations.map((l) => l.id),
      entitlements: await this.entitlements.forTenant(tenant.id),
      issuedAt: new Date().toISOString(),
    });
  }
  @Post('sync') async sync(
    @Req() request: AuthRequest,
    @Body() raw: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.syncService.applyBatch(request, raw);
  }
  @Get('operations/:id') async operation(
    @Req() request: AuthRequest,
    @Param('id') rawId: string,
    @Query('deviceId') rawDevice: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    const id = UuidSchema.parse(rawId),
      deviceId = UuidSchema.parse(rawDevice);
    const row = await this.db.$transaction((tx) => findReceipt(tx, request.user, deviceId, id));
    if (!row) throw new NotFoundException('Comprobante no disponible.');
    return row;
  }
}
