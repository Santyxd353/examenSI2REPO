import { UnsignedIntentSchema, type UnsignedIntent } from './offline';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function canonical(value: unknown): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return uuid.test(value) ? value.toLowerCase() : value.normalize('NFC');
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
  if (Array.isArray(value)) return value.map(canonical);
  if (
    value &&
    typeof value === 'object' &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    const result: Record<string, unknown> = Object.create(null);
    const keys = Object.keys(value)
      .map((key) => ({ key, normalized: key.normalize('NFC') }))
      .sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0));
    for (const { key, normalized } of keys) {
      if (Object.prototype.hasOwnProperty.call(result, normalized))
        throw new Error('Claves Unicode ambiguas.');
      result[normalized] = canonical((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  throw new Error('JSON canónico rechaza undefined, números no finitos y objetos no JSON.');
}
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}
export function canonicalIntentJson(unsignedIntent: UnsignedIntent): string {
  // Reject undefined/non-JSON before schema defaults could hide them.
  canonical(unsignedIntent);
  const parsed = UnsignedIntentSchema.parse(unsignedIntent);
  return canonicalJson({
    ...parsed,
    dependsOn: [...parsed.dependsOn].sort(),
    createdAt: new Date(parsed.createdAt).toISOString(),
  });
}
