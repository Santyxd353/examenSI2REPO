import { z } from 'zod';
import { SafeIntegerSchema, UuidSchema } from './common';
import { CatalogProductSchema, CatalogProductPatchSchema } from './offline';
const base = { entityId: UuidSchema, baseVersion: SafeIntegerSchema.positive().nullable() };
export const CatalogMutationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...base,
    kind: z.literal('CATALOG_CREATE'),
    payload: z.strictObject({ product: CatalogProductSchema }),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('CATALOG_UPDATE'),
    payload: z.strictObject({ patch: CatalogProductPatchSchema }),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('CATALOG_ARCHIVE'),
    payload: z.strictObject({ reason: z.string().trim().min(3).max(400) }),
  }),
]);
export type CatalogMutation = z.infer<typeof CatalogMutationSchema>;
export const CatalogEditSchema = z.strictObject({
  baseVersion: SafeIntegerSchema.positive(),
  patch: CatalogProductPatchSchema,
});
export const CatalogArchiveSchema = z.strictObject({
  baseVersion: SafeIntegerSchema.positive(),
  reason: z.string().trim().min(3).max(400),
});
