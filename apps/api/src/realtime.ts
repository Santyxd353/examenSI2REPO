import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService, Identity } from './auth';
import { Db } from './db';
import { TenantRegistry } from './tenancy/platform';
import { currentTenantSlug, runForTenant, TenantContext } from './tenancy/context';

type AuthenticatedSocket = Socket & {
  data: { user?: Identity; tenant?: TenantContext; token?: string };
};

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: false },
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(
    @Inject(AuthService) private auth: AuthService,
    @Inject(Db) private db: Db,
    @Inject(TenantRegistry) private registry: TenantRegistry,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        typeof client.handshake.auth?.token === 'string'
          ? client.handshake.auth.token
          : client.handshake.headers.authorization?.replace(/^Bearer /, '');
      const slug = client.handshake.auth?.tenant || 'lumina';
      if (typeof slug !== 'string') throw new Error();
      const tenant = await this.registry.resolve(slug);
      client.data.user = await runForTenant(tenant, () => this.auth.verify(token));
      client.data.tenant = tenant;
      client.data.token = token;
      client.emit('realtime:ready', { connectedAt: new Date().toISOString() });
    } catch {
      client.emit('realtime:error', { message: 'Inicia sesión para recibir actualizaciones.' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('inventory:subscribe')
  async subscribe(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: { locationId?: unknown },
  ) {
    if (!client.data.user || !client.data.tenant)
      return { ok: false, message: 'Sesión no disponible.' };
    if (typeof body?.locationId !== 'string')
      return { ok: false, message: 'Selecciona una ubicación válida.' };
    const locationId = body.locationId;
    try {
      const tenant = await this.registry.resolve(client.data.tenant.slug);
      return await runForTenant(tenant, async () => {
        await this.auth.verify(client.data.token);
        const location = await this.db.ubicacion.findFirst({
          where: { id: locationId, activa: true },
          select: { id: true },
        });
        if (!location) return { ok: false, message: 'La ubicación no está disponible.' };
        for (const room of client.rooms)
          if (room.startsWith('inventory:')) await client.leave(room);
        await client.join(`inventory:${tenant.slug}:${location.id}`);
        return { ok: true, locationId: location.id };
      });
    } catch {
      return { ok: false, message: 'La sesión o la tienda ya no están disponibles.' };
    }
  }

  inventoryChanged(locationId: string, data: { variantIds: string[]; reason: string }) {
    this.server?.to(`inventory:${currentTenantSlug()}:${locationId}`).emit('inventory:updated', {
      locationId,
      variantIds: data.variantIds,
      reason: data.reason,
      occurredAt: new Date().toISOString(),
    });
  }
}
