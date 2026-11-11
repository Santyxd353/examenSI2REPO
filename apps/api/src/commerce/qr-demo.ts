import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AuthGuard, AuthRequest, requirePermission } from '../auth';
import { Db } from '../db';
import { requireLocationScope } from '../locations';
import { RealtimeGateway } from '../realtime';
import { currentTenant } from '../tenancy/context';
import { closePendingOrder } from './pending-payment';
import { requestHash } from './idempotency';

const tokenSchema = z.string().min(40).max(2000);
const claimsSchema = z.object({
  purpose: z.literal('ORDER_QR_DEMO'),
  tenantId: z.string().uuid(),
  orderId: z.string().uuid(),
});
const providers = new Set(['SIMULADO_WEB', 'SIMULADO_APP', 'POS_QR']);
const paidStates = new Set(['CONFIRMADO', 'PREPARANDO', 'DESPACHADO', 'ENTREGADO', 'CERRADO']);

@Injectable()
export class QrDemoService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RealtimeGateway) private realtime: RealtimeGateway,
  ) {}

  async createLink(orderId: string, actorId: string, channels: string[]) {
    const tenant = currentTenant();
    if (!tenant) throw new BadRequestException('Selecciona una tienda.');
    const order = await this.db.pedido.findFirst({
      where: {
        id: z.string().uuid().parse(orderId),
        usuario_id: actorId,
        canal: { in: channels },
        estado: 'PENDIENTE_PAGO',
      },
      include: { pago: true, detalle_pedido: { include: { reserva_stock: true } } },
    });
    if (!order || !providers.has(order.pago[0]?.proveedor))
      throw new BadRequestException('Este pedido no admite pago por QR de prueba.');
    const reservations = order.detalle_pedido
      .flatMap((line) => line.reserva_stock)
      .filter((row) => row.estado === 'ACTIVA');
    if (reservations.length !== order.detalle_pedido.length || !reservations.length)
      throw new BadRequestException('El pedido ya no tiene una reserva válida.');
    const expires = Math.min(...reservations.map((row) => row.vence_en.getTime()));
    if (expires <= Date.now()) throw new BadRequestException('El QR venció. Crea un pedido nuevo.');
    const token = jwt.sign(
      {
        purpose: 'ORDER_QR_DEMO',
        tenantId: tenant.id,
        orderId: order.id,
        exp: Math.floor(expires / 1000),
      },
      process.env.JWT_SECRET!,
      { algorithm: 'HS256', issuer: 'lumina-qr-demo', audience: 'lumina-qr-demo' },
    );
    const url = new URL(process.env.WEB_ORIGIN || 'http://localhost:5173');
    url.pathname = '/';
    url.search = '';
    url.searchParams.set('tienda', tenant.slug);
    url.searchParams.set('pago_qr', '1');
    url.hash = new URLSearchParams({ token }).toString();
    return { url: url.toString(), expiresAt: new Date(expires).toISOString() };
  }

  private async order(raw: unknown) {
    let claims: z.infer<typeof claimsSchema>;
    try {
      claims = claimsSchema.parse(
        jwt.verify(tokenSchema.parse(raw), process.env.JWT_SECRET!, {
          algorithms: ['HS256'],
          issuer: 'lumina-qr-demo',
          audience: 'lumina-qr-demo',
        }),
      );
      if (claims.tenantId !== currentTenant()?.id) throw new Error();
    } catch {
      throw new UnauthorizedException(
        'El enlace de pago no es válido o ha vencido. Abre un QR nuevo desde la tienda.',
      );
    }
    const order = await this.db.pedido.findUnique({
      where: { id: claims.orderId },
      include: { pago: true, detalle_pedido: { include: { reserva_stock: true } } },
    });
    if (!order || !providers.has(order.pago[0]?.proveedor))
      throw new BadRequestException(
        'El pedido ya no admite este QR. Revisa el método de pago en la tienda.',
      );
    return order;
  }

  private view(order: Awaited<ReturnType<QrDemoService['order']>>) {
    const reservations = order.detalle_pedido
      .flatMap((line) => line.reserva_stock)
      .filter((row) => row.estado === 'ACTIVA');
    const expires = reservations.length
      ? Math.min(...reservations.map((row) => row.vence_en.getTime()))
      : null;
    const paid =
      paidStates.has(order.estado) && order.pago.some((row) => row.estado === 'CONFIRMADO');
    return {
      orderNumber: order.numero,
      amount: order.total.toFixed(2),
      currency: order.moneda,
      storeName: currentTenant()?.name,
      state: order.estado,
      paid,
      expiresAt: expires ? new Date(expires).toISOString() : null,
      canPay:
        !paid &&
        order.estado === 'PENDIENTE_PAGO' &&
        reservations.length === order.detalle_pedido.length &&
        !!expires &&
        expires > Date.now(),
      simulated: true,
    };
  }

  async status(raw: unknown) {
    return this.view(await this.order(raw));
  }

  async confirm(raw: unknown) {
    const order = await this.order(raw),
      view = this.view(order);
    if (view.paid) return view;
    if (!view.canPay)
      throw new BadRequestException(
        'El pedido está cancelado o la reserva venció. No se realizó ningún cobro.',
      );
    const reference = ('SCAN-' + order.numero).toUpperCase().slice(0, 32);
    await closePendingOrder(
      order.id,
      'CONFIRMADO',
      {
        id: order.id,
        decision: 'APROBAR',
        method: 'QR_PRUEBA',
        reference,
        expectedProvider: order.pago[0].proveedor,
        requestHash: requestHash({
          orderId: order.id,
          decision: 'APROBAR',
          method: 'QR_PRUEBA',
          reference,
        }),
      },
      this.db,
      this.realtime,
    );
    return this.status(raw);
  }
}

@Controller()
@UseGuards(AuthGuard)
export class QrLinkController {
  constructor(
    @Inject(QrDemoService) private qr: QrDemoService,
    @Inject(Db) private db: Db,
  ) {}
  @Post('commerce/orders/:id/qr-link')
  commerce(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.qr.createLink(id, req.user.id, [
      String(req.headers['x-client-channel']).toUpperCase() === 'APP' ? 'APP' : 'WEB',
    ]);
  }
  @Post('sales/:id/qr-link')
  async sale(@Req() req: AuthRequest, @Param('id') id: string) {
    requirePermission(req.user, 'ventas:registrar');
    const order = await this.db.pedido.findUnique({ where: { id: z.string().uuid().parse(id) } });
    if (!order?.ubicacion_id) throw new BadRequestException('Venta no encontrada.');
    await requireLocationScope(this.db, req.user, order.ubicacion_id);
    return this.qr.createLink(id, req.user.id, ['TIENDA']);
  }
}

@Controller('payments/qr-demo')
export class QrDemoController {
  constructor(@Inject(QrDemoService) private qr: QrDemoService) {}
  @Get()
  status(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.qr.status(req.headers['x-qr-token']);
  }
  @Post('confirm')
  confirm(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.qr.confirm(z.object({ token: tokenSchema }).strict().parse(body).token);
  }
}
