import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import Stripe from 'stripe';

// Only a single, definitive HTTP rejection proves a NEW checkout was not created.
// Network retries (even those implicit in the SDK) leave the outcome uncertain.
export class SignupCheckoutRejected extends ServiceUnavailableException {
  constructor() {
    super('Stripe rechazó la preparación del pago. Puedes continuar con QR o reintentar Stripe.');
  }
}

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
  async createSignupCheckout(input: {
    id: string;
    companyName: string;
    email: string;
    planName: string;
    amountMinor: number;
    expiresAt: Date;
    paymentAttempt: number;
    billingInterval: 'MONTHLY' | 'YEARLY';
  }) {
    const target = new URL(process.env.WEB_ORIGIN || 'http://localhost:5173');
    target.pathname = '/';
    target.search = '';
    target.hash = '';
    target.searchParams.set('registro', '1');
    target.searchParams.set('alta', input.id);
    const client = this.client();
    let requests = 0;
    const countRequest = () => {
      requests++;
    };
    client.on('request', countRequest);
    let session: Stripe.Checkout.Session;
    try {
      session = await client.checkout.sessions.create(
        {
          mode: 'payment',
          client_reference_id: input.id,
          customer_email: input.email,
          metadata: { signupId: input.id, purpose: 'TENANT_SIGNUP' },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: input.amountMinor,
                product_data: {
                  name: `Lúmina · ${input.planName} · ${input.billingInterval === 'YEARLY' ? 'un año' : 'un mes'} (TEST)`,
                  description: input.companyName,
                },
              },
            },
          ],
          allowed_payment_method_types: ['card'],
          success_url: target.toString(),
          cancel_url: target.toString(),
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        },
        {
          idempotencyKey: `lumina-signup-${input.id}${input.paymentAttempt ? `-payment-${input.paymentAttempt}` : ''}`,
        },
      );
    } catch (error) {
      if (
        requests === 1 &&
        (error instanceof Stripe.errors.StripeAuthenticationError ||
          error instanceof Stripe.errors.StripePermissionError ||
          error instanceof Stripe.errors.StripeInvalidRequestError)
      )
        throw new SignupCheckoutRejected();
      throw error;
    } finally {
      client.off('request', countRequest);
    }
    if (session.livemode || !session.url) throw new BadRequestException('Sesión TEST inválida.');
    return { id: session.id, url: session.url };
  }
  retrieveCheckout(id: string) {
    return this.client().checkout.sessions.retrieve(id);
  }
  expireCheckout(id: string) {
    return this.client().checkout.sessions.expire(id);
  }
  async createCheckout(input: {
    intentId: string;
    tenantId: string;
    slug: string;
    planName: string;
    amountMinor: number;
    expiresAt: string;
    currency?: 'BOB' | 'USD';
    billingInterval?: 'MONTHLY' | 'YEARLY';
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
              currency: (input.currency || 'BOB').toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: {
                name: `Lúmina · ${input.planName} · ${input.billingInterval === 'YEARLY' ? 'un año' : 'un mes'} (TEST)`,
              },
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
