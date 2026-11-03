import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { createApp } from '../../src/app';
import { AuthService } from '../../src/auth';
import { TenantRegistry } from '../../src/tenancy/platform';
import { provisionTenant } from '../../src/tenancy/provision';
import { runForTenant } from '../../src/tenancy/context';

export async function billingFixture() {
  const app = await createApp(),
    registry = app.get(TenantRegistry);
  const slug = `billing-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const email = `${slug}@qa.test`,
    password = 'BillingPrueba2026!';
  const tenant = await provisionTenant(
    {
      slug,
      name: 'Facturación QA',
      ownerEmail: email,
      ownerPassword: password,
      planCode: 'esencial',
    },
    registry,
  );
  const login = await runForTenant(tenant, () =>
    app.get(AuthService).mobileLogin({ correo: email, clave: password }),
  );
  return {
    app,
    registry,
    tenant,
    token: login.accessToken,
    actorId: login.user.id,
    async reset() {
      await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query(
        `UPDATE platform.subscription SET plan_code='esencial',status='TRIALING',provider='NONE',
        current_period_start=NULL,current_period_end=NULL,trial_ends_at=now()+interval '14 days',
        cancel_at_period_end=false,version=1 WHERE tenant_id=$1`,
        [tenant.id],
      );
    },
    async close() {
      const name = new URL(tenant.databaseUrl).pathname.slice(1);
      if (!/^store_[a-f0-9]{32}$/.test(name)) throw new Error('Base de limpieza inválida.');
      await registry.pool.query('DELETE FROM platform.billing_event WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query('DELETE FROM platform.subscription WHERE tenant_id=$1', [
        tenant.id,
      ]);
      await registry.pool.query('DELETE FROM platform.tenant WHERE id=$1', [tenant.id]);
      await app.close();
      const cleanup = new Client({ connectionString: process.env.DATABASE_URL });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE "${name}"`);
      await cleanup.end();
    },
  };
}
