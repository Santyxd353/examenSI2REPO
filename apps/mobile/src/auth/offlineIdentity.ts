import type { Identity } from '../types';
import type { ScopeKey } from './sessionScope';

export type OfflineIdentity = Readonly<{
  identity: Identity;
  tenantSlug: string;
  savedAt: string;
}>;

export function createOfflineIdentity(identity: Identity, scope: ScopeKey): OfflineIdentity {
  return { identity, tenantSlug: scope.tenantSlug, savedAt: new Date().toISOString() };
}

export function canRestoreOfflineIdentity(
  record: OfflineIdentity | null,
  scope: ScopeKey,
): record is OfflineIdentity {
  return !!record && record.tenantSlug === scope.tenantSlug && record.identity.tenant?.slug === scope.tenantSlug;
}
