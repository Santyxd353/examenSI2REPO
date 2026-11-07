import {
  DateSchema,
  type ApiProblem,
  type ReportDataset,
  type ReportDefinition,
  type ReportFilter,
} from '@lumina/contracts';
import { boliviaDate } from './calendar';
import { matchFilter } from './filters';
const downloaded = 'DATASET_COVERAGE_INSUFFICIENT';
export const problem = (code: string, message: string): ApiProblem => ({
  code,
  message,
  correlationId: 'report:' + code,
  retryable: false,
});
export const values = (filter: ReportFilter) =>
  Array.isArray(filter.value) ? filter.value : filter.value === undefined ? [] : [filter.value];

export function scopeLocations(definition: ReportDefinition, dataset: ReportDataset) {
  const locationFilters = definition.filters.filter((filter) => filter.field === 'ubicacion');
  return locationFilters.length
    ? dataset.authorizedLocationIds.filter((id) =>
        locationFilters.every((filter) => matchFilter(id, filter)),
      )
    : [...dataset.downloadedLocationIds];
}
export function comparisonPeriod(definition: ReportDefinition) {
  if (definition.comparison) return definition.comparison;
  const filter = definition.filters.find((filter) => filter.field === 'periodo_comparacion');
  if (filter?.operator !== 'between' || !Array.isArray(filter.value)) return undefined;
  const [from, to] = filter.value;
  return typeof from === 'string' && typeof to === 'string' ? { from, to } : undefined;
}
export function coverageProblems(definition: ReportDefinition, dataset: ReportDataset) {
  const issues: ApiProblem[] = [];
  const range = (from: string, to: string) => from >= dataset.periodFrom && to <= dataset.periodTo;
  const comparison = comparisonPeriod(definition);
  if (
    !range(definition.period.from, definition.period.to) ||
    (comparison && !range(comparison.from, comparison.to))
  )
    issues.push(problem(downloaded, 'La copia local no cubre todas las fechas seleccionadas.'));
  const locationFilters = definition.filters.filter((filter) => filter.field === 'ubicacion');
  const requested = locationFilters
    .filter((filter) => filter.operator === 'eq' || filter.operator === 'in')
    .flatMap(values);
  if (
    scopeLocations(definition, dataset).some((id) => !dataset.downloadedLocationIds.includes(id)) ||
    requested.some((id) => typeof id !== 'string' || !dataset.downloadedLocationIds.includes(id))
  )
    issues.push(problem(downloaded, 'Hay ubicaciones fuera de la copia autorizada.'));
  const required = new Set([
    ...definition.metrics,
    ...definition.dimensions,
    ...definition.filters.map((filter) => filter.field),
    ...definition.dashboard.widgets.flatMap((widget) => [widget.metric, widget.dimension]),
  ]);
  for (const column of required) {
    if (!dataset.availableColumns.includes(column))
      issues.push(problem(downloaded, 'La copia no incluye el campo ' + column + '.'));
  }
  if (definition.fact === 'stock_al_corte') {
    const at = boliviaDate(dataset.asOf);
    if (definition.period.from > at || definition.period.to < at || comparison)
      issues.push(problem(downloaded, 'Stock disponible únicamente para el corte del ' + at + '.'));
  }
  for (const filter of definition.filters.filter((filter) =>
    ['dia', 'periodo', 'periodo_comparacion'].includes(filter.field),
  )) {
    const dates = values(filter);
    if (filter.operator === 'is_null') continue;
    if (dates.some((value) => !DateSchema.safeParse(value).success)) {
      issues.push(
        problem('INVALID_REPORT_FILTER', 'Usa fechas válidas AAAA-MM-DD en ' + filter.field + '.'),
      );
    } else if (dates.some((value) => !range(value as string, value as string))) {
      issues.push(problem(downloaded, 'Un filtro de fecha queda fuera del conjunto descargado.'));
    }
  }
  return issues;
}
