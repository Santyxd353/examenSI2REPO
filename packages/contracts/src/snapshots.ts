import { z } from 'zod';
import {
  ChannelSchema,
  HashSchema,
  MinorSchema,
  SafeIntegerSchema,
  ScopeSchema,
  TimestampSchema,
  UuidSchema,
} from './common';
const row = { id: UuidSchema };
const version = SafeIntegerSchema.positive();
export const SnapshotEntitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...row, kind: z.literal('CATEGORY'), name: z.string(), active: z.boolean() }),
  z.strictObject({
    ...row,
    kind: z.literal('LOCATION'),
    version,
    name: z.string(),
    type: z.enum(['TIENDA', 'ALMACEN']),
    active: z.boolean(),
    parentId: UuidSchema.nullable(),
  }),
  z.strictObject({
    ...row,
    kind: z.literal('PRODUCT'),
    version,
    name: z.string(),
    description: z.string(),
    material: z.string(),
    brand: z.string().nullable(),
    collection: z.string().nullable(),
    categoryId: UuidSchema,
    state: z.enum(['BORRADOR', 'PUBLICADO', 'RETIRADO']),
  }),
  z.strictObject({
    ...row,
    kind: z.literal('VARIANT'),
    version,
    productId: UuidSchema,
    sku: z.string(),
    barcode: z.string().nullable(),
    size: z.string(),
    color: z.string(),
    colorHex: z.string().nullable(),
    active: z.boolean(),
    prices: z.array(
      z.strictObject({
        channel: ChannelSchema,
        baseMinor: MinorSchema,
        discountBasisPoints: MinorSchema.max(10000),
        startsAt: TimestampSchema,
        endsAt: TimestampSchema.nullable(),
      }),
    ),
  }),
  z.strictObject({
    ...row,
    kind: z.literal('STOCK'),
    version,
    variantId: UuidSchema,
    locationId: UuidSchema,
    physical: MinorSchema,
    reserved: MinorSchema,
    committed: MinorSchema,
    available: MinorSchema,
  }),
]);
export type SnapshotEntity = z.infer<typeof SnapshotEntitySchema>;
export const SnapshotScopeSchema = ScopeSchema.extend({
  deviceId: UuidSchema,
  channel: ChannelSchema,
  permissions: z.array(z.string()),
  locationIds: z.array(UuidSchema),
});
export const SnapshotCoverageSchema = z.strictObject({
  complete: z.boolean(),
  truncated: z.boolean(),
  rowCount: MinorSchema.max(50000),
  totalKnownRows: MinorSchema,
  limit: z.literal(50000),
  omissions: z.array(z.string()),
});
export const SnapshotDocumentSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  snapshotId: UuidSchema,
  asOf: TimestampSchema,
  expiresAt: TimestampSchema,
  scope: SnapshotScopeSchema,
  coverage: SnapshotCoverageSchema,
  entities: z.array(SnapshotEntitySchema).max(50000),
});
export type SnapshotDocument = z.infer<typeof SnapshotDocumentSchema>;
export const SnapshotPageSchema = SnapshotDocumentSchema.extend({
  sha256: HashSchema,
  pageHash: HashSchema,
  offset: MinorSchema,
  pageSize: SafeIntegerSchema.min(1).max(500),
  nextCursor: z.string().nullable(),
});
export type SnapshotPage = z.infer<typeof SnapshotPageSchema>;
