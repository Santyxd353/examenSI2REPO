import {
  ReportDefinitionSchema,
  type CrossFilterSelection,
  type ReportDefinition,
  type ReportFilter,
} from '@lumina/contracts';

export type Scalar = string | number | boolean | null;
export const lower = (left: string | number, right: string | number) =>
  left < right ? -1 : left > right ? 1 : 0;
export function matchFilter(value: Scalar, filter: ReportFilter) {
  if (filter.operator === 'is_null') return (value === null) === (filter.value ?? true);
  if (value === null) return false;
  const test = filter.value;
  switch (filter.operator) {
    case 'eq':
      return value === test;
    case 'neq':
      return value !== test;
    case 'in':
      return Array.isArray(test) && test.includes(value);
    case 'not_in':
      return Array.isArray(test) && !test.includes(value);
    case 'gte':
      return (
        (typeof value === 'number' || typeof value === 'string') &&
        typeof value === typeof test &&
        lower(value, test as string | number) >= 0
      );
    case 'lte':
      return (
        (typeof value === 'number' || typeof value === 'string') &&
        typeof value === typeof test &&
        lower(value, test as string | number) <= 0
      );
    case 'between':
      return (
        Array.isArray(test) &&
        (typeof value === 'number' || typeof value === 'string') &&
        typeof value === typeof test[0] &&
        typeof value === typeof test[1] &&
        lower(value, test[0] as string | number) >= 0 &&
        lower(value, test[1] as string | number) <= 0
      );
  }
}

export function applyCrossFilter(definition: ReportDefinition, selection: CrossFilterSelection) {
  const base = ReportDefinitionSchema.parse(definition);
  if (!selection) return base;
  if (!base.dashboard.crossFilter)
    throw new Error('El diseño tiene desactivada la selección cruzada.');
  const matching = base.filters.some(
    (filter) =>
      filter.field === selection.dimension &&
      filter.operator === 'eq' &&
      filter.value === selection.value,
  );
  if (matching) return base;
  return ReportDefinitionSchema.parse({
    ...base,
    filters: [
      ...base.filters,
      { field: selection.dimension, operator: 'eq', value: selection.value },
    ],
  });
}
