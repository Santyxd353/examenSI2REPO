import { z } from 'zod';
import { UuidSchema, SafeIntegerSchema } from './common';

const reason = z.string().trim().min(3).max(400);
export const StockDeltaInputSchema = z.strictObject({
  variantId: UuidSchema,
  locationId: UuidSchema,
  deltaFisico: SafeIntegerSchema.min(-1000000)
    .max(1000000)
    .refine((value) => value !== 0),
  reason,
});
// Only the historical online endpoint admits zero for inventory not yet created.
export const StockCountInputSchema = z.strictObject({
  variantId: UuidSchema,
  locationId: UuidSchema,
  observedPhysical: SafeIntegerSchema.min(0).max(1000000),
  baseVersion: SafeIntegerSchema.min(0),
  reason,
});
export const StockTransferInputSchema = z
  .strictObject({
    variantId: UuidSchema,
    originId: UuidSchema,
    targetId: UuidSchema,
    quantity: SafeIntegerSchema.min(1).max(1000000),
    reason,
  })
  .refine((value) => value.originId !== value.targetId, 'Las ubicaciones deben ser distintas.');
// Keep the existing Spanish wire names. The pair is optional only for old APKs.
export const OnlineTransferSchema = z
  .strictObject({
    origenId: UuidSchema,
    destinoId: UuidSchema,
    varianteId: UuidSchema,
    cantidad: SafeIntegerSchema.min(1).max(100000),
    motivo: z.string().trim().min(5).max(400),
    operationId: UuidSchema.optional(),
    deviceId: UuidSchema.optional(),
  })
  .refine(
    (value) => value.origenId !== value.destinoId,
    'El origen y el destino deben ser diferentes.',
  )
  .refine(
    (value) => Boolean(value.operationId) === Boolean(value.deviceId),
    'Envía operationId y deviceId juntos.',
  );
export type OnlineTransfer = z.infer<typeof OnlineTransferSchema>;
