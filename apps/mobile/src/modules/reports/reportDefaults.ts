import { REPORT_METRICS, type ReportDataset, type ReportDefinition } from '@lumina/contracts';
import { boliviaDate } from '@lumina/reporting';
export function defaultMobileReport(data: ReportDataset, stock = false): ReportDefinition {
  const day = boliviaDate(data.asOf);
  return {
    schemaVersion: '1.0',
    title: stock ? 'Inventario al corte' : 'Ventas de la tienda',
    source: data.source,
    datasetId: data.datasetId,
    timezone: 'America/La_Paz',
    currency: 'BOB',
    fact: stock ? 'stock_al_corte' : 'ventas_confirmadas',
    metrics: REPORT_METRICS.filter((metric) => metric.endsWith('_al_corte') === stock),
    dimensions: ['ubicacion'],
    period: {
      from: stock ? day : data.periodFrom,
      to: stock ? day : data.periodTo,
      inclusive: true,
    },
    filters: [],
    order: [],
    limit: 50,
    chart: 'bar',
    dashboard: {
      widgets: [],
      crossFilter: true,
      detailAvailableColumns: stock
        ? ['ubicacion', 'producto', 'variante', 'disponible_al_corte']
        : ['dia', 'ubicacion', 'canal', 'producto', 'unidades', 'importe_bob'],
    },
  };
}
