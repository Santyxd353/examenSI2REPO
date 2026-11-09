import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { currentTenant, TenantContext } from './context';
import { AuthGuard, AuthRequest, requirePermission } from '../auth';
import { Db } from '../db';
import { z } from 'zod';
import { PlanBilling } from './stripe-plans';

export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000018';
export const validTenantSlug = (slug: string) =>
  slug.length <= 63 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  database_name: string;
  state: string;
  plan_code: string;
  plan_name: string;
  status: string;
  provider: string;
  trial_ends_at: Date | null;
  current_period_end: Date | null;
  cancel_at_end: boolean;
  limits: Record<string, number>;
  features: string[];
};

@Injectable()
export class TenantRegistry implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
    max: 3,
  });
  private readonly businessUrl = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL!;
  private ready?: Promise<void>;
  readonly billing = new PlanBilling(this.pool);

  databaseUrlFor(databaseName: string) {
    if (!/^[a-zA-Z0-9_]{1,63}$/.test(databaseName))
      throw new BadRequestException('Nombre de base inválido.');
    const url = new URL(this.businessUrl);
    const original = decodeURIComponent(url.pathname.slice(1));
    url.pathname = `/${databaseName}`;
    if (databaseName !== original) url.searchParams.set('connection_limit', '2');
    return url.toString();
  }

  get administrationUrl() {
    return this.businessUrl;
  }

  initialize() {
    this.ready ??= this.prepare();
    return this.ready;
  }

  private async prepare() {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(20261020)');
      await connection.query(readFileSync(resolve('prisma/platform/schema.sql'), 'utf8'));
      const plans = [
        {
          code: 'piloto',
          name: 'Piloto Lúmina',
          monthlyAmount: 0,
          limits: { locations: 20, staff: 100, products: 10000 },
          features: ['offline', 'reports', 'ai', 'ml'],
        },
        {
          code: 'esencial',
          name: 'Esencial',
          monthlyAmount: 149,
          limits: { locations: 1, staff: 3, products: 200 },
          features: ['offline', 'reports'],
        },
        {
          code: 'pro',
          name: 'Profesional',
          monthlyAmount: 299,
          limits: { locations: 5, staff: 15, products: 2000 },
          features: ['offline', 'reports', 'ai', 'ml'],
        },
        {
          code: 'negocio',
          name: 'Negocio',
          monthlyAmount: 599,
          limits: { locations: 20, staff: 100, products: 10000 },
          features: ['offline', 'reports', 'ai', 'ml'],
        },
      ];
      for (const plan of plans)
        await connection.query(
          `INSERT INTO platform.plan(code,name,monthly_amount,currency,limits,features,published)
           VALUES($1,$2,$3,'BOB',$4,$5,$6)
           ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,monthly_amount=EXCLUDED.monthly_amount,
             limits=EXCLUDED.limits,features=EXCLUDED.features,published=EXCLUDED.published`,
          [plan.code, plan.name, plan.monthlyAmount, plan.limits, JSON.stringify(plan.features), plan.code !== 'piloto'],
        );
      const databaseName = decodeURIComponent(new URL(this.businessUrl).pathname.slice(1));
      await connection.query(
        `INSERT INTO platform.tenant(id,slug,name,database_name,state)
        VALUES($1,'lumina','Lúmina',$2,'ACTIVE') ON CONFLICT(slug) DO NOTHING`,
        [DEFAULT_TENANT_ID, databaseName],
      );
      await connection.query(`INSERT INTO platform.subscription(tenant_id,plan_code,status,provider)
        SELECT id,'piloto','ACTIVE','NONE' FROM platform.tenant WHERE slug='lumina'
        ON CONFLICT(tenant_id) DO NOTHING`);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  async resolve(slug: string, maintenance = false): Promise<TenantContext> {
    if (!validTenantSlug(slug))
      throw new BadRequestException('El identificador de tienda no es válido.');
    await this.initialize();
    const result = await this.pool.query<TenantRow>(
      `SELECT t.*,s.plan_code,s.status,s.provider,s.trial_ends_at,s.current_period_end,
      s.cancel_at_end,p.name AS plan_name,p.limits,p.features FROM platform.tenant t
      JOIN platform.subscription s ON s.tenant_id=t.id JOIN platform.plan p ON p.code=s.plan_code WHERE t.slug=$1`,
      [slug],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('La tienda no existe.');
    if (!(maintenance ? ['ACTIVE', 'TRIAL', 'SUSPENDED'] : ['ACTIVE', 'TRIAL']).includes(row.state))
      throw new ForbiddenException('La tienda no está disponible.');
    if (!/^[a-zA-Z0-9_]+$/.test(row.database_name))
      throw new ForbiddenException('La tienda requiere revisión de configuración.');
    const periodEnd = row.status === 'TRIALING' ? row.trial_ends_at : row.current_period_end;
    const expired = !!periodEnd && periodEnd.getTime() <= Date.now();
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      databaseUrl: this.databaseUrlFor(row.database_name),
      storageDirectory:
        row.slug === 'lumina'
          ? resolve(process.env.STORAGE_ROOT || '.local/storage')
          : resolve(process.env.STORAGE_ROOT || '.local/storage', 'tenants', row.id),
      state: row.state as TenantContext['state'],
      readOnly:
        row.state === 'SUSPENDED' || expired || !['ACTIVE', 'TRIALING'].includes(row.status),
      subscription: {
        plan: row.plan_code,
        planName: row.plan_name,
        status: expired ? 'EXPIRED' : row.status,
        provider: row.provider,
        cancelAtEnd: row.cancel_at_end,
        periodEnd: periodEnd?.toISOString() || null,
        limits: row.slug === 'lumina' && row.plan_code === 'piloto' ? {} : row.limits,
        features: row.features,
      },
    };
  }

  async listActive() {
    await this.initialize();
    const rows = await this.pool.query<{ slug: string }>(
      `SELECT slug FROM platform.tenant WHERE state IN ('ACTIVE','TRIAL') ORDER BY created_at`,
    );
    return Promise.all(rows.rows.map((row) => this.resolve(row.slug)));
  }

  async listForMaintenance() {
    await this.initialize();
    const rows = await this.pool.query<{ slug: string }>(
      `SELECT slug FROM platform.tenant WHERE state IN ('ACTIVE','TRIAL','SUSPENDED') ORDER BY created_at`,
    );
    return Promise.all(rows.rows.map((row) => this.resolve(row.slug, true)));
  }

  async plans() {
    await this.initialize();
    const result = await this.pool.query<{
      code: string; name: string; monthly_amount: string; currency: string;
      limits: Record<string, number>; features: string[];
    }>(`SELECT code,name,monthly_amount,currency,limits,features
        FROM platform.plan WHERE published ORDER BY monthly_amount`);
    return result.rows.map((row) => ({
      code: row.code,
      name: row.name,
      monthlyAmount: Number(row.monthly_amount),
      currency: row.currency,
      limits: row.limits,
      features: row.features,
    }));
  }

  async activateTestPlan(tenantId: string, planCode: string, operationId: string) {
    await this.initialize();
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const locked = await connection.query('SELECT provider,status,pending_checkout FROM platform.subscription WHERE tenant_id=$1 FOR UPDATE', [tenantId]);
      const existing = await connection.query(
        `SELECT 1 FROM platform.billing_event WHERE provider='QR_SIMULATED' AND external_id=$1`,
        [operationId],
      );
      if (!existing.rowCount) {
        if (locked.rows[0]?.pending_checkout || (locked.rows[0]?.provider === 'STRIPE' && locked.rows[0]?.status !== 'CANCELED'))
          throw new BadRequestException('Finaliza el ciclo Stripe y descarta cualquier Checkout pendiente antes de usar QR.');
        const selected = await connection.query(`SELECT code FROM platform.plan WHERE code=$1 AND published`, [planCode]);
        if (!selected.rowCount) throw new BadRequestException('El plan seleccionado no está disponible.');
        await connection.query(
          `UPDATE platform.subscription SET plan_code=$1,status='ACTIVE',provider='QR_SIMULATED',
             trial_ends_at=NULL,stripe_subscription_id=NULL,cancel_at_end=false,current_period_end=now()+interval '30 days',version=version+1,updated_at=now()
           WHERE tenant_id=$2`,
          [planCode, tenantId],
        );
        await connection.query(
          `INSERT INTO platform.billing_event(tenant_id,provider,external_id,event_type,status)
           VALUES($1,'QR_SIMULATED',$2,'TEST_PLAN_CONFIRMED','APPLIED')`,
          [tenantId, operationId],
        );
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
    return this.resolve(currentTenant()?.slug || '', true);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Controller('tenant')
export class TenantController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(TenantRegistry) private readonly registry: TenantRegistry) {}

  private async usage() {
    const [locations, products, staff] = await Promise.all([
      this.db.ubicacion.count({ where: { activa: true } }),
      this.db.producto.count(),
      this.db.usuario.count({
        where: {
          estado: 'ACTIVO',
          usuario_rol: { some: { rol: { nombre: { in: ['Administrador', 'Vendedor', 'Analista'] } } } },
        },
      }),
    ]);
    return { locations, products, staff };
  }

  @Get()
  info() {
    const tenant = currentTenant();
    return {
      id: tenant?.id,
      slug: tenant?.slug,
      name: tenant?.name,
      state: tenant?.state,
      readOnly: tenant?.readOnly,
      subscription: tenant?.subscription,
    };
  }

  @Get('subscription')
  @UseGuards(AuthGuard)
  async subscription(@Req() request: AuthRequest) {
    requirePermission(request.user, 'usuarios:gestionar');
    const tenant = currentTenant();
    const usage = await this.usage();
    const pendingCheckout = tenant ? await this.registry.billing.refresh(tenant.id) : false;
    const subscription = tenant ? (await this.registry.resolve(tenant.slug)).subscription : undefined;
    return {
      subscription, pendingCheckout,
      usage,
      trial: {
        active: subscription?.status === 'TRIALING',
        endsAt: subscription?.status === 'TRIALING' ? subscription.periodEnd : null,
      },
    };
  }

  @Get('plans')
  @UseGuards(AuthGuard)
  plans(@Req() request: AuthRequest) {
    requirePermission(request.user, 'usuarios:gestionar');
    return this.registry.plans();
  }

  private async selection(body: unknown) {
    const input = z.object({ planCode: z.enum(['esencial', 'pro', 'negocio']), operationId: z.string().uuid() }).strict().parse(body);
    const plan = (await this.registry.plans()).find((item) => item.code === input.planCode)!;
    const usage = await this.usage();
    const exceeded = (Object.keys(usage) as (keyof typeof usage)[]).filter((key) => usage[key] > (plan.limits[key] ?? Number.MAX_SAFE_INTEGER));
    if (exceeded.length)
      throw new BadRequestException(`El plan no admite el consumo actual de: ${exceeded.join(', ')}.`);
    return { plan, operationId: input.operationId };
  }

  @Get('subscription/return')
  checkoutReturn() {
    return 'Vuelve a Lúmina y abre Mi negocio para consultar el estado del pago.';
  }

  @Post('subscription/checkout')
  @UseGuards(AuthGuard)
  async checkout(@Req() request: AuthRequest, @Body() body: unknown) {
    requirePermission(request.user, 'usuarios:gestionar');
    const { plan, operationId } = await this.selection(body);
    return this.registry.billing.start(currentTenant()!.id, plan, operationId);
  }

  @Post('subscription/discard')
  @UseGuards(AuthGuard)
  async discard(@Req() request: AuthRequest) {
    requirePermission(request.user, 'usuarios:gestionar');
    await this.registry.billing.discard(currentTenant()!.id);
    return { discarded: true };
  }

  @Post('subscription/cancel')
  @UseGuards(AuthGuard)
  async cancel(@Req() request: AuthRequest) {
    requirePermission(request.user, 'usuarios:gestionar');
    await this.registry.billing.cancel(currentTenant()!.id);
    return { scheduled: true };
  }

  @Post('subscription/test-confirm')
  @UseGuards(AuthGuard)
  async confirmTestPlan(@Req() request: AuthRequest, @Body() body: unknown) {
    requirePermission(request.user, 'usuarios:gestionar');
    const { plan, operationId } = await this.selection(body);
    const tenant = currentTenant();
    if (!tenant) throw new BadRequestException('La tienda no está disponible.');
    await this.registry.activateTestPlan(tenant.id, plan.code, operationId);
    return { confirmed: true, provider: 'QR_SIMULATED', subscription: (await this.registry.resolve(tenant.slug, true)).subscription };
  }
}

@Controller('platform')
export class PlatformController {
  constructor(@Inject(TenantRegistry) private registry: TenantRegistry) {}
  @Get('stores')
  async stores() {
    return (await this.registry.listActive()).map((tenant) => ({
      slug: tenant.slug,
      name: tenant.name,
    }));
  }
}
