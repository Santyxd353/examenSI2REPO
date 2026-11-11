import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import Stripe from 'stripe';
import QRCode from 'qrcode';
import { PLAN_CATALOG, type PlanCode } from '@lumina/contracts';
import { TenantRegistry, validTenantSlug } from './platform';
import { provisionTenant } from './provision';
import { StripeAdapter } from '../billing/stripe.adapter';
import { calendarMonthAfter, calendarYearAfter } from '../billing/periods';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const capability = z.string().regex(/^[a-f0-9]{64}$/);
export const PublicSignupSchema = z.strictObject({
  operationId: z.uuid(),
  companyName: z.string().trim().min(2).max(120),
  slug: z.string().refine(validTenantSlug),
  ownerEmail: z.string().trim().toLowerCase().email().max(160),
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(120),
  password: z
    .string()
    .min(10)
    .max(72)
    .refine((v) => Buffer.byteLength(v, 'utf8') <= 72),
  planCode: z.enum(['demo', 'esencial', 'pro']),
  billingInterval: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
  provider: z.enum(['STRIPE_TEST', 'QR_SIMULATED']),
  acceptTerms: z.literal(true),
});
type Signup = {
  id: string;
  capability_hash: string;
  request_hash: string;
  slug: string;
  company_name: string;
  owner_email: string;
  first_name: string;
  last_name: string;
  password_hash: string | null;
  plan_code: PlanCode;
  amount_minor: number;
  billing_interval: 'MONTHLY' | 'YEARLY' | 'DEMO';
  provider: 'STRIPE_TEST' | 'QR_SIMULATED' | 'NONE';
  state: string;
  session_id: string | null;
  checkout_url: string | null;
  expires_at: Date;
};
@Injectable()
export class PublicSignupService {
  constructor(
    @Inject(TenantRegistry) private readonly registry: TenantRegistry,
    @Inject(StripeAdapter) private readonly stripe: StripeAdapter,
  ) {}
  private async row(id: string, token?: string): Promise<Signup> {
    const row = (
      await this.registry.pool.query<Signup>('SELECT * FROM platform.signup WHERE id=$1', [
        z.uuid().parse(id),
      ])
    ).rows[0];
    // An unknown id and a wrong capability deliberately have the same response.
    if (!row || (token !== undefined && row.capability_hash !== digest(capability.parse(token))))
      throw new NotFoundException(
        'No se encontró el registro. Ábrelo desde el navegador donde lo iniciaste.',
      );
    return row;
  }
  async view(id: string, token: string) {
    const row = await this.row(id, capability.parse(token));
    const state =
      row.state === 'PENDING' && row.expires_at.getTime() <= Date.now() ? 'EXPIRED' : row.state;
    return {
      id: row.id,
      state,
      companyName: row.company_name,
      slug: row.slug,
      planCode: row.billing_interval === 'DEMO' ? 'demo' : row.plan_code,
      billingInterval: row.billing_interval,
      amountMinor: row.amount_minor,
      currency: 'USD',
      provider: row.provider,
      expiresAt: row.expires_at.toISOString(),
      checkoutUrl: state === 'PENDING' ? row.checkout_url : null,
      webPath: state === 'ACTIVE' ? `/?tienda=${row.slug}` : null,
    };
  }
  async create(raw: unknown, token: string) {
    capability.parse(token);
    const input = PublicSignupSchema.parse(raw);
    if (input.slug === 'lumina')
      throw new ConflictException('Ese identificador ya está utilizado.');
    if (input.planCode !== 'demo' && input.provider === 'STRIPE_TEST')
      this.stripe.assertConfigured();
    // Bind retries to the full request without retaining the plaintext password.
    const requestHash = digest(JSON.stringify({ ...input, password: digest(input.password) }));
    const passwordHash = await hash(input.password, 12);
    const connection = await this.registry.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(2026111101)');
      const previous = (
        await connection.query<Signup>('SELECT * FROM platform.signup WHERE id=$1', [
          input.operationId,
        ])
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash || previous.capability_hash !== digest(token))
          throw new ConflictException('Este registro ya corresponde a otra solicitud.');
      } else {
        await connection.query(
          "UPDATE platform.signup SET state='EXPIRED',password_hash=NULL WHERE state='PENDING' AND expires_at<now()",
        );
        const occupied = await connection.query('SELECT 1 FROM platform.tenant WHERE slug=$1', [
          input.slug,
        ]);
        if (occupied.rowCount) throw new ConflictException('Ese identificador ya está utilizado.');
        // Bound public provisioning/storage work even when requests use different IPs.
        const daily = await connection.query(
          "SELECT count(*)::int AS count FROM platform.signup WHERE created_at>now()-interval '1 day'",
        );
        if (daily.rows[0].count >= 30)
          throw new ServiceUnavailableException(
            'Se alcanzó el límite diario de altas. Contacta con el operador.',
          );
        const planCode = input.planCode === 'demo' ? 'pro' : input.planCode;
        const amount =
          input.planCode === 'demo'
            ? 0
            : input.billingInterval === 'YEARLY'
              ? PLAN_CATALOG[planCode].yearlyPriceMinor!
              : PLAN_CATALOG[planCode].priceMinor;
        await connection.query(
          `INSERT INTO platform.signup
          (id,capability_hash,request_hash,slug,company_name,owner_email,first_name,last_name,password_hash,plan_code,amount_minor,billing_interval,provider,state,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now()+interval '1 hour')`,
          [
            input.operationId,
            digest(token),
            requestHash,
            input.slug,
            input.companyName,
            input.ownerEmail,
            input.firstName,
            input.lastName,
            passwordHash,
            planCode,
            amount,
            input.planCode === 'demo' ? 'DEMO' : input.billingInterval,
            input.planCode === 'demo' ? 'NONE' : input.provider,
            input.planCode === 'demo' ? 'PAID' : 'PENDING',
          ],
        );
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException(
          'El identificador está reservado o este correo ya utilizó su Demo gratuita.',
        );
      throw error;
    } finally {
      connection.release();
    }
    return this.complete(input.operationId, token, false);
  }
  async complete(id: string, token: string, confirmQr: boolean) {
    let row = await this.row(id, capability.parse(token));
    if (row.state === 'PENDING') {
      if (row.expires_at.getTime() <= Date.now())
        throw new ConflictException('El registro venció. Inicia otro desde Planes.');
      if (row.provider === 'QR_SIMULATED' && confirmQr) {
        await this.registry.pool.query(
          "UPDATE platform.signup SET state='PAID',paid_at=now() WHERE id=$1 AND state='PENDING'",
          [id],
        );
      } else if (row.provider === 'STRIPE_TEST') {
        if (!row.session_id) {
          let session: { id: string; url: string };
          try {
            session = await this.stripe.createSignupCheckout({
              id: row.id,
              companyName: row.company_name,
              email: row.owner_email,
              planName: PLAN_CATALOG[row.plan_code].name,
              amountMinor: row.amount_minor,
              billingInterval: row.billing_interval as 'MONTHLY' | 'YEARLY',
              expiresAt: row.expires_at,
            });
          } catch {
            throw new ServiceUnavailableException(
              'Stripe no pudo preparar el pago. Reintenta para recuperar este mismo registro.',
            );
          }
          if (
            new URL(session.url).origin !== 'https://checkout.stripe.com' ||
            !session.id.startsWith('cs_test_')
          )
            throw new BadRequestException('El checkout no pertenece a Stripe TEST.');
          await this.registry.pool.query(
            'UPDATE platform.signup SET session_id=$2,checkout_url=$3 WHERE id=$1 AND session_id IS NULL',
            [id, session.id, session.url],
          );
        } else {
          const session = await this.stripe.retrieveCheckout(row.session_id);
          if (session.payment_status === 'paid') await this.acceptStripe(row, session);
        }
      }
    }
    row = await this.row(id);
    if (['PAID', 'PROVISIONING'].includes(row.state)) await this.provision(row);
    return this.view(id, token);
  }
  private async acceptStripe(row: Signup, session: Stripe.Checkout.Session) {
    if (
      row.provider !== 'STRIPE_TEST' ||
      session.livemode !== false ||
      session.mode !== 'payment' ||
      session.status !== 'complete' ||
      session.payment_status !== 'paid' ||
      session.currency !== 'usd' ||
      session.amount_total !== row.amount_minor ||
      session.client_reference_id !== row.id ||
      session.metadata?.signupId !== row.id ||
      session.metadata?.purpose !== 'TENANT_SIGNUP' ||
      session.id !== row.session_id ||
      !session.id.startsWith('cs_test_')
    )
      throw new BadRequestException('El pago TEST no coincide con este registro.');
    await this.registry.pool.query(
      "UPDATE platform.signup SET state='PAID',paid_at=COALESCE(paid_at,now()) WHERE id=$1 AND state IN ('PENDING','EXPIRED')",
      [row.id],
    );
  }
  async webhook(event: Stripe.Event) {
    if (
      !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
        event.type,
      )
    )
      return { status: 'IGNORED' };
    if (event.livemode !== false) throw new BadRequestException('Solo se admite Stripe TEST.');
    const session = event.data.object as Stripe.Checkout.Session;
    const row = await this.row(session.metadata?.signupId || '');
    if (session.payment_status !== 'paid') return { status: 'PENDING' };
    await this.acceptStripe(row, session);
    await this.provision(await this.row(row.id));
    return { status: (await this.row(row.id)).state };
  }
  private async provision(row: Signup) {
    const connection = await this.registry.pool.connect();
    let locked = false;
    try {
      // One native/database provision at a time. No transaction is kept open during migrations.
      locked = (await connection.query('SELECT pg_try_advisory_lock(2026111102) AS locked')).rows[0]
        .locked;
      if (!locked)
        throw new ServiceUnavailableException(
          'Estamos preparando otra tienda. Pulsa Comprobar estado en unos segundos.',
        );
      row = await this.row(row.id);
      if (!['PAID', 'PROVISIONING'].includes(row.state)) return;
      await connection.query("UPDATE platform.signup SET state='PROVISIONING' WHERE id=$1", [
        row.id,
      ]);
      const existing = (
        await connection.query('SELECT * FROM platform.tenant WHERE id=$1', [row.id])
      ).rows[0];
      if (existing && !['TRIAL', 'ACTIVE'].includes(existing.state))
        throw new Error('Provision requires operator review.');
      if (!existing) {
        if (!row.password_hash) throw new Error('Missing owner credential.');
        await provisionTenant(
          {
            slug: row.slug,
            name: row.company_name,
            ownerEmail: row.owner_email,
            ownerPassword: 'ServerOnlyPlaceholder!',
            planCode: row.plan_code,
          },
          this.registry,
          {
            tenantId: row.id,
            passwordHash: row.password_hash,
            firstName: row.first_name,
            lastName: row.last_name,
          },
        );
      }
      const now = new Date();
      const demo = row.billing_interval === 'DEMO';
      const end = demo
        ? new Date(now.getTime() + 10 * 86400000)
        : row.billing_interval === 'YEARLY'
          ? calendarYearAfter(now)
          : calendarMonthAfter(now);
      await connection.query('BEGIN');
      const provider = row.provider === 'STRIPE_TEST' ? 'STRIPE' : row.provider;
      await connection.query(
        `UPDATE platform.subscription SET status=$2,provider=$3,trial_ends_at=$4,
        current_period_start=$5,current_period_end=$6,version=version+1,updated_at=now() WHERE tenant_id=$1`,
        [
          row.id,
          demo ? 'TRIALING' : 'ACTIVE',
          provider,
          demo ? end : null,
          demo ? null : now,
          demo ? null : end,
        ],
      );
      await connection.query('UPDATE platform.tenant SET state=$2 WHERE id=$1', [
        row.id,
        demo ? 'TRIAL' : 'ACTIVE',
      ]);
      await connection.query(
        `INSERT INTO platform.billing_event(tenant_id,provider,external_id,event_type,status,firma_verificada,procesado_en,contexto)
        VALUES($1,$2,$3,'PUBLIC_SIGNUP','APPLIED',$4,now(),$5) ON CONFLICT(provider,external_id) DO NOTHING`,
        [
          row.id,
          provider,
          `signup:${row.id}`,
          provider === 'STRIPE',
          {
            amountMinor: row.amount_minor,
            currency: 'USD',
            billingInterval: row.billing_interval,
            sessionId: row.session_id,
            paidThrough: end.toISOString(),
          },
        ],
      );
      await connection.query(
        "UPDATE platform.signup SET state='ACTIVE',tenant_id=$1,password_hash=NULL,activated_at=now() WHERE id=$1",
        [row.id],
      );
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK').catch(() => {});
      if (locked)
        await connection.query(
          "UPDATE platform.signup SET state='REVIEW' WHERE id=$1 AND state='PROVISIONING'",
          [row.id],
        );
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'El pago quedó registrado. La preparación necesita revisión del operador; no vuelvas a pagar.',
      );
    } finally {
      if (locked) await connection.query('SELECT pg_advisory_unlock(2026111102)');
      connection.release();
    }
  }
}
@Controller('public/signup')
export class PublicSignupController {
  constructor(@Inject(PublicSignupService) private readonly service: PublicSignupService) {}
  @Post() create(@Body() body: unknown, @Headers('x-signup-token') token = '') {
    return this.service.create(body, token);
  }
  @Get(':id') view(@Param('id') id: string, @Headers('x-signup-token') token = '') {
    return this.service.view(id, token);
  }
  @Post(':id/complete') complete(
    @Param('id') id: string,
    @Headers('x-signup-token') token = '',
    @Body() raw: unknown,
  ) {
    const input = z.strictObject({ simulatedPayment: z.boolean().default(false) }).parse(raw);
    return this.service.complete(id, token, input.simulatedPayment);
  }
  @Post(':id/qr') async qr(@Param('id') id: string, @Headers('x-signup-token') token = '') {
    const view = await this.service.view(id, token);
    if (view.provider !== 'QR_SIMULATED' || view.state !== 'PENDING')
      throw new BadRequestException('El QR no está pendiente.');
    const url = new URL(process.env.WEB_ORIGIN || 'http://localhost:5173');
    url.pathname = '/';
    url.search = '';
    url.searchParams.set('registro', '1');
    url.searchParams.set('alta', id);
    url.hash = `pago=${capability.parse(token)}`;
    return {
      simulated: true,
      amountMinor: view.amountMinor,
      currency: 'USD',
      qrDataUrl: await QRCode.toDataURL(url.toString(), { width: 280, margin: 4 }),
      paymentUrl: url.toString(),
    };
  }
}
