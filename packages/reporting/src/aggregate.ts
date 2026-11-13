import {
  canonicalJson,
  type ReportDataset,
  type ReportDefinition,
  type ReportDimension,
  type ReportGroup,
  type ReportMetric,
  type ReportResult,
  type ReportValue,
} from '@lumina/contracts';
import { comparisonPeriod, scopeLocations } from './coverage';
import { lower } from './filters';
import { decimalMinor, safeNumber, ticketMinor } from './money';
import { checkedReport } from './validate';
import { factsFor, selectedFacts, PAYMENT_FIELDS, type Fact } from './facts';
type Accumulator = {
  sales: bigint;
  units: bigint;
  orders: Set<string>;
  returned: bigint;
  refunded: bigint;
  physical: bigint;
  reserved: bigint;
  committed: bigint;
};
const accumulator = (): Accumulator => ({
  sales: 0n,
  units: 0n,
  orders: new Set(),
  returned: 0n,
  refunded: 0n,
  physical: 0n,
  reserved: 0n,
  committed: 0n,
});
function add(totals: Accumulator, fact: Fact) {
  switch (fact.kind) {
    case 'sale':
      totals.sales += BigInt(fact.amount);
      totals.units += BigInt(fact.units);
      totals.orders.add(fact.orderId);
      break;
    case 'return':
      totals.returned += BigInt(fact.units);
      break;
    case 'refund':
      totals.refunded += BigInt(fact.amount);
      break;
    case 'stock':
      totals.physical += BigInt(fact.physical);
      totals.reserved += BigInt(fact.reserved);
      totals.committed += BigInt(fact.committed);
      break;
  }
}
const numberValue = (value: bigint, unit: ReportValue['unit']): ReportValue => ({
  value: safeNumber(value),
  unit,
});
function metricValue(total: Accumulator, metric: ReportMetric): ReportValue {
  switch (metric) {
    case 'ventas_confirmadas_bob':
      return numberValue(total.sales, 'CENTAVOS');
    case 'unidades_vendidas':
      return numberValue(total.units, 'UNIDADES');
    case 'pedidos_distintos':
      return { value: total.orders.size, unit: 'PEDIDOS' };
    case 'ticket_promedio_bob': {
      const count = total.orders.size;
      return count
        ? {
            value: ticketMinor(total.sales, count),
            unit: 'CENTAVOS',
            numerator: safeNumber(total.sales),
            denominator: count,
          }
        : {
            value: null,
            unit: 'CENTAVOS',
            numerator: 0,
            denominator: 0,
            reason: 'Sin pedidos confirmados en la selección.',
          };
    }
    case 'unidades_devueltas':
      return numberValue(total.returned, 'UNIDADES');
    case 'reembolsos_confirmados_bob':
      return numberValue(total.refunded, 'CENTAVOS');
    case 'fisico_al_corte':
      return numberValue(total.physical, 'UNIDADES');
    case 'reservado_al_corte':
      return numberValue(total.reserved, 'UNIDADES');
    case 'comprometido_al_corte':
      return numberValue(total.committed, 'UNIDADES');
    case 'disponible_al_corte':
      return numberValue(total.physical - total.reserved - total.committed, 'UNIDADES');
  }
}
const relevant = (fact: Fact, metric: ReportMetric) =>
  metric.endsWith('_al_corte')
    ? fact.kind === 'stock'
    : metric === 'unidades_devueltas'
      ? fact.kind === 'return'
      : metric === 'reembolsos_confirmados_bob'
        ? fact.kind === 'refund'
        : fact.kind === 'sale';
