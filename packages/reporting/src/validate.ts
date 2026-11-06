import {
  ReportDatasetSchema,
  ReportDefinitionSchema,
  type ApiProblem,
  type ReportDataset,
  type ReportDefinition,
  type ValidationResult,
} from '@lumina/contracts';
import { coverageProblems, problem, values } from './coverage';
const STOCK_UNSUPPORTED = new Set([
  'dia',
  'semana',
  'mes',
  'periodo',
  'periodo_comparacion',
  'vendedor',
  'estado_pedido',
  'estado_pago',
  'metodo_pago',
  'con_devolucion',
  'precio_unitario',
]);

export class ReportError extends Error {
  constructor(public readonly problems: ApiProblem[]) {
    super(problems[0]?.message ?? 'El reporte no está disponible.');
    this.name = 'ReportError';
  }
}
export function checkedReport(rawDefinition: ReportDefinition, rawDataset: ReportDataset) {
  const parsedDefinition = ReportDefinitionSchema.safeParse(rawDefinition),
    parsedDataset = ReportDatasetSchema.safeParse(rawDataset);
  const errors: ApiProblem[] = [];
  if (!parsedDefinition.success)
    errors.push(problem('INVALID_REPORT_DEFINITION', parsedDefinition.error.issues[0].message));
  if (!parsedDataset.success)
    errors.push(problem('INVALID_REPORT_DATASET', parsedDataset.error.issues[0].message));
  if (!parsedDefinition.success || !parsedDataset.success) throw new ReportError(errors);
  const definition = parsedDefinition.data,
    dataset = parsedDataset.data;
  if (definition.datasetId !== dataset.datasetId || definition.source !== dataset.source)
    errors.push(
      problem(
        'DATASET_SCOPE_MISMATCH',
        'La fuente o el identificador del reporte no coincide con la copia.',
      ),
    );
  const locations = new Set(dataset.downloadedLocationIds);
  if (
    new Set(dataset.stock.map((row) => JSON.stringify([row.variantId, row.locationId]))).size !==
    dataset.stock.length
  )
    errors.push(
      problem(
        'INVALID_REPORT_DATASET',
        'El stock contiene más de un saldo por variante y ubicación.',
      ),
    );
  if (
    dataset.stock.some((row) => !locations.has(row.locationId)) ||
    [dataset.sales, dataset.orders, dataset.returns, dataset.refunds].some((rows) =>
      rows.some(
        (row) =>
          typeof row.dimensions.ubicacion === 'string' && !locations.has(row.dimensions.ubicacion),
      ),
    )
  )
    errors.push(
      problem('DATASET_SCOPE_MISMATCH', 'Un hecho pertenece a una ubicación fuera de la copia.'),
    );
  if (
    definition.fact === 'stock_al_corte' &&
    (definition.filters.some((filter) => STOCK_UNSUPPORTED.has(filter.field)) ||
      definition.dashboard.widgets.some((widget) => STOCK_UNSUPPORTED.has(widget.dimension)))
  )
    errors.push(
      problem(
        'INCOMPATIBLE_REPORT_GRAIN',
        'Stock al corte requiere filtros y dimensiones de inventario.',
      ),
    );
  if (
    definition.fact === 'ventas_confirmadas' &&
    definition.filters.some((filter) => filter.field === 'disponible_al_corte')
  )
    errors.push(
      problem(
        'INCOMPATIBLE_REPORT_GRAIN',
        'El stock al corte se consulta en un reporte de inventario.',
      ),
    );
  const comparisons = definition.filters.filter((filter) => filter.field === 'periodo_comparacion');
  if (
    comparisons.length > 1 ||
    comparisons.some((filter) => filter.operator !== 'between') ||
    (comparisons.length &&
      definition.comparison &&
      (values(comparisons[0])[0] !== definition.comparison.from ||
        values(comparisons[0])[1] !== definition.comparison.to))
  )
    errors.push(
      problem('INVALID_REPORT_FILTER', 'Usa un único período de comparación consistente.'),
    );
  for (const filter of definition.filters) {
    const [first, second] = values(filter);
    if (
      filter.operator === 'between' &&
      ((typeof first === 'number' && typeof second === 'number' && first > second) ||
        (typeof first === 'string' && typeof second === 'string' && first > second))
    )
      errors.push(
        problem(
          'INVALID_REPORT_FILTER',
          'El rango del filtro ' + filter.field + ' está invertido.',
        ),
      );
  }
  errors.push(...coverageProblems(definition, dataset));
  if (errors.length) throw new ReportError(errors);
  return { definition, dataset };
}
export function validateReport(
  definition: ReportDefinition,
  dataset: ReportDataset,
): ValidationResult {
  try {
    checkedReport(definition, dataset);
    return { ok: true };
  } catch (error) {
    if (error instanceof ReportError) return { ok: false, problems: error.problems };
    throw error;
  }
}
