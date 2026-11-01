export type ScopeKey = Readonly<{
  tenantSlug: string;
  epoch: number;
}>;

export type SessionScope = {
  capture(): ScopeKey;
  current(): ScopeKey;
  isCurrent(scope: ScopeKey): boolean;
  assertCurrent(scope: ScopeKey): void;
  switchTenant(slug: string): ScopeKey;
  invalidate(): ScopeKey;
};

export function createSessionScope(initialTenant: string): SessionScope {
  let tenantSlug = initialTenant;
  let epoch = 0;
  const current = (): ScopeKey => ({ tenantSlug, epoch });
  const isCurrent = (scope: ScopeKey) => scope.tenantSlug === tenantSlug && scope.epoch === epoch;
  return {
    capture: current,
    current,
    isCurrent,
    assertCurrent(scope) {
      if (!isCurrent(scope)) throw new Error('La tienda o la sesión cambió. Intenta nuevamente.');
    },
    switchTenant(slug) {
      if (slug !== tenantSlug) {
        tenantSlug = slug;
        epoch += 1;
      }
      return current();
    },
    invalidate() {
      epoch += 1;
      return current();
    },
  };
}
