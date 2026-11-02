import { z } from 'zod';
import { JsonRecordSchema, SourceSchema } from './common';

const JobIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);
const workDir = z
  .string()
  .max(1000)
  .refine(
    (v) =>
      /^\.local\/[A-Za-z0-9_./-]+$/.test(v) && !v.split('/').some((p) => p === '..' || p === ''),
    'El directorio debe ser relativo y privado dentro de .local.',
  );
export const AnalyticsJobSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0'),
    jobId: JobIdSchema,
    tenantId: JobIdSchema,
    actorId: JobIdSchema,
    source: SourceSchema,
    action: z.enum([
      'GENERATE_DATASET',
      'TRAIN_DEMAND',
      'TRAIN_ANOMALY',
      'FORECAST',
      'SUGGEST_RESTOCK',
    ]),
    datasetId: z.string().min(1).max(150).optional(),
    modelId: JobIdSchema.optional(),
    horizonDays: z.union([z.literal(7), z.literal(30)]).optional(),
    workDir,
    parameters: JsonRecordSchema,
    inventorySnapshot: z.array(JsonRecordSchema).max(50000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'FORECAST' && v.horizonDays === undefined)
      ctx.addIssue({ code: 'custom', message: 'FORECAST requiere horizonte.' });
    if (
      ['GENERATE_DATASET', 'TRAIN_DEMAND', 'TRAIN_ANOMALY'].includes(v.action) &&
      v.source !== 'DEMOSTRACION_SINTETICA'
    )
      ctx.addIssue({
        code: 'custom',
        message: 'La entrega no dispone de entrenamiento REAL; no sustituirlo por demo.',
      });
    if (v.datasetId !== undefined && v.datasetId !== 'demo-femenino-seed42-v1')
      ctx.addIssue({
        code: 'custom',
        message: 'Dataset no admitido por el worker demostrativo v1.',
      });
  });
export type AnalyticsJobV1 = z.infer<typeof AnalyticsJobSchema>;
export const MetricValueSchema = z
  .strictObject({
    name: z.string().min(1),
    value: z.number().finite().nullable(),
    status: z.enum(['EVALUABLE', 'NO_APLICA']),
    reason: z.string().nullable(),
    observations: z.number().int().nonnegative(),
  })
  .refine(
    (v) => (v.status === 'EVALUABLE' ? v.value !== null : v.value === null && Boolean(v.reason)),
    'Métrica N/A requiere motivo y valor nulo.',
  );
export type MetricValue = z.infer<typeof MetricValueSchema>;
