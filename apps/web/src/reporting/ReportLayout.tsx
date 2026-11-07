import {
  REPORT_DIMENSIONS,
  REPORT_METRICS,
  type ReportDataset,
  type ReportDefinition,
  type ReportDimension,
  type ReportMetric,
} from '@lumina/contracts';
import { boliviaDate } from '@lumina/reporting';
import { fields } from './report-data';

const charts = { bar: 'Barras', line: 'Línea', area: 'Área', donut: 'Anillo', table: 'Tabla' };
const stockDimensions = [
  'ubicacion',
  'categoria',
  'marca',
  'producto',
  'variante',
  'talla',
  'color',
];
const detailColumns = [
  'dia',
  'ubicacion',
  'canal',
  'producto',
  'variante',
  'talla',
  'unidades',
  'importe_bob',
];
const inventoryColumns = [
  'ubicacion',
  'producto',
  'variante',
  'fisico_al_corte',
  'reservado_al_corte',
  'comprometido_al_corte',
  'disponible_al_corte',
];
const standardMetrics = REPORT_METRICS.slice(0, 4);

export function defaultReport(data: ReportDataset, stock = false): ReportDefinition {
  const at = boliviaDate(data.asOf);
  return {
    schemaVersion: '1.0',
    title: stock ? 'Inventario al corte' : 'Ventas de la tienda',
    source: data.source,
    datasetId: data.datasetId,
    timezone: 'America/La_Paz',
    currency: 'BOB',
    fact: stock ? 'stock_al_corte' : 'ventas_confirmadas',
    period: { from: stock ? at : data.periodFrom, to: stock ? at : data.periodTo, inclusive: true },
    metrics: stock
      ? REPORT_METRICS.filter((key) => key.endsWith('_al_corte'))
      : [...standardMetrics],
    dimensions: data.availableColumns.includes('categoria') ? ['categoria'] : [],
    filters: [],
    order: [],
    chart: 'bar',
    limit: 12,
    dashboard: {
      widgets: [],
      crossFilter: true,
      detailAvailableColumns: (stock ? inventoryColumns : detailColumns).filter((key) =>
        data.availableColumns.includes(key),
      ),
    },
  };
}

