import { z } from 'zod';
import { ApiProblemSchema } from './problems';
import { EntitlementsSchema } from './billing';
import {
  ChannelSchema,
  HashSchema,
  JsonRecordSchema,
  MinorSchema,
  SafeIntegerSchema,
  ScopeSchema,
  TimestampSchema,
  UuidSchema,
} from './common';

export const OPERATION_KINDS = [
  'CATALOG_CREATE',
  'CATALOG_UPDATE',
  'CATALOG_ARCHIVE',
  'STOCK_DELTA',
  'STOCK_COUNT',
] as const;
export const LocalStateSchema = z.enum([
  'PENDING',
  'SENDING',
  'APPLIED',
  'CONFLICT',
  'BLOCKED',
  'DISCARDED',
]);
export type LocalState = z.infer<typeof LocalStateSchema>;
export type OperationKind = (typeof OPERATION_KINDS)[number];
export const ResourceReferenceSchema = z.strictObject({
  clientResourceId: UuidSchema,
  variantId: UuidSchema.optional(),
  sha256: HashSchema,
  bytes: MinorSchema.positive().max(50 * 1024 * 1024),
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp', 'model/gltf-binary']),
  usage: z.enum(['GALLERY', 'ANDROID_AR', 'WEB_3D']),
  license: z.string().trim().min(3).max(255),
});
export const DiscountWindowSchema = z
  .strictObject({
    basisPoints: SafeIntegerSchema.min(1).max(10000),
    startsAt: TimestampSchema,
    endsAt: TimestampSchema,
  })
  .refine(
    (value) => new Date(value.startsAt) < new Date(value.endsAt),
    'El descuento necesita una vigencia positiva.',
  );
