import { Controller, HttpCode, Inject, Post, RawBodyRequest, Req } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';
import { StripeAdapter } from './stripe.adapter';
import { SubscriptionService } from './subscription.service';
@Controller('billing/stripe')
export class BillingWebhookController {
  constructor(
    @Inject(StripeAdapter) private readonly stripe: StripeAdapter,
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
  ) {}
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() request: RawBodyRequest<Request>) {
    const header = request.headers['stripe-signature'];
    const event = this.stripe.verify(
      request.rawBody,
      typeof header === 'string' ? header : undefined,
    );
    return this.subscriptions.applyBillingEvent(
      event,
      createHash('sha256').update(request.rawBody!).digest('hex'),
    );
  }
}