function summarize(facts: Fact[], metrics: ReportMetric[], dimensions: ReportDimension[]) {
  const all = accumulator();
  const groups = new Map<string, { dimensions: ReportGroup['dimensions']; data: Accumulator }>();
  for (const fact of facts) {
    if (!metrics.some((metric) => relevant(fact, metric))) continue;
    add(all, fact);
    const keys = dimensions.map((dimension) => fact.dimensions[dimension] ?? null),
      key = canonicalJson(keys);
    let group = groups.get(key);
    if (!group) {
      group = {
        dimensions: Object.fromEntries(dimensions.map((dimension, i) => [dimension, keys[i]])),
        data: accumulator(),
      };
      groups.set(key, group);
    }
    add(group.data, fact);
  }
  const render = (data: Accumulator) =>
    Object.fromEntries(metrics.map((metric) => [metric, metricValue(data, metric)]));
  const results: ReportGroup[] = [...groups].map(([key, group]) => ({
    key,
    dimensions: group.dimensions,
    metrics: render(group.data),
  }));
  return { kpis: render(all), groups: results };
}
function sortGroups(groups: ReportGroup[], order: ReportDefinition['order']) {
  return groups.sort((left, right) => {
    for (const sort of order) {
      const a =
        'metric' in sort ? left.metrics[sort.metric]?.value : left.dimensions[sort.dimension];
      const b =
        'metric' in sort ? right.metrics[sort.metric]?.value : right.dimensions[sort.dimension];
      if (a == null && b == null) continue;
      if (a == null) return 1;
      if (b == null) return -1;
      const comparison = lower(a, b);
      if (comparison) return sort.direction === 'asc' ? comparison : -comparison;
    }
    return lower(left.key, right.key);
  });
}
function detailRows(facts: Fact[], definition: ReportDefinition) {
  const saleMetrics = definition.metrics.some(
    (metric) => !['unidades_devueltas', 'reembolsos_confirmados_bob'].includes(metric),
  );
  const relevantRows = facts.filter(
    (fact) =>
      definition.fact === 'stock_al_corte' ||
      (saleMetrics
        ? fact.kind === 'sale'
        : definition.metrics.some((metric) => relevant(fact, metric))),
  );
  return relevantRows
    .sort((a, b) => lower(a.day, b.day) || lower(a.id, b.id))
    .map((fact) => {
      const record: Record<string, unknown> = {
        ...fact.dimensions,
        unidades: 'units' in fact ? fact.units : null,
        importe_bob: 'amount' in fact ? decimalMinor(fact.amount) : null,
        precio_unitario: 'price' in fact ? (fact.price ?? null) : null,
      };
      if (fact.kind === 'stock')
        Object.assign(record, {
          fisico_al_corte: fact.physical,
          reservado_al_corte: fact.reserved,
          comprometido_al_corte: fact.committed,
          disponible_al_corte: fact.physical - fact.reserved - fact.committed,
        });
      const selected = definition.dashboard.detailAvailableColumns;
      return {
        id: fact.id,
        ...Object.fromEntries(
          selected
            .filter((column) => Object.hasOwn(record, column))
            .map((column) => [column, record[column] ?? null]),
        ),
      };
    });
}
export function executeReport(
  rawDefinition: ReportDefinition,
  rawDataset: ReportDataset,
): ReportResult {
  const { definition, dataset } = checkedReport(rawDefinition, rawDataset);
  const facts = selectedFacts(definition, dataset, factsFor(definition, dataset));
  const inPeriod = (from: string, to: string) =>
    facts.filter((fact) => fact.day >= from && fact.day <= to);
  const current = inPeriod(definition.period.from, definition.period.to),
    comparison = comparisonPeriod(definition);
  const { kpis, groups } = summarize(current, definition.metrics, definition.dimensions);
  const detail = detailRows(current, definition);
  const warnings = [...dataset.omittedCoverage];
  if (!dataset.complete) warnings.unshift('Resultados parciales de la copia disponible.');
  if (groups.length > definition.limit)
    warnings.push(
      `Se muestran ${definition.limit} de ${groups.length} grupos. Los totales conservan la selección completa.`,
    );
  if (
    [
      ...definition.dimensions,
      ...definition.dashboard.widgets.map((widget) => widget.dimension),
    ].some((dimension) => PAYMENT_FIELDS.has(dimension))
  )
    warnings.push(
      'Los pagos divididos aparecen en una combinación de métodos o estados por pedido.',
    );
  return {
    schemaVersion: '1.0',
    semanticsVersion: '1.0',
    source: dataset.source,
    datasetId: dataset.datasetId,
    tenantId: dataset.tenantId,
    asOf: dataset.asOf,
    definition,
    kpis,
    groups: sortGroups(groups, definition.order).slice(0, definition.limit),
    widgets: definition.dashboard.widgets.map((widget) => ({
      id: widget.id,
      groups: sortGroups(summarize(current, [widget.metric], [widget.dimension]).groups, [
        (widget.chart === 'line' || widget.chart === 'area') &&
        ['dia', 'semana', 'mes'].includes(widget.dimension)
          ? { dimension: widget.dimension, direction: 'asc' }
          : { metric: widget.metric, direction: 'desc' },
      ]).slice(0, definition.limit),
    })),
    detail: { rows: detail, total: detail.length },
    warnings,
    coverage: {
      complete: dataset.complete,
      periodFrom: dataset.periodFrom,
      periodTo: dataset.periodTo,
      locationIds: scopeLocations(definition, dataset),
      omitted: dataset.omittedCoverage,
    },
    ...(comparison
      ? {
          comparison: {
            kpis: summarize(inPeriod(comparison.from, comparison.to), definition.metrics, []).kpis,
          },
        }
      : {}),
  };
}
export function pageReportDetail(result: ReportResult, offset = 0, pageSize = 50) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 500
  )
    throw new Error('Página de detalle inválida.');
  const rows = result.detail.rows.slice(offset, offset + pageSize);
  return {
    rows,
    total: result.detail.total,
    nextOffset: offset + rows.length < result.detail.total ? offset + rows.length : null,
  };
}
