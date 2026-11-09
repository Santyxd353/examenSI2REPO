import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import Stripe from 'stripe';

type Plan = { code: string; monthlyAmount: number; currency: string };
type Row = {
  tenant_id: string;
  pending_checkout: string | null;
  stripe_subscription_id: string | null;
  provider: string;
  current_period_end: Date | null;
  cancel_at_end: boolean;
};

function stripeTest() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_'))
    throw new ServiceUnavailableException('Configura Stripe TEST en el servidor.');
  return new Stripe(key, { timeout: 10000, maxNetworkRetries: 1 });
}

export class PlanBilling {
  constructor(
    private pool: Pool,
    private gateway = stripeTest,
  ) {}

  private async locked<T>(tenant: string, action: (db: PoolClient, row: Row) => Promise<T>) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const { rows } = await db.query<Row>(
        'SELECT * FROM platform.subscription WHERE tenant_id=$1 FOR UPDATE',
        [tenant],
      );
      if (!rows[0]) throw new BadRequestException('No se encontró la suscripción.');
      const result = await action(db, rows[0]);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async start(tenant: string, plan: Plan, operation: string) {
    return this.locked(tenant, async (db, row) => {
      const stripe = this.gateway();
      if (row.pending_checkout) {
        const pending = await stripe.checkout.sessions.retrieve(row.pending_checkout);
        if (pending.status === 'open' && pending.metadata?.plan === plan.code)
          return { url: pending.url };
        if (pending.status === 'open') await stripe.checkout.sessions.expire(pending.id);
        if (pending.status === 'complete')
          throw new ConflictException('Actualiza la información para aplicar el pago anterior.');
      }
      const returnUrl = new URL(
        '/api/tenant/subscription/return',
        process.env.SUBSCRIPTION_API_ORIGIN || 'http://localhost:3018',
      );
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          locale: 'es',
          allowed_payment_method_types: ['card'],
          metadata: { tenant, plan: plan.code },
          client_reference_id: tenant,
          success_url: returnUrl.href,
          cancel_url: returnUrl.href,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: plan.currency.toLowerCase(),
                unit_amount: Math.round(plan.monthlyAmount * 100),
                recurring: { interval: 'month' },
                product_data: { name: 'Lúmina · ' + plan.code },
              },
            },
          ],
        },
        { idempotencyKey: 'plan-' + tenant + '-' + operation },
      );
      if (!session.url || session.livemode)
        throw new BadRequestException('Checkout TEST no está disponible.');
      await db.query('UPDATE platform.subscription SET pending_checkout=$2 WHERE tenant_id=$1', [
        tenant,
        session.id,
      ]);
      return { url: session.url };
    });
  }

  async refresh(tenant: string) {
    return this.locked(tenant, async (db, row) => {
      if (!row.pending_checkout && !row.stripe_subscription_id) return false;
      const stripe = this.gateway();
      if (row.pending_checkout) {
        const session = await stripe.checkout.sessions.retrieve(row.pending_checkout, {
          expand: ['subscription'],
        });
        if (
          session.livemode ||
          session.mode !== 'subscription' ||
          session.client_reference_id !== tenant ||
          session.metadata?.tenant !== tenant
        )
          throw new ConflictException('Checkout no corresponde a la tienda.');
        if (session.status === 'expired')
          await db.query(
            'UPDATE platform.subscription SET pending_checkout=NULL WHERE tenant_id=$1',
            [tenant],
          );
        const sub = session.subscription;
        if (
          session.status === 'complete' &&
          session.payment_status === 'paid' &&
          sub &&
          typeof sub !== 'string'
        ) {
          if (row.stripe_subscription_id && row.stripe_subscription_id !== sub.id) {
            const old = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
            if (old.status !== 'canceled')
              await stripe.subscriptions.cancel(old.id, { prorate: false });
          }
          await db.query(
            `UPDATE platform.subscription SET plan_code=$2, provider='STRIPE', status='ACTIVE',
            current_period_end=to_timestamp($3),cancel_at_end=$4,stripe_subscription_id=$5,
            pending_checkout=NULL,trial_ends_at=NULL,version=version+1,updated_at=now() WHERE tenant_id=$1`,
            [
              tenant,
              session.metadata.plan,
              sub.items.data[0].current_period_end,
              sub.cancel_at_period_end,
              sub.id,
            ],
          );
          await db.query(
            `INSERT INTO platform.billing_event(tenant_id,provider,external_id,event_type,status)
            VALUES($1,'STRIPE',$2,'TEST_PLAN_CONFIRMED','APPLIED') ON CONFLICT(provider,external_id) DO NOTHING`,
            [tenant, session.id],
          );
          return false;
        }
        if (session.status !== 'expired') return true;
      }
      if (row.stripe_subscription_id) {
        const sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
        const status =
          sub.status === 'active' ? 'ACTIVE' : sub.status === 'canceled' ? 'CANCELED' : 'PAST_DUE';
        await db.query(
          `UPDATE platform.subscription SET status=$2,current_period_end=to_timestamp($3),
          cancel_at_end=$4 WHERE tenant_id=$1`,
          [tenant, status, sub.items.data[0].current_period_end, sub.cancel_at_period_end],
        );
      }
      return false;
    });
  }

  async cancel(tenant: string) {
    return this.locked(tenant, async (db, row) => {
      if (row.pending_checkout)
        throw new ConflictException('Finaliza o descarta primero el Checkout pendiente.');
      if (!row.current_period_end || row.provider === 'NONE')
        throw new BadRequestException('No hay un ciclo contratado.');
      if (row.cancel_at_end) return;
      if (row.stripe_subscription_id)
        await this.gateway().subscriptions.update(row.stripe_subscription_id, {
          cancel_at_period_end: true,
        });
      await db.query('UPDATE platform.subscription SET cancel_at_end=true WHERE tenant_id=$1', [
        tenant,
      ]);
    });
  }

  async discard(tenant: string) {
    await this.locked(tenant, async (db, row) => {
      if (!row.pending_checkout) return;
      const stripe = this.gateway();
      const session = await stripe.checkout.sessions.retrieve(row.pending_checkout);
      if (session.status === 'complete')
        throw new ConflictException('Actualiza la información para verificar el pago.');
      if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
      await db.query('UPDATE platform.subscription SET pending_checkout=NULL WHERE tenant_id=$1', [
        tenant,
      ]);
    });
  }
}
