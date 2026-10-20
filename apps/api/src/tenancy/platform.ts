import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { currentTenant, TenantContext } from './context';

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
