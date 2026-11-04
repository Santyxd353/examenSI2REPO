import { z } from 'zod';
import { UuidSchema } from './common';

export const StaffRoleSchema = z.enum(['Administrador', 'Vendedor', 'Analista']);
export const StaffCreateSchema = z
  .object({
    nombres: z.string().trim().min(2).max(100),
    apellidos: z.string().trim().min(2).max(120),
    correo: z.string().trim().toLowerCase().email().max(160),
    clave: z.string().min(10).max(72),
    rol: StaffRoleSchema,
    ubicaciones: z.array(UuidSchema).max(50).default([]),
  })
  .strict();
export const StaffUpdateSchema = StaffCreateSchema.partial()
  .extend({
    expectedVersion: z.number().int().positive(),
    ubicaciones: z.array(UuidSchema).max(50).optional(),
    estado: z.enum(['ACTIVO', 'SUSPENDIDO']).optional(),
    motivo: z.string().trim().min(5).max(400).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => !['expectedVersion', 'motivo'].includes(k)))
  .refine((v) => v.estado !== 'SUSPENDIDO' || !!v.motivo, {
    message: 'Indica el motivo de suspensión.',
  });

export const LocationCreateSchema = z
  .object({
    nombre: z.string().trim().min(2).max(120),
    tipo: z.enum(['TIENDA', 'ALMACEN']),
    direccion: z.string().trim().min(5).max(300).optional(),
    padreId: UuidSchema.optional(),
    responsableId: UuidSchema.optional(),
  })
  .strict();
export const LocationUpdateSchema = LocationCreateSchema.partial()
  .extend({
    // Optional only for compatibility with already distributed clients. New clients always send it.
    expectedVersion: z.number().int().positive().optional(),
    padreId: UuidSchema.nullable().optional(),
    direccion: z.string().trim().min(5).max(300).nullable().optional(),
    activa: z.boolean().optional(),
    motivo: z.string().trim().min(5).max(400).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => !['expectedVersion', 'motivo'].includes(k)))
  .refine((v) => v.expectedVersion === undefined || v.activa !== false || !!v.motivo, {
    message: 'Indica el motivo de desactivación.',
  });

export type StaffCreate = z.infer<typeof StaffCreateSchema>;
export type StaffUpdate = z.infer<typeof StaffUpdateSchema>;
export type LocationCreate = z.infer<typeof LocationCreateSchema>;
export type LocationUpdate = z.infer<typeof LocationUpdateSchema>;
