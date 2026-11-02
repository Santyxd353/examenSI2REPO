import { z } from 'zod';
import { JsonRecordSchema } from './common';

export const ApiProblemSchema = z.strictObject({
  code: z.string().min(1).max(100),
  message: z.string().min(1).max(1000),
  correlationId: z.string().min(1).max(160),
  retryable: z.boolean(),
  details: JsonRecordSchema.optional(),
});
export type ApiProblem = z.infer<typeof ApiProblemSchema>;
export const PROBLEM_STATUS = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  SUBSCRIPTION_REQUIRED: 402,
  FEATURE_NOT_INCLUDED: 403,
  CAPACITY_EXCEEDED: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_PAYLOAD_MISMATCH: 409,
  INSUFFICIENT_STOCK: 409,
  DEPENDENCY_BLOCKED: 409,
  DATASET_COVERAGE_INSUFFICIENT: 422,
  RESOURCE_INCOMPATIBLE: 422,
  PROVIDER_NOT_CONFIGURED: 503,
  MODEL_DATA_INSUFFICIENT: 422,
} as const;
