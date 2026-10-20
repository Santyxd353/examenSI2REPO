import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantContext = {
  id: string;
  slug: string;
  name: string;
  databaseUrl: string;
  storageDirectory: string;
  state: 'ACTIVE' | 'TRIAL' | 'SUSPENDED';
  readOnly?: boolean;
  subscription?: {
    plan: string;
    planName: string;
    status: string;
    provider: string;
    periodEnd: string | null;
    limits: Record<string, number>;
    features: string[];
  };
};

const tenants = new AsyncLocalStorage<TenantContext>();
export const currentTenant = () => tenants.getStore();
export const currentTenantSlug = () => currentTenant()?.slug || 'lumina';
export function runForTenant<T>(tenant: TenantContext, work: () => T): T {
  return tenants.run(tenant, work);
}
