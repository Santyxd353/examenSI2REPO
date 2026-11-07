import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class StripeAdapter {
  private client() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key?.startsWith('sk_test_'))
      throw new ServiceUnavailableException({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Configura una clave Stripe TEST. Los cobros LIVE están deshabilitados.',
      });
    return new Stripe(key, { timeout: 15000, maxNetworkRetries: 1 });
  }
  assertConfigured() {
    this.client();
  }
  async createCheckout(input: {
    intentId: string;
    tenantId: string;
    slug: string;
    planName: string;
    amountMinor: number;
    expiresAt: string;
  }) {
    const origin = new URL(process.env.WEB_ORIGIN || 'http://localhost:5173');
    if (!['http:', 'https:'].includes(origin.protocol))
      throw new ServiceUnavailableException('WEB_ORIGIN inválido.');
    const success = new URL(origin.origin),
      cancel = new URL(origin.origin);
    for (const target of [success, cancel]) {
      target.searchParams.set('tienda', input.slug);
      target.searchParams.set('seccion', 'business');
    }
    success.searchParams.set('checkout', input.intentId);
    cancel.searchParams.set('checkout', input.intentId);
    const session = await this.client().checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: input.intentId,
        metadata: { intentId: input.intentId, tenantId: input.tenantId },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'bob',
              unit_amount: input.amountMinor,
              product_data: { name: `Lúmina · ${input.planName} · un mes (TEST)` },
            },
          },
        ],
        allowed_payment_method_types: ['card'],
        success_url: success.toString(),
        cancel_url: cancel.toString(),
        expires_at: Math.floor(Date.parse(input.expiresAt) / 1000),
      },
      { idempotencyKey: `lumina-billing-${input.intentId}` },
    );
    if (session.livemode || !session.url)
      throw new BadRequestException('Sesión de pago TEST inválida.');
    return { id: session.id, url: session.url, livemode: session.livemode };
  }
  verify(raw: Buffer | undefined, signature: string | undefined): Stripe.Event {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret?.startsWith('whsec_'))
      throw new ServiceUnavailableException({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Configura el webhook Stripe TEST.',
      });
    if (!raw || !signature)
      throw new BadRequestException('Falta firma o cuerpo original de Stripe.');
    try {
      const event = this.client().webhooks.constructEvent(raw, signature, secret);
      if (event.livemode !== false) throw new Error('LIVE no admitido');
      return event;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadRequestException('Firma inválida o evento fuera del entorno TEST.');
    }
  }
}
