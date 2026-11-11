import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import Stripe from 'stripe';
import { z } from 'zod';
import {
  PLAN_CATALOG,
  SubscriptionCheckoutSchema,
  UuidSchema,
  type PlanCode,
} from '@lumina/contracts';
import { AuthService, requirePermission } from '../auth';
import { currentTenant, runForTenant, TenantContext } from '../tenancy/context';
import { TenantRegistry } from '../tenancy/platform';
import { Db } from '../db';
import { billingAnchorDay, calendarMonthAfter, calendarYearAfter } from './periods';
import { subscriptionLockKey } from './locks';
import { StripeAdapter } from './stripe.adapter';
import { simulatedQr } from './qr-simulation';

type BillingResult = {
  periodFrom: string;
  paidThrough: string;
  subscriptionVersion: number;
  confirmedAt: string;
};
type IntentContext = {
  actorId: string;
  confirmedBy?: string;
  operationId: string;
  planCode: PlanCode;
  amountMinor: number;
  currency: 'BOB' | 'USD';
  billingInterval?: 'MONTHLY' | 'YEARLY';
  expectedVersion: number;
  cycleAction: 'ACTIVATE' | 'RENEW' | 'CHANGE';
  createdAt: string;
  expiresAt: string;
  anchorDay: number;
  sessionId?: string;
  checkoutUrl?: string;
  result?: BillingResult;
};
type BillingRow = {
  id: string;
  tenant_id: string;
  provider: string;
  external_id: string;
  event_type: string;
  status: string;
  payload_hash: string;
  contexto: IntentContext;
  error_codigo: string | null;
};
type SubscriptionRow = {
  plan_code: string;
  version: number;
  status: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const operation = z.strictObject({ operationId: UuidSchema });
const uuid = (id: string) => z.uuid().parse(id);

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(TenantRegistry) private readonly registry: TenantRegistry,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(Db) private readonly db: Db,
    @Inject(StripeAdapter) private readonly stripe: StripeAdapter,
  ) {}

  private async control<T>(
    tenant: TenantContext,
    token: string | undefined,
    work: (connection: PoolClient, fresh: TenantContext) => Promise<T>,
  ): Promise<T> {
    const connection = await this.registry.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query("SET LOCAL lock_timeout='8s'");
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        subscriptionLockKey(tenant.id),
      ]);
      const fresh = await this.registry.resolve(tenant.slug, true, connection);
      if (fresh.id !== tenant.id) throw new ForbiddenException('El negocio cambió.');
      const result = await runForTenant(fresh, async () => {
        if (token !== undefined)
          requirePermission(await this.auth.verify(token), 'suscripcion:gestionar');
        return work(connection, fresh);
      });
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  private async fits(planCode: PlanCode) {
    const plan = PLAN_CATALOG[planCode];
    const values = await Promise.all([
      this.db.ubicacion.count({ where: { activa: true } }),
      this.db.usuario.count({
        where: {
          estado: 'ACTIVO',
          usuario_rol: {
            some: { rol: { nombre: { in: ['Administrador', 'Vendedor', 'Analista'] } } },
          },
        },
      }),
      this.db.producto.count(),
      this.db.definicion_reporte.count({ where: { estado: 'ACTIVA' } }),
    ]);
    const keys = ['locations', 'staff', 'products', 'savedReports'] as const;
    const exceeded = keys.filter((key, i) => values[i] > plan.limits[key]);
    const labels = {
      locations: 'ubicaciones',
      staff: 'integrantes del equipo',
      products: 'productos registrados',
      savedReports: 'reportes guardados',
    };
    if (exceeded.length)
      throw new ConflictException({
        code: 'CAPACITY_EXCEEDED',
        message:
          'Capacidad incompatible: ' +
          exceeded
            .map((key) => `${labels[key]} ${values[keys.indexOf(key)]}/${plan.limits[key]}`)
            .join(', ') +
          '. Ajusta los recursos permitidos o elige un plan mayor.',
        details: {
          resources: exceeded.map((key) => ({
            resource: key,
            used: values[keys.indexOf(key)],
            limit: plan.limits[key],
          })),
        },
      });
  }
  private async subscription(connection: PoolClient, tenantId: string): Promise<SubscriptionRow> {
    return (
      await connection.query('SELECT * FROM platform.subscription WHERE tenant_id=$1 FOR UPDATE', [
        tenantId,
      ])
    ).rows[0];
  }
  private async view(row: BillingRow) {
    const c = row.contexto;
    return {
      schemaVersion: '1.0',
      id: row.id,
      operationId: c.operationId,
      provider: row.provider === 'STRIPE' ? 'STRIPE_TEST' : row.provider,
      status: row.status,
      planCode: c.planCode,
      amountMinor: c.amountMinor,
      currency: c.currency,
      cycleAction: c.cycleAction,
      expiresAt: c.expiresAt,
      checkoutUrl: c.checkoutUrl || null,
      result: c.result || null,
      problemCode: row.error_codigo || null,
      ...(row.provider === 'QR_SIMULATED'
        ? await simulatedQr(row.id, c.amountMinor, c.currency)
        : { simulated: false }),
    };
  }
  async createCheckout(token: string, raw: unknown) {
    const input = SubscriptionCheckoutSchema.parse(raw),
      tenant = currentTenant()!;
    if (PLAN_CATALOG[input.planCode].contactSales)
      throw new BadRequestException('El plan Negocio requiere una cotización del operador.');
    if (input.provider === 'STRIPE_TEST') this.stripe.assertConfigured();
    const row = await this.control(tenant, token, async (connection, fresh) => {
      if (fresh.state === 'SUSPENDED')
        throw new ForbiddenException('La tienda está suspendida. Contacta a la operadora.');
      const actor = await this.auth.verify(token),
        externalId = `${fresh.id}:${input.operationId}`;
      const hash = digest(JSON.stringify({ tenantId: fresh.id, actorId: actor.id, ...input }));
      const previous = (
        await connection.query<BillingRow>(
          'SELECT * FROM platform.billing_event WHERE tenant_id=$1 AND external_id=$2',
          [fresh.id, externalId],
        )
      ).rows[0];
      if (previous) {
        if (previous.event_type !== 'CHECKOUT_INTENT' || previous.payload_hash !== hash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'El UUID ya corresponde a otra solicitud.',
          });
        return previous;
      }
      await this.fits(input.planCode);
      const pending = await connection.query(
        `SELECT id FROM platform.billing_event WHERE tenant_id=$1 AND event_type='CHECKOUT_INTENT'
        AND status IN ('INITIALIZING','PENDING') AND (contexto->>'expiresAt')::timestamptz>now() LIMIT 1`,
        [fresh.id],
      );
      if (pending.rowCount)
        throw new ConflictException({
          code: 'CHECKOUT_PENDING',
          message:
            'Ya hay una intención de pago vigente. Recupera su estado antes de iniciar otra.',
          details: { checkoutId: pending.rows[0].id },
        });
      const subscription = await this.subscription(connection, fresh.id),
        now = new Date();
      const renewal =
        subscription.plan_code === input.planCode &&
        subscription.status === 'ACTIVE' &&
        subscription.current_period_start &&
        subscription.current_period_end &&
        subscription.current_period_end > now;
      const context: IntentContext = {
        actorId: actor.id,
        operationId: input.operationId,
        planCode: input.planCode,
        amountMinor:
          input.billingInterval === 'YEARLY'
            ? PLAN_CATALOG[input.planCode].yearlyPriceMinor!
            : PLAN_CATALOG[input.planCode].priceMinor,
        currency: 'USD',
        billingInterval: input.billingInterval,
        expectedVersion: subscription.version,
        cycleAction: renewal
          ? 'RENEW'
          : subscription.plan_code !== input.planCode && subscription.current_period_start
            ? 'CHANGE'
            : 'ACTIVATE',
        anchorDay: billingAnchorDay(renewal ? subscription.current_period_start! : now),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 31 * 60000).toISOString(),
      };
      return (
        await connection.query<BillingRow>(
          `INSERT INTO platform.billing_event(id,tenant_id,provider,external_id,event_type,status,payload_hash,contexto)
        VALUES($1,$2,$3,$4,'CHECKOUT_INTENT',$5,$6,$7) RETURNING *`,
          [
            randomUUID(),
            fresh.id,
            input.provider === 'STRIPE_TEST' ? 'STRIPE' : 'QR_SIMULATED',
            externalId,
            input.provider === 'STRIPE_TEST' ? 'INITIALIZING' : 'PENDING',
            hash,
            context,
          ],
        )
      ).rows[0];
    });
    if (row.provider === 'STRIPE' && row.status === 'INITIALIZING') {
      // No control transaction/pool slot is held during the provider request.
      try {
        const session = await this.stripe.createCheckout({
          intentId: row.id,
          tenantId: row.tenant_id,
          slug: tenant.slug,
          amountMinor: row.contexto.amountMinor,
          planName: PLAN_CATALOG[row.contexto.planCode].name,
          expiresAt: row.contexto.expiresAt,
          currency: row.contexto.currency,
          billingInterval: row.contexto.billingInterval,
        });
        if (session.livemode || new URL(session.url).origin !== 'https://checkout.stripe.com')
          throw new Error('Sesión TEST inválida.');
        await this.registry.pool.query(
          `UPDATE platform.billing_event SET status='PENDING',contexto=contexto||$2::jsonb
          WHERE id=$1 AND status='INITIALIZING'`,
          [row.id, JSON.stringify({ sessionId: session.id, checkoutUrl: session.url })],
        );
      } catch (error) {
        if (error instanceof ServiceUnavailableException) throw error;
        throw new ServiceUnavailableException({
          code: 'PROVIDER_UNAVAILABLE',
          message:
            'No se pudo preparar Stripe TEST. Reintenta con el mismo UUID para recuperar la solicitud.',
        });
      }
    }
    return this.getCheckout(row.id);
  }
  async getCheckout(id: string) {
    const tenant = currentTenant()!;
    const row = (
      await this.registry.pool.query<BillingRow>(
        `SELECT * FROM platform.billing_event WHERE id=$1 AND tenant_id=$2 AND event_type='CHECKOUT_INTENT'`,
        [uuid(id), tenant.id],
      )
    ).rows[0];
    if (!row) throw new NotFoundException('La intención no existe en esta tienda.');
    // Expiration is derived; a GET never applies payment or changes subscription.
    if (
      ['INITIALIZING', 'PENDING'].includes(row.status) &&
      Date.parse(row.contexto.expiresAt) <= Date.now()
    )
      row.status = 'EXPIRED';
    return this.view(row);
  }
  async recentCheckouts() {
    const rows = await this.registry.pool.query<{ id: string }>(
      `SELECT id FROM platform.billing_event
      WHERE tenant_id=$1 AND event_type='CHECKOUT_INTENT' ORDER BY received_at DESC LIMIT 10`,
      [currentTenant()!.id],
    );
    return { items: await Promise.all(rows.rows.map((row) => this.getCheckout(row.id))) };
  }
  private async apply(connection: PoolClient, row: BillingRow, fresh: TenantContext) {
    if (row.status === 'APPLIED' || row.status === 'STALE') return row;
    const sub = await this.subscription(connection, row.tenant_id),
      c = row.contexto,
      now = new Date();
    if (
      fresh.state === 'SUSPENDED' ||
      sub.version !== c.expectedVersion ||
      Date.parse(c.expiresAt) <= now.getTime()
    ) {
      row.status = 'STALE';
      row.error_codigo = 'BILLING_INTENT_STALE';
      await connection.query(
        `UPDATE platform.billing_event SET status='STALE',error_codigo=$2,procesado_en=now() WHERE id=$1`,
        [row.id, row.error_codigo],
      );
      return row;
    }
    await this.fits(c.planCode);
    let start = now,
      end: Date;
    if (
      c.cycleAction === 'RENEW' &&
      sub.current_period_start &&
      sub.current_period_end &&
      sub.current_period_end > now
    ) {
      start = sub.current_period_start;
      end =
        c.billingInterval === 'YEARLY'
          ? calendarYearAfter(sub.current_period_end)
          : calendarMonthAfter(sub.current_period_end, c.anchorDay);
    } else end = c.billingInterval === 'YEARLY' ? calendarYearAfter(now) : calendarMonthAfter(now);
    const version = sub.version + 1;
    const result: BillingResult = {
      periodFrom: start.toISOString(),
      paidThrough: end.toISOString(),
      subscriptionVersion: version,
      confirmedAt: now.toISOString(),
    };
    await connection.query(
      `UPDATE platform.subscription SET plan_code=$2,status='ACTIVE',provider=$3,
      current_period_start=$4,current_period_end=$5,trial_ends_at=NULL,cancel_at_period_end=false,
      version=$6,updated_at=now() WHERE tenant_id=$1`,
      [row.tenant_id, c.planCode, row.provider, start, end, version],
    );
    await connection.query(
      "UPDATE platform.tenant SET state='ACTIVE' WHERE id=$1 AND state='TRIAL'",
      [row.tenant_id],
    );
    c.result = result;
    row.status = 'APPLIED';
    await connection.query(
      `UPDATE platform.billing_event SET status='APPLIED',procesado_en=now(),
      suscripcion_version_aplicada=$2,contexto=$3 WHERE id=$1`,
      [row.id, version, c],
    );
    return row;
  }
  async confirmQr(token: string, id: string, raw: unknown) {
    z.strictObject({ simulatedPayment: z.literal(true) }).parse(raw);
    const row = await this.control(currentTenant()!, token, async (connection, fresh) => {
      const row = (
        await connection.query<BillingRow>(
          `SELECT * FROM platform.billing_event WHERE id=$1 AND tenant_id=$2
        AND provider='QR_SIMULATED' AND event_type='CHECKOUT_INTENT' FOR UPDATE`,
          [uuid(id), fresh.id],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('No existe ese QR simulado en esta tienda.');
      if (row.status !== 'APPLIED') row.contexto.confirmedBy = (await this.auth.verify(token)).id;
      return this.apply(connection, row, fresh);
    });
    if (row.status === 'STALE')
      throw new ConflictException({
        code: 'BILLING_INTENT_STALE',
        message: 'La intención venció o cambió la suscripción. No se confirmó ningún pago.',
      });
    return this.view(row);
  }
  async cancelRenewal(token: string, raw: unknown) {
    const { operationId } = operation.parse(raw);
    return this.control(currentTenant()!, token, async (connection, fresh) => {
      if (fresh.state === 'SUSPENDED') throw new ForbiddenException('La tienda está suspendida.');
      const externalId = `${fresh.id}:${operationId}`;
      const previous = (
        await connection.query(
          'SELECT * FROM platform.billing_event WHERE tenant_id=$1 AND external_id=$2',
          [fresh.id, externalId],
        )
      ).rows[0];
      if (previous) {
        if (previous.event_type !== 'CANCEL_RENEWAL')
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'UUID utilizado para otra operación.',
          });
        return previous.contexto.result;
      }
      const sub = await this.subscription(connection, fresh.id);
      const result = {
        cancelAtPeriodEnd: true,
        periodTo: sub.current_period_end?.toISOString() || fresh.subscription?.trialEnd || null,
      };
      await connection.query(
        'UPDATE platform.subscription SET cancel_at_period_end=true,version=version+1,updated_at=now() WHERE tenant_id=$1',
        [fresh.id],
      );
      await connection.query(
        `INSERT INTO platform.billing_event(tenant_id,provider,external_id,event_type,status,contexto,procesado_en)
        VALUES($1,'INTERNAL',$2,'CANCEL_RENEWAL','APPLIED',$3,now())`,
        [
          fresh.id,
          externalId,
          { actorId: (await this.auth.verify(token)).id, operationId, result },
        ],
      );
      return result;
    });
  }
  async applyBillingEvent(event: Stripe.Event, payloadHash: string) {
    if (
      !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(
        event.type,
      )
    )
      return { status: 'IGNORED' };
    const session = event.data.object as Stripe.Checkout.Session;
    if (
      event.livemode !== false ||
      session.livemode !== false ||
      session.mode !== 'payment' ||
      session.status !== 'complete' ||
      session.payment_status !== 'paid'
    )
      throw new BadRequestException('El evento no confirma un pago TEST completado.');
    const id = uuid(session.metadata?.intentId || '');
    const row = (
      await this.registry.pool.query<BillingRow>(
        `SELECT * FROM platform.billing_event WHERE id=$1 AND provider='STRIPE' AND event_type='CHECKOUT_INTENT'`,
        [id],
      )
    ).rows[0];
    if (!row) throw new BadRequestException('El evento no corresponde a una intención registrada.');
    if (
      session.client_reference_id !== row.id ||
      session.metadata?.tenantId !== row.tenant_id ||
      session.currency !== row.contexto.currency.toLowerCase() ||
      session.amount_total !== row.contexto.amountMinor ||
      (row.contexto.sessionId && row.contexto.sessionId !== session.id) ||
      !session.id.startsWith('cs_test_')
    )
      throw new BadRequestException(
        'Importe, moneda, sesión o tienda no coinciden con la intención TEST.',
      );
    const slug = (
      await this.registry.pool.query('SELECT slug FROM platform.tenant WHERE id=$1', [
        row.tenant_id,
      ])
    ).rows[0]?.slug;
    if (!slug) throw new BadRequestException('La tienda facturada no existe.');
    const context = await this.registry.resolve(slug, true);
    return this.control(context, undefined, async (connection, fresh) => {
      const duplicate = (
        await connection.query(
          "SELECT payload_hash,contexto FROM platform.billing_event WHERE provider='STRIPE' AND external_id=$1",
          [event.id],
        )
      ).rows[0];
      if (duplicate) {
        if (duplicate.payload_hash !== payloadHash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'Evento repetido con contenido diferente.',
          });
        return duplicate.contexto.result;
      }
      const intent = (
        await connection.query<BillingRow>(
          'SELECT * FROM platform.billing_event WHERE id=$1 FOR UPDATE',
          [id],
        )
      ).rows[0];
      const applied = await this.apply(connection, intent, fresh);
      const result = {
        status: applied.status,
        intentId: id,
        result: applied.contexto.result || null,
      };
      await connection.query(
        `INSERT INTO platform.billing_event(tenant_id,provider,external_id,event_type,status,payload_hash,firma_verificada,procesado_en,suscripcion_version_aplicada,contexto)
        VALUES($1,'STRIPE',$2,$3,$4,$5,true,now(),$6,$7)`,
        [
          row.tenant_id,
          event.id,
          event.type,
          applied.status,
          payloadHash,
          applied.contexto.result?.subscriptionVersion || null,
          { intentId: id, result },
        ],
      );
      return result;
    });
  }
}
