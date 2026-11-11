export type Store = {
  id: string;
  slug: string;
  name: string;
  state: string;
  planCode: string;
  status: string;
  effectiveStatus?: string;
  createdAt?: string;
  trialEndsAt?: string | null;
  paidThrough?: string | null;
  periodStart?: string | null;
  provider?: string;
  legacyPilot?: boolean;
};
export type PlatformSummary = {
  generatedAt: string;
  timeZone: string;
  counts: {
    total: number;
    active: number;
    trial: number;
    suspended: number;
    expired: number;
    failed: number;
    provisioning: number;
    attention: number;
    new_this_month: number;
    expiring: number;
  };
  plans: { code: string; count: number }[];
  recent: Store[];
  registrations: {
    id: string;
    companyName: string;
    slug: string;
    state: string;
    provider: string;
    amountMinor: number;
    billingInterval: string;
    createdAt: string;
  }[];
};
export type StoreDetails = {
  tenant: Store;
  payments: {
    id: string;
    provider: string;
    eventType: string;
    status: string;
    receivedAt: string;
    amountMinor: number | null;
    currency: string | null;
    billingInterval: string | null;
  }[];
};
export const stateNames: Record<string, string> = {
  ACTIVE: 'Activa',
  TRIAL: 'En prueba',
  PROVISIONING: 'Preparando',
  SUSPENDED: 'Suspendida',
  FAILED: 'Revisión requerida',
};
export const subscriptionNames: Record<string, string> = {
  ACTIVE: 'Activa',
  TRIALING: 'En prueba',
  EXPIRED: 'Vencida',
  PAST_DUE: 'Pago pendiente',
  CANCELED: 'Cancelada',
  SUSPENDED: 'Suspendida',
};
export const platformDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString('es-BO', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/La_Paz',
      })
    : 'Sin fecha registrada';