export function ReportLayout({
  data,
  draft,
  change,
}: {
  data: ReportDataset;
  draft: ReportDefinition;
  change: (update: Partial<ReportDefinition>) => void;
}) {
  const stock = draft.fact === 'stock_al_corte';
  const metrics = REPORT_METRICS.filter(
    (key) => key.endsWith('_al_corte') === stock && data.availableColumns.includes(key),
  );
  const dimensions = REPORT_DIMENSIONS.filter(
    (key) => (!stock || stockDimensions.includes(key)) && data.availableColumns.includes(key),
  );
  const at = boliviaDate(data.asOf);
  const stockAvailable = data.periodFrom <= at && at <= data.periodTo;
  const widgets = draft.dashboard.widgets;
  const setWidgets = (next: typeof widgets) =>
    change({ dashboard: { ...draft.dashboard, widgets: next } });
  const comparison = draft.comparison;
  return (
    <>
      <fieldset>
        <legend>Período y contenido</legend>
        <div className="report-fields">
          <label>
            Título
            <input
              required
              maxLength={200}
              value={draft.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          <label>
            Conjunto de métricas
            <select
              value={draft.fact}
              onChange={(e) => change(defaultReport(data, e.target.value === 'stock_al_corte'))}
            >
              <option value="ventas_confirmadas">Ventas, devoluciones y reembolsos</option>
              <option value="stock_al_corte" disabled={!stockAvailable}>
                Inventario al corte
              </option>
            </select>
          </label>
          <label>
            Desde
            <input
              type="date"
              required
              value={draft.period.from}
              min={data.periodFrom}
              max={data.periodTo}
              disabled={stock}
              onChange={(e) => change({ period: { ...draft.period, from: e.target.value } })}
            />
          </label>
          <label>
            Hasta
            <input
              type="date"
              required
              value={draft.period.to}
              min={data.periodFrom}
              max={data.periodTo}
              disabled={stock}
              onChange={(e) => change({ period: { ...draft.period, to: e.target.value } })}
            />
          </label>
          <label>
            Gráfico
            <select
              value={draft.chart}
              onChange={(e) => change({ chart: e.target.value as ReportDefinition['chart'] })}
            >
              {Object.entries(charts).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Grupos visibles
            <input
              required
              type="number"
              min={1}
              max={1000}
              value={draft.limit || ''}
              onChange={(e) => change({ limit: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="report-choices">
          <div role="group" aria-label="Métricas">
            <strong>Métricas</strong>
            {metrics.map((metric) => (
              <label key={metric}>
                <input
                  type="checkbox"
                  checked={draft.metrics.includes(metric)}
                  disabled={draft.metrics.length === 1 && draft.metrics.includes(metric)}
                  onChange={(e) =>
                    change({
                      metrics: e.target.checked
                        ? [...draft.metrics, metric]
                        : draft.metrics.filter((value) => value !== metric),
                      order: [],
                    })
                  }
                />
                {fields[metric]}
              </label>
            ))}
          </div>
          <div role="group" aria-label="Dimensiones">
            <strong>Agrupar por</strong>
            {dimensions.map((dimension) => (
              <label key={dimension}>
                <input
                  type="checkbox"
                  checked={draft.dimensions.includes(dimension)}
                  disabled={draft.dimensions.length === 5 && !draft.dimensions.includes(dimension)}
                  onChange={(e) =>
                    change({
                      dimensions: e.target.checked
                        ? [...draft.dimensions, dimension]
                        : draft.dimensions.filter((value) => value !== dimension),
                      order: [],
                    })
                  }
                />
                {fields[dimension]}
              </label>
            ))}
          </div>
        </div>
        <div className="report-fields">
          <label>
            Orden
            <select
              value={draft.order.length ? JSON.stringify(draft.order[0]) : ''}
              onChange={(e) =>
                change({ order: e.target.value ? [JSON.parse(e.target.value)] : [] })
              }
            >
              <option value="">Predeterminado</option>
              {draft.metrics.map((metric) => (
                <option key={metric} value={JSON.stringify({ metric, direction: 'desc' })}>
                  {fields[metric]} ↓
                </option>
              ))}
              {draft.dimensions.map((dimension) => (
                <option key={dimension} value={JSON.stringify({ dimension, direction: 'asc' })}>
                  {fields[dimension]} ↑
                </option>
              ))}
            </select>
          </label>
          {!stock && (
            <label className="report-check">
              <input
                type="checkbox"
                checked={Boolean(comparison)}
                onChange={(e) =>
                  change({
                    comparison: e.target.checked
                      ? {
                          from: data.periodFrom,
                          to: data.periodTo,
                          mode: 'custom',
                          requiresCoverage: true,
                        }
                      : undefined,
                    filters: draft.filters.filter(
                      (filter) => filter.field !== 'periodo_comparacion',
                    ),
                  })
                }
              />
              Comparar períodos
            </label>
          )}
          {comparison && (
            <>
              <label>
                Comparación desde
                <input
                  type="date"
                  required
                  value={comparison.from}
                  min={data.periodFrom}
                  max={data.periodTo}
                  onChange={(e) => change({ comparison: { ...comparison, from: e.target.value } })}
                />
              </label>
              <label>
                Comparación hasta
                <input
                  type="date"
                  required
                  value={comparison.to}
                  min={data.periodFrom}
                  max={data.periodTo}
                  onChange={(e) => change({ comparison: { ...comparison, to: e.target.value } })}
                />
              </label>
            </>
          )}
        </div>
      </fieldset>
      <fieldset>
        <legend>Interacción y gráficos adicionales</legend>
        <label className="report-check">
          <input
            type="checkbox"
            checked={draft.dashboard.crossFilter}
            onChange={(e) =>
              change({ dashboard: { ...draft.dashboard, crossFilter: e.target.checked } })
            }
          />
          Filtrar al seleccionar un grupo del dashboard
        </label>
        {widgets.map((widget, index) => (
          <div className="report-fields" key={widget.id}>
            <label>
              Métrica del gráfico {index + 1}
              <select
                value={widget.metric}
                onChange={(e) =>
                  setWidgets(
                    widgets.map((w) =>
                      w.id === widget.id ? { ...w, metric: e.target.value as ReportMetric } : w,
                    ),
                  )
                }
              >
                {metrics.map((metric) => (
                  <option key={metric} value={metric}>
                    {fields[metric]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Agrupación del gráfico {index + 1}
              <select
                value={widget.dimension}
                onChange={(e) =>
                  setWidgets(
                    widgets.map((w) =>
                      w.id === widget.id
                        ? { ...w, dimension: e.target.value as ReportDimension }
                        : w,
                    ),
                  )
                }
              >
                {dimensions.map((dimension) => (
                  <option key={dimension} value={dimension}>
                    {fields[dimension]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tipo del gráfico {index + 1}
              <select
                value={widget.chart}
                onChange={(e) =>
                  setWidgets(
                    widgets.map((w) =>
                      w.id === widget.id
                        ? { ...w, chart: e.target.value as ReportDefinition['chart'] }
                        : w,
                    ),
                  )
                }
              >
                {Object.entries(charts).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => setWidgets(widgets.filter((w) => w.id !== widget.id))}
            >
              Quitar gráfico {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          disabled={widgets.length >= 16 || !dimensions.length || !metrics.length}
          onClick={() =>
            setWidgets([
              ...widgets,
              {
                id: crypto.randomUUID(),
                chart: 'bar',
                dimension: dimensions[0],
                metric: metrics[0],
              },
            ])
          }
        >
          Añadir gráfico
        </button>
      </fieldset>
    </>
  );
}