export const CatalogVariantSchema = z.strictObject({
  id: UuidSchema,
  sku: z.string().trim().min(1).max(60),
  barcode: z.string().trim().min(1).max(80).nullable().optional(),
  talla: z.string().trim().min(1).max(20),
  color: z.string().trim().min(1).max(50),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  prices: z.strictObject({
    WEB: MinorSchema.positive().max(100000000),
    APP: MinorSchema.positive().max(100000000),
    TIENDA: MinorSchema.positive().max(100000000),
  }),
  discounts: z
    .strictObject({
      WEB: DiscountWindowSchema.optional(),
      APP: DiscountWindowSchema.optional(),
      TIENDA: DiscountWindowSchema.optional(),
    })
    .optional(),
  active: z.boolean().default(true),
  baseVersion: SafeIntegerSchema.positive().nullable().default(null),
});
export const CatalogProductSchema = z.strictObject({
  id: UuidSchema,
  nombre: z.string().trim().min(2).max(160),
  descripcion: z.string().trim().min(1).max(3000),
  material: z.string().trim().min(2).max(150),
  marca: z.string().trim().min(2).max(100),
  coleccion: z.string().trim().max(100).nullable().optional(),
  categoriaId: UuidSchema,
  variants: z.array(CatalogVariantSchema).min(1).max(100),
  resources: z.array(ResourceReferenceSchema).max(30).default([]),
});
export const CatalogProductPatchSchema = CatalogProductSchema.omit({ id: true })
  .extend({
    estado: z.enum(['BORRADOR', 'PUBLICADO']),
    resources: z.array(ResourceReferenceSchema).max(30).optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'El parche está vacío.');
const base = ScopeSchema.extend({
  schemaVersion: z.literal('1.0'),
  operationId: UuidSchema,
  deviceId: UuidSchema,
  entityId: UuidSchema,
  baseVersion: SafeIntegerSchema.positive().nullable(),
  dependsOn: z.array(UuidSchema).max(100),
  createdAt: TimestampSchema,
});
const reason = z.string().trim().min(3).max(400);
const union = z.discriminatedUnion('kind', [
  base.extend({
    kind: z.literal('CATALOG_CREATE'),
    payload: z.strictObject({ product: CatalogProductSchema }),
  }),
  base.extend({
    kind: z.literal('CATALOG_UPDATE'),
    payload: z.strictObject({ patch: CatalogProductPatchSchema }),
  }),
  base.extend({ kind: z.literal('CATALOG_ARCHIVE'), payload: z.strictObject({ reason }) }),
  base.extend({
    kind: z.literal('STOCK_DELTA'),
    payload: z.strictObject({
      variantId: UuidSchema,
      locationId: UuidSchema,
      deltaFisico: SafeIntegerSchema.min(-1000000)
        .max(1000000)
        .refine((n) => n !== 0),
      reason,
    }),
  }),
  base.extend({
    kind: z.literal('STOCK_COUNT'),
    payload: z.strictObject({
      variantId: UuidSchema,
      locationId: UuidSchema,
      observedPhysical: MinorSchema.max(1000000),
      reason,
    }),
  }),
]);
function checkIntent(value: z.infer<typeof union>, ctx: z.RefinementCtx) {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (
    new Set(value.dependsOn).size !== value.dependsOn.length ||
    value.dependsOn.includes(value.operationId)
  )
    fail('Dependencias repetidas o circular propia.');
  if (
    value.kind === 'CATALOG_CREATE' &&
    (value.baseVersion !== null || value.entityId !== value.payload.product.id)
  )
    fail('Alta requiere versión nula e identidad de producto coincidente.');
  if (
    ['CATALOG_UPDATE', 'CATALOG_ARCHIVE'].includes(value.kind) &&
    value.baseVersion === null &&
    !value.dependsOn.length
  )
    fail('Edición requiere versión o dependencia de su alta.');
  if (value.kind === 'STOCK_COUNT' && value.baseVersion === null)
    fail('Conteo requiere versión confirmada.');
  if (
    value.kind === 'CATALOG_CREATE' &&
    new Set(value.payload.product.variants.map((v) => v.id)).size !==
      value.payload.product.variants.length
  )
    fail('Variantes repetidas.');
}
export const UnsignedIntentSchema = union.superRefine(checkIntent);
export const OfflineIntentSchema = z
  .discriminatedUnion('kind', [
    union.options[0].extend({ payloadHash: HashSchema }),
    union.options[1].extend({ payloadHash: HashSchema }),
    union.options[2].extend({ payloadHash: HashSchema }),
    union.options[3].extend({ payloadHash: HashSchema }),
    union.options[4].extend({ payloadHash: HashSchema }),
  ])
  .superRefine(checkIntent);
export type UnsignedIntent = z.infer<typeof UnsignedIntentSchema>;
export type OfflineIntent = z.infer<typeof OfflineIntentSchema>;
export const OperationReceiptSchema = ScopeSchema.extend({
  operationId: UuidSchema,
  deviceId: UuidSchema,
  payloadHash: HashSchema,
  status: z.enum(['APPLIED', 'CONFLICT', 'REJECTED']),
  result: JsonRecordSchema,
  entityId: UuidSchema,
  confirmedVersion: SafeIntegerSchema.positive().nullable(),
  committedAt: TimestampSchema,
  correlationId: z.string().min(1).max(160),
});
export type OperationReceipt = z.infer<typeof OperationReceiptSchema>;
export const SyncOperationResultSchema = z
  .strictObject({
    operationId: UuidSchema,
    receipt: OperationReceiptSchema.optional(),
    blocked: ApiProblemSchema.optional(),
  })
  .refine(
    (v) => Boolean(v.receipt) !== Boolean(v.blocked),
    'Un resultado requiere recibo o bloqueo, exclusivamente.',
  );
export type SyncOperationResult = z.infer<typeof SyncOperationResultSchema>;
export const SyncBatchSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  operations: z.array(OfflineIntentSchema).min(1).max(100),
});
export type SyncSummary = {
  attempted: number;
  applied: number;
  conflicts: number;
  rejected: number;
  blocked: number;
  pending: number;
  nextRetryAt: string | null;
  results: SyncOperationResult[];
};

