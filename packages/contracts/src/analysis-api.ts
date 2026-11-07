import { z } from 'zod';
import { ChannelSchema, HashSchema, SourceSchema, TimestampSchema, UuidSchema } from './common';
import { DateSchema } from './reports';

export const AnalysisActionSchema = z.enum([
  'GENERATE_DATASET',
  'TRAIN_DEMAND',
  'TRAIN_ANOMALY',
  'FORECAST',
  'SUGGEST_RESTOCK',
]);
export const AnalysisRequestSchema = z
  .strictObject({
    operationId: UuidSchema,
    action: AnalysisActionSchema,
    source: SourceSchema,
    datasetJobId: UuidSchema.optional(),
    modelJobId: UuidSchema.optional(),
    forecastJobId: UuidSchema.optional(),
    horizonDays: z.union([z.literal(7), z.literal(30)]).optional(),
    locationIds: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
    channel: ChannelSchema.default('WEB'),
  })
  .superRefine((v, ctx) => {
    const error = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.action === 'FORECAST' && ((!v.modelJobId && v.source !== 'REAL') || !v.horizonDays))
      error('Selecciona modelo y horizonte.');
    if (
      v.source !== 'REAL' &&
      ['TRAIN_DEMAND', 'TRAIN_ANOMALY'].includes(v.action) &&
      !v.datasetJobId
    )
      error('Selecciona un dataset generado.');
    if (v.action === 'SUGGEST_RESTOCK' && v.source === 'DEMOSTRACION_SINTETICA' && !v.forecastJobId)
      error('Selecciona un pronóstico para la reposición de demostración.');
  });
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;
export const AnalysisMetricSchema = z
  .strictObject({
    name: z.string().min(1).max(40),
    partition: z.enum(['VALIDACION', 'PRUEBA']),
    horizonDays: z.union([z.literal(0), z.literal(7), z.literal(30)]),
    value: z.number().finite().nullable(),
    baseline: z.number().finite().nullable(),
    status: z.enum(['EVALUABLE', 'NO_APLICA']),
    reason: z.string().max(200).nullable(),
    observations: z.number().int().nonnegative().safe(),
  })
  .refine(
    (v) => (v.status === 'EVALUABLE' ? v.value !== null : v.value === null && Boolean(v.reason)),
    'Métrica no disponible requiere motivo.',
  );
export const AnalysisForecastSchema = z.strictObject({
  date: DateSchema,
  variantId: z.string(),
  locationId: z.string(),
  channel: ChannelSchema,
  predictedUnits: z.number().finite().nonnegative(),
});
export const AnalysisSuggestionSchema = z.strictObject({
  variantId: z.string(),
  locationId: z.string(),
  suggestedQuantity: z.number().int().nonnegative().safe(),
  available: z.number().finite().nonnegative(),
  safetyStock: z.number().finite().nonnegative(),
  demandDuringLead: z.number().finite().nonnegative(),
  confirmedInbound: z.number().finite().nonnegative(),
  leadTimeDays: z.number().finite().nonnegative(),
  demandSource: z.enum(['FORECAST', 'REGLA_BASICA']),
  inventoryAsOf: TimestampSchema,
  limitations: z.array(z.string()),
  effect: z.literal('SUGGESTION_ONLY'),
});
export const AnalysisResultSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  source: SourceSchema,
  action: AnalysisActionSchema,
  asOf: TimestampSchema,
  period: z.strictObject({ from: DateSchema, to: DateSchema }),
  limitations: z.array(z.string().max(1000)).max(100),
  locationIds: z.array(z.string()).max(100),
  labels: z
    .strictObject({
      locations: z.record(z.string(), z.string().max(220)),
      variants: z.record(z.string(), z.string().max(300)),
    })
    .optional(),
  dataset: z
    .strictObject({
      id: UuidSchema,
      workerDatasetId: z.literal('demo-femenino-seed42-v1'),
      rows: z.number().int().safe().nonnegative(),
      sha256: HashSchema,
      splits: z.record(z.string(), z.json()),
    })
    .optional(),
  model: z.strictObject({ id: UuidSchema, version: z.string(), algorithm: z.string() }).optional(),
  metrics: z.array(AnalysisMetricSchema).max(100),
  forecast: z.array(AnalysisForecastSchema).max(50000),
  suggestions: z.array(AnalysisSuggestionSchema).max(10000),
  alerts: z
    .array(
      z.strictObject({
        date: DateSchema,
        variantId: z.string(),
        locationId: z.string(),
        channel: ChannelSchema,
        score: z.number().finite(),
        threshold: z.number().finite(),
      }),
    )
    .max(500),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type AnalysisMetric = z.infer<typeof AnalysisMetricSchema>;
export const AnalysisJobViewSchema = z.strictObject({
  id: UuidSchema,
  action: AnalysisActionSchema,
  source: SourceSchema,
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'INSUFFICIENT_DATA']),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  errorCode: z.string().nullable(),
  message: z.string().nullable(),
  result: AnalysisResultSchema.nullable(),
});
export type AnalysisJobView = z.infer<typeof AnalysisJobViewSchema>;
