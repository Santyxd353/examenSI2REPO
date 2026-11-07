import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantContext = {
  id: string;
  slug: string;
  name: string;
  databaseUrl: string;
  storageDirectory: string;
  state: 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
  readOnly?: boolean;
  /** Internal lease is invalidated after completion, including escaped async callbacks. */
  writeLease?: { active: boolean };
  subscription?: {
    plan: string;
    planName: string;
    status: string;
    provider: string;
    periodEnd: string | null;
    limits: Record<string, number>;
    features: string[];
    version?: number;
    periodStart?: string | null;
    trialEnd?: string | null;
    activatedAt?: string;
    cancelAtPeriodEnd?: boolean;
  };
};

const tenants = new AsyncLocalStorage<TenantContext>();
export const currentTenant = () => tenants.getStore();
export const currentTenantSlug = () => currentTenant()?.slug || 'lumina';
export function runForTenant<T>(tenant: TenantContext, work: () => T): T {
  return tenants.run(tenant, work);
}
