import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { DEFAULT_TENANT_ID, TenantRegistry } from './platform';

const filters = z.strictObject({
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  search: z.string().trim().max(100).default(''),
  state: z.enum(['ALL', 'ACTIVE', 'TRIAL', 'SUSPENDED', 'PROVISIONING', 'FAILED']).default('ALL'),
  plan: z.enum(['ALL', 'piloto', 'esencial', 'pro', 'negocio']).default('ALL'),
});
const selection = `SELECT t.id,t.slug,t.name,t.state,t.created_at,
  s.plan_code,s.status,s.provider,s.trial_ends_at,s.current_period_start,s.current_period_end,
  CASE WHEN t.state='SUSPENDED' THEN 'SUSPENDED'
    WHEN s.status='TRIALING' AND s.trial_ends_at<=now() THEN 'EXPIRED'
    WHEN s.status='ACTIVE' AND s.current_period_end<=now() THEN 'EXPIRED'
    ELSE s.status END AS effective_status
  FROM platform.tenant t LEFT JOIN platform.subscription s ON s.tenant_id=t.id`;
function view(row: Record<string, any>) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    state: row.state,
    createdAt: row.created_at,
    planCode: row.plan_code,
    status: row.status,
    effectiveStatus: row.effective_status,
    provider: row.provider,
    trialEndsAt: row.trial_ends_at,
    paidThrough: row.current_period_end,
    periodStart: row.current_period_start,
    legacyPilot: row.id === DEFAULT_TENANT_ID,
  };
}
@Injectable()
export class OperatorManagementService {
  constructor(@Inject(TenantRegistry) private readonly registry: TenantRegistry) {}
  async list(raw: unknown) {
    const input = filters.parse(raw);
    const where = ` WHERE ($1='' OR position(lower($1) in lower(t.name||' '||t.slug))>0)
      AND ($2='ALL' OR t.state=$2) AND ($3='ALL' OR s.plan_code=$3)`;
    const params = [input.search, input.state, input.plan];
    const [rows, count] = await Promise.all([
      this.registry.pool.query(
        selection + where + ' ORDER BY t.created_at DESC,t.id LIMIT 51 OFFSET $4',
        [...params, input.offset],
      ),
      this.registry.pool.query(
        'SELECT count(*)::int AS count FROM platform.tenant t LEFT JOIN platform.subscription s ON s.tenant_id=t.id' +
          where,
        params,
      ),
    ]);
    return {
      tenants: rows.rows.slice(0, 50).map(view),
      total: count.rows[0].count,
      hasMore: rows.rows.length > 50,
      nextOffset: rows.rows.length > 50 ? input.offset + 50 : null,
    };
  }
  async dashboard() {
    const connection = await this.registry.pool.connect();
    try {
      await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const counts = (
        await connection.query(`WITH tenants AS (${selection})
        SELECT count(*)::int AS total,
        count(*) FILTER(WHERE state='SUSPENDED')::int AS suspended,
        count(*) FILTER(WHERE state='FAILED')::int AS failed,
        count(*) FILTER(WHERE state='PROVISIONING')::int AS provisioning,
        count(*) FILTER(WHERE state IN ('FAILED','PROVISIONING','SUSPENDED') OR effective_status='EXPIRED')::int AS attention,
        count(*) FILTER(WHERE effective_status='EXPIRED')::int AS expired,
        count(*) FILTER(WHERE effective_status='TRIALING' AND state='TRIAL')::int AS trial,
        count(*) FILTER(WHERE effective_status='ACTIVE' AND state='ACTIVE')::int AS active,
        count(*) FILTER(WHERE created_at>=date_trunc('month',now() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz')::int AS new_this_month,
        count(*) FILTER(WHERE state IN ('ACTIVE','TRIAL')
          AND (CASE WHEN status='TRIALING' THEN trial_ends_at ELSE current_period_end END)>now()
          AND (CASE WHEN status='TRIALING' THEN trial_ends_at ELSE current_period_end END)<=now()+interval '7 days')::int AS expiring
        FROM tenants`)
      ).rows[0];
      const plans = (
        await connection.query(`SELECT s.plan_code AS code,count(*)::int AS count
        FROM platform.tenant t JOIN platform.subscription s ON s.tenant_id=t.id GROUP BY s.plan_code ORDER BY s.plan_code`)
      ).rows;
      const recent = (
        await connection.query(selection + ' ORDER BY t.created_at DESC,t.id LIMIT 5')
      ).rows.map(view);
      const registrations = (
        await connection.query(`SELECT id,company_name AS "companyName",slug,state,provider,
        amount_minor AS "amountMinor",billing_interval AS "billingInterval",created_at AS "createdAt"
        FROM platform.signup WHERE state IN ('PAID','PROVISIONING','REVIEW') ORDER BY created_at LIMIT 8`)
      ).rows;
      await connection.query('COMMIT');
      return {
        generatedAt: new Date().toISOString(),
        timeZone: 'America/La_Paz',
        counts,
        plans,
        recent,
        registrations,
      };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  async detail(id: string) {
    z.uuid().parse(id);
    const row = (await this.registry.pool.query(selection + ' WHERE t.id=$1', [id])).rows[0];
    if (!row) throw new NotFoundException('El negocio no existe.');
    const payments = await this.registry.pool.query(
      `SELECT id,provider,event_type AS "eventType",status,received_at AS "receivedAt",
      contexto->'amountMinor' AS "amountMinor",contexto->>'currency' AS currency,
      contexto->>'billingInterval' AS "billingInterval"
      FROM platform.billing_event WHERE tenant_id=$1 AND event_type IN ('PUBLIC_SIGNUP','CHECKOUT_INTENT')
      ORDER BY received_at DESC,id DESC LIMIT 12`,
      [id],
    );
    return { tenant: view(row), payments: payments.rows };
  }
}
