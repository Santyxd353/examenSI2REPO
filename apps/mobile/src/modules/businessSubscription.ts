import { EntitlementsSchema, PLAN_CATALOG } from '@lumina/contracts';
const states = {
  ACTIVE: 'Activo',
  TRIAL: 'Período de prueba',
  EXPIRED: 'Vencido',
  SUSPENDED: 'Suspendido',
};
export function businessSubscriptionView(raw: unknown) {
  const value = EntitlementsSchema.parse(raw);
  return {
    subscription: {
      planName: PLAN_CATALOG[value.planCode].name,
      status: states[value.status],
      periodEnd: value.periodTo,
      limits: {
        locations: value.limits.locations,
        products: value.limits.products,
        staff: value.limits.staff,
        avatars: value.limits.avatarsPerPeriod,
        savedReports: value.limits.savedReports,
        ai: value.limits.aiPerPeriod,
      },
    },
    usage: {
      locations: value.usage.locations,
      products: value.usage.products,
      staff: value.usage.staff,
      avatars: value.usage.avatarsCommitted + value.usage.avatarsReserved,
      savedReports: value.usage.savedReports,
      ai: value.usage.aiCommitted + value.usage.aiReserved,
    },
    trial: {
      active: value.status === 'TRIAL',
      endsAt: value.status === 'TRIAL' ? value.periodTo : null,
    },
    readOnly: value.readOnly,
    priceMinor: value.priceMinor,
  };
}
