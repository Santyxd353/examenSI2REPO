import { z } from 'zod';
import { MinorSchema, SafeIntegerSchema, TimestampSchema, UuidSchema } from './common';

export const PlanCodeSchema = z.enum(['esencial', 'pro', 'negocio']);
export const PlanLimitsSchema = z.strictObject({
  locations: SafeIntegerSchema.positive(),
  staff: SafeIntegerSchema.positive(),
  products: SafeIntegerSchema.positive(),
  avatarsPerPeriod: MinorSchema,
  savedReports: MinorSchema,
  aiPerPeriod: MinorSchema,
});
export const PlanFeaturesSchema = z.strictObject({
  offline: z.literal(true),
  offlineOutfitsLimit: z.literal(10),
  manualReports: z.literal(true),
  aiReports: z.boolean(),
  demand: z.boolean(),
  restock: z.boolean(),
  anomalies: z.boolean(),
  multilocationAnalysis: z.boolean(),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;
export type PlanFeatures = z.infer<typeof PlanFeaturesSchema>;
export type PlanCode = z.infer<typeof PlanCodeSchema>;
export type Plan = {
  code: PlanCode;
  name: string;
  currency: 'USD';
  priceMinor: number;
  yearlyPriceMinor: number | null;
  contactSales: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
};
const features = (ml: boolean, negocio: boolean): PlanFeatures => ({
  offline: true,
  offlineOutfitsLimit: 10,
  manualReports: true,
  aiReports: ml,
  demand: ml,
  restock: ml,
  anomalies: negocio,
  multilocationAnalysis: negocio,
});
export const PLAN_CATALOG: Readonly<Record<PlanCode, Plan>> = {
  esencial: {
    code: 'esencial',
    name: 'Esencial',
    currency: 'USD',
    priceMinor: 999,
    yearlyPriceMinor: 9999,
    contactSales: false,
    limits: {
      locations: 1,
      staff: 3,
      products: 200,
      avatarsPerPeriod: 30,
      savedReports: 3,
      aiPerPeriod: 0,
    },
    features: features(false, false),
  },
  pro: {
    code: 'pro',
    name: 'Profesional',
    currency: 'USD',
    priceMinor: 1999,
    yearlyPriceMinor: 19999,
    contactSales: false,
    limits: {
      locations: 5,
      staff: 15,
      products: 2000,
      avatarsPerPeriod: 150,
      savedReports: 15,
      aiPerPeriod: 100,
    },
    features: features(true, false),
  },
  negocio: {
    code: 'negocio',
    name: 'Negocio',
    currency: 'USD',
    priceMinor: 0,
    yearlyPriceMinor: null,
    contactSales: true,
    limits: {
      locations: 20,
      staff: 100,
      products: 10000,
      avatarsPerPeriod: 500,
      savedReports: 50,
      aiPerPeriod: 500,
    },
    features: features(true, true),
  },
};
for (const plan of Object.values(PLAN_CATALOG)) {
  Object.freeze(plan.limits);
  Object.freeze(plan.features);
  Object.freeze(plan);
}
Object.freeze(PLAN_CATALOG);

export const EntitlementsSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0'),
    tenantId: UuidSchema,
    planCode: PlanCodeSchema,
    status: z.enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED']),
    periodFrom: TimestampSchema,
    periodTo: TimestampSchema,
    readOnly: z.boolean(),
    cancelAtPeriodEnd: z.boolean(),
    currency: z.enum(['BOB', 'USD']),
    priceMinor: MinorSchema,
    billingMode: z.enum(['STRIPE_TEST', 'QR_SIMULATED']).nullable(),
    legacyPilot: z.boolean().default(false),
    paidThrough: TimestampSchema.nullable().optional(),
    limits: PlanLimitsSchema,
    features: PlanFeaturesSchema,
    usage: z.strictObject({
      locations: MinorSchema,
      staff: MinorSchema,
      products: MinorSchema,
      avatarsCommitted: MinorSchema,
      avatarsReserved: MinorSchema,
      savedReports: MinorSchema,
      aiCommitted: MinorSchema,
      aiReserved: MinorSchema,
    }),
  })
  .refine(
    (value) => Date.parse(value.periodFrom) < Date.parse(value.periodTo),
    'Período inválido.',
  );
export type Entitlements = z.infer<typeof EntitlementsSchema>;
export const SubscriptionCheckoutSchema = z.strictObject({
  planCode: PlanCodeSchema,
  provider: z.enum(['STRIPE_TEST', 'QR_SIMULATED']),
  operationId: UuidSchema,
  acceptCycleTerms: z.literal(true),
  billingInterval: z.enum(['MONTHLY', 'YEARLY']).default('MONTHLY'),
});
export const SubscriptionCheckoutViewSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  id: UuidSchema,
  operationId: UuidSchema,
  provider: z.enum(['STRIPE_TEST', 'QR_SIMULATED']),
  status: z.enum(['INITIALIZING', 'PENDING', 'APPLIED', 'STALE', 'EXPIRED']),
  planCode: PlanCodeSchema,
  amountMinor: MinorSchema,
  currency: z.enum(['BOB', 'USD']),
  cycleAction: z.enum(['ACTIVATE', 'RENEW', 'CHANGE']),
  expiresAt: TimestampSchema,
  checkoutUrl: z.string().url().nullable(),
  problemCode: z.string().nullable(),
  simulated: z.boolean(),
  qrPayload: z.string().optional(),
  qrDataUrl: z.string().optional(),
  result: z
    .strictObject({
      periodFrom: TimestampSchema,
      paidThrough: TimestampSchema,
      subscriptionVersion: z.number().int().positive(),
      confirmedAt: TimestampSchema,
    })
    .nullable(),
});
export type SubscriptionCheckoutView = z.infer<typeof SubscriptionCheckoutViewSchema>;
