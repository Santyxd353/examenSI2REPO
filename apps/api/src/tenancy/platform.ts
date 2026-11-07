import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { currentTenant, runForTenant, TenantContext } from './context';
import { subscriptionLockKey } from '../billing/locks';
import { applyControlMigrations } from './migrations';
import { PLAN_CATALOG, minorToDecimal } from '@lumina/contracts';

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
  limits: Record<string, number>;
  features: string[];
  created_at: Date;
  current_period_start: Date | null;
  cancel_at_period_end: boolean;
  subscription_version: number;
};

@Injectable()
export class TenantRegistry implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
    max: 3,
  });
  private readonly businessUrl = process.env.TENANT_DATABASE_URL || process.env.DATABASE_URL!;
  private ready?: Promise<void>;

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
      await applyControlMigrations(connection);
      const plans = [
        {
          code: 'piloto',
          name: 'Piloto Lúmina',
          limits: { locations: 20, staff: 100, products: 10000 },
          features: ['offline', 'reports', 'ai', 'ml'],
        },
        {
          code: 'esencial',
          name: 'Esencial',
          limits: { locations: 1, staff: 3, products: 200 },
          features: ['offline', 'reports'],
        },
        {
          code: 'pro',
          name: 'Profesional',
          limits: { locations: 5, staff: 15, products: 2000 },
          features: ['offline', 'reports', 'ai', 'ml'],
        },
        {
          code: 'negocio',
          name: 'Negocio',
          limits: { locations: 20, staff: 100, products: 10000 },
          features: ['offline', 'reports', 'ai', 'ml'],
        },
      ];
      for (const plan of plans)
        await connection.query(
          'INSERT INTO platform.plan(code,name,limits,features) VALUES($1,$2,$3,$4) ON CONFLICT(code) DO NOTHING',
          [plan.code, plan.name, plan.limits, JSON.stringify(plan.features)],
        );
      for (const plan of Object.values(PLAN_CATALOG)) {
        const features = [
          'offline',
          'reports',
          ...(plan.features.aiReports ? ['ai'] : []),
          ...(plan.features.demand ? ['ml'] : []),
          ...(plan.features.anomalies ? ['anomalies', 'multilocation'] : []),
        ];
        await connection.query(
          `UPDATE platform.plan SET monthly_amount=$2,currency='BOB',limits=$3,features=$4,published=true WHERE code=$1`,
          [
            plan.code,
            minorToDecimal(plan.priceMinor),
            JSON.stringify(plan.limits),
            JSON.stringify(features),
          ],
        );
      }
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

  async resolve(
    slug: string,
    maintenance = false,
    connection?: Pick<PoolClient, 'query'>,
  ): Promise<TenantContext> {
    if (!validTenantSlug(slug))
      throw new BadRequestException('El identificador de tienda no es válido.');
    await this.initialize();
    const result = await (connection || this.pool).query<TenantRow>(
      `SELECT t.*,s.plan_code,s.status,s.provider,s.trial_ends_at,s.current_period_end,s.current_period_start,
      s.cancel_at_period_end,s.version AS subscription_version,
      p.name AS plan_name,p.limits,p.features FROM platform.tenant t
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
        periodEnd: periodEnd?.toISOString() || null,
        limits: row.slug === 'lumina' && row.plan_code === 'piloto' ? {} : row.limits,
        features: row.features,
        version: row.subscription_version,
        periodStart: row.current_period_start?.toISOString() || null,
        trialEnd: row.trial_ends_at?.toISOString() || null,
        activatedAt: row.created_at.toISOString(),
        cancelAtPeriodEnd: row.cancel_at_period_end,
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

  async withWriteAccess<T>(
    context: TenantContext,
    work: (fresh: TenantContext) => Promise<T>,
  ): Promise<T> {
    const active = currentTenant();
    if (active?.id === context.id && active.writeLease?.active) return work(active);
    await this.initialize();
    const connection = await this.pool.connect();
    let locked = false,
      destroy = false;
    const lease = { active: false };
    try {
      await connection.query("SET lock_timeout = '8s'");
      await connection.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        subscriptionLockKey(context.id),
      ]);
      locked = true;
      // Reuse the leased connection: taking another pool slot here can deadlock a full pool.
      const fresh = await this.resolve(context.slug, false, connection);
      if (fresh.id !== context.id)
        throw new ForbiddenException('El negocio cambió. Vuelve a iniciar sesión.');
      if (fresh.readOnly)
        throw new HttpException(
          {
            code: 'SUBSCRIPTION_REQUIRED',
            message: 'Renueva la suscripción para guardar cambios.',
          },
          402,
        );
      lease.active = true;
      fresh.writeLease = lease;
      return await runForTenant(fresh, () => work(fresh));
    } catch (error) {
      if ((error as { code?: string })?.code === '55P03')
        throw new HttpException(
          {
            code: 'BUSINESS_BUSY',
            retryable: true,
            message: 'La tienda está procesando otra operación. Reintenta.',
          },
          503,
        );
      throw error;
    } finally {
      lease.active = false;
      if (locked) {
        try {
          await connection.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            subscriptionLockKey(context.id),
          ]);
        } catch {
          destroy = true;
        }
      }
      if (!destroy) {
        try {
          await connection.query('SET lock_timeout = DEFAULT');
        } catch {
          destroy = true;
        }
      }
      connection.release(destroy);
    }
  }

  async listForMaintenance() {
    await this.initialize();
    const rows = await this.pool.query<{ slug: string }>(
      `SELECT slug FROM platform.tenant WHERE state IN ('ACTIVE','TRIAL','SUSPENDED') ORDER BY created_at`,
    );
    return Promise.all(rows.rows.map((row) => this.resolve(row.slug, true)));
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Controller('tenant')
export class TenantController {
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
