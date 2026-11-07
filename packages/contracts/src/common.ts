import { z } from 'zod';

export const SCHEMA_VERSION = '1.0' as const;
export const SEMANTICS_VERSION = '1.0' as const;
export const UuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const TimestampSchema = z.iso.datetime({ offset: true });
export const SafeIntegerSchema = z.number().int().safe();
export const MinorSchema = SafeIntegerSchema.nonnegative();
export const SourceSchema = z.enum(['REAL', 'DEMOSTRACION_SINTETICA']);
export const ChannelSchema = z.enum(['WEB', 'APP', 'TIENDA']);
export const ScopeSchema = z.strictObject({ tenantId: UuidSchema, actorId: UuidSchema });
export type ScopeKey = z.infer<typeof ScopeSchema>;
export type DataSource = z.infer<typeof SourceSchema>;
export const JsonRecordSchema = z.record(z.string(), z.json());

export function moneyToMinor(decimal: string): number {
  if (typeof decimal !== 'string' || !/^-?(0|[1-9]\d*)(\.\d{1,2})?$/.test(decimal))
    throw new Error('Importe decimal inválido: usar hasta dos decimales, sin exponente.');
  const negative = decimal.startsWith('-');
  const [whole, fraction = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Importe fuera del rango seguro.');
  return negative && cents !== 0 ? -cents : cents;
}

export function minorToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Los centavos deben ser un entero seguro.');
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
