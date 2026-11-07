import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, AuthRequest, requirePermission } from '../auth';
import { SubscriptionService } from './subscription.service';
@Controller('tenant/subscription')
@UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(@Inject(SubscriptionService) private readonly service: SubscriptionService) {}
  private token(request: AuthRequest) {
    requirePermission(request.user, 'suscripcion:gestionar');
    return request.headers.authorization!.replace(/^Bearer /, '');
  }
  @Post('checkout') checkout(@Req() r: AuthRequest, @Body() b: unknown) {
    return this.service.createCheckout(this.token(r), b);
  }
  @Get('checkouts') recent(@Req() r: AuthRequest) {
    this.token(r);
    return this.service.recentCheckouts();
  }
  @Get('checkouts/:id') get(@Req() r: AuthRequest, @Param('id') id: string) {
    this.token(r);
    return this.service.getCheckout(id);
  }
  @Post('qr/:id/confirm') confirm(
    @Req() r: AuthRequest,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.confirmQr(this.token(r), id, b);
  }
  @Post('cancel-renewal') cancel(@Req() r: AuthRequest, @Body() b: unknown) {
    return this.service.cancelRenewal(this.token(r), b);
  }
}