function base64(bytes: number | null) {
  return z
    .string()
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
    .refine((value) => {
      const len = (value.length * 3) / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
      return bytes === null ? len > 0 : len === bytes;
    }, 'Base64 de longitud inválida.');
}
export const VaultEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  algorithm: z.literal('A256GCM'),
  keyVersion: SafeIntegerSchema.positive(),
  nonce: base64(12),
  ciphertext: base64(null),
  tag: base64(16),
  aad: z.string().min(1).max(2000),
});
export type VaultEnvelope = z.infer<typeof VaultEnvelopeSchema>;
export const BootstrapRequestSchema = z.strictObject({ deviceId: UuidSchema });
export const BootstrapResponseSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0'),
    tenantId: UuidSchema,
    actorId: UuidSchema,
    deviceId: UuidSchema,
    keyVersion: SafeIntegerSchema.positive(),
    keyBase64: base64(32),
    permissions: z.array(z.string().min(1).max(100)).max(1000),
    locationIds: z.array(UuidSchema),
    entitlements: EntitlementsSchema,
    issuedAt: TimestampSchema,
  })
  .refine(
    (value) => value.tenantId === value.entitlements.tenantId,
    'El plan pertenece a otra tienda.',
  );
export type OfflineBootstrap = z.infer<typeof BootstrapResponseSchema>;
export const DownloadStatusSchema = z.strictObject({
  packageId: UuidSchema,
  state: z.enum(['NOT_DOWNLOADED', 'DOWNLOADING', 'PARTIAL', 'READY', 'ERROR']),
  bytesVerified: MinorSchema,
  bytesExpected: MinorSchema,
  readyItems: MinorSchema.max(10),
  expectedItems: MinorSchema.max(10),
  problem: ApiProblemSchema.optional(),
});
export type DownloadStatus = z.infer<typeof DownloadStatusSchema>;
export const OutfitManifestSchema = z
  .strictObject({
    packageId: UuidSchema,
    tenantId: UuidSchema,
    ownerId: UuidSchema,
    platform: z.enum(['WEB_3D', 'ANDROID_AR']),
    createdAt: TimestampSchema,
    manifestVersion: z.literal('1.0'),
    preferencesBasis: z.string().max(1000),
    garmentCount: MinorSchema.max(10),
    state: z.enum(['COMPLETO', 'PARCIAL']),
    garments: z
      .array(
        z.strictObject({
          productId: UuidSchema,
          variantId: UuidSchema,
          catalogVersion: SafeIntegerSchema.positive(),
          resourceId: UuidSchema,
          resourceVersion: SafeIntegerSchema.positive(),
          format: z.enum(['GLB', 'PNG']),
          privateDownloadUrl: z.string().min(1).max(2000),
          bytes: MinorSchema.positive(),
          sha256: HashSchema,
          compatibility: z.string().min(1).max(200),
          license: z.string().min(1).max(255),
          required: z.boolean(),
          placement: JsonRecordSchema.optional(),
        }),
      )
      .max(10),
    optionalOwnAvatar: z
      .strictObject({
        avatarId: UuidSchema,
        version: SafeIntegerSchema.positive(),
        sha256: HashSchema,
        bytes: MinorSchema.positive(),
        privateDownloadUrl: z.string().min(1).max(2000),
        consented: z.literal(true),
      })
      .nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.garmentCount !== v.garments.length)
      ctx.addIssue({ code: 'custom', message: 'Recuento de prendas inconsistente.' });
    if (v.garments.some((g) => g.format !== (v.platform === 'WEB_3D' ? 'GLB' : 'PNG')))
      ctx.addIssue({ code: 'custom', message: 'Formato incompatible con la plataforma.' });
    if (v.platform === 'ANDROID_AR' && v.optionalOwnAvatar)
      ctx.addIssue({ code: 'custom', message: 'Avatar GLB solo para vestidor web.' });
  });
export type OutfitManifest = z.infer<typeof OutfitManifestSchema>;
