import { useMemo, useState } from 'react';
import type { AnalysisResult } from '@lumina/contracts';
import { RestockReview } from './RestockReview';

const number = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 });
const names: Record<string, string> = {
  MAE: 'Error absoluto medio',
  RMSE: 'Raíz del error cuadrático',
  WAPE: 'Error porcentual ponderado',
  PRECISION: 'Precisión',
  RECALL: 'Exhaustividad',
  F1: 'F1',
  TP: 'Verdaderos positivos',
  FP: 'Falsos positivos',
  TN: 'Verdaderos negativos',
  FN: 'Falsos negativos',
};
export function ModelResults({ result }: { result: AnalysisResult }) {
  const [location, setLocation] = useState('');
  const [from, setFrom] = useState(result.period.from);
  const [to, setTo] = useState(result.period.to);
  const [alertPage, setAlertPage] = useState(0);
  const rangeError =
    from < result.period.from || to > result.period.to || from > to || !from || !to;
  const forecast = useMemo(() => {
    if (rangeError) return [];
    const grouped = new Map<string, number>();
    for (const row of result.forecast) {
      if (row.date < from || row.date > to || (location && row.locationId !== location)) continue;
      grouped.set(row.date, (grouped.get(row.date) ?? 0) + row.predictedUnits);
    }
    return [...grouped].sort(([a], [b]) => a.localeCompare(b));
  }, [result, from, to, location, rangeError]);
  const max = Math.max(1, ...forecast.map(([, value]) => value));
  const points = forecast
    .map(
      ([, value], i) =>
        20 + (i * 660) / Math.max(1, forecast.length - 1) + ',' + (155 - (value / max) * 120),
    )
    .join(' ');
  const alerts = result.alerts.filter(
    (row) =>
      !rangeError &&
      (!location || row.locationId === location) &&
      row.date >= from &&
      row.date <= to,
  );
  const alertOffset = Math.min(alertPage, Math.max(0, Math.ceil(alerts.length / 20) - 1)) * 20;
  return (
    <section className="analysis-results" aria-label="Resultado del análisis">
      <div className="report-cut">
        <strong>
          {result.source === 'REAL' ? 'DATOS DE MI TIENDA' : 'DEMOSTRACIÓN SINTÉTICA'}
        </strong>
        <span>
          Corte {new Date(result.asOf).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}{' '}
          (Bolivia)
        </span>
        <span>
          {result.period.from} a {result.period.to}
        </span>
      </div>
      {result.limitations.map((text, i) => (
        <p className="report-warning" key={i}>
          {text}
        </p>
      ))}
      {result.dataset && (
        <article className="report-panel">
          <h2>Dataset preparado</h2>
          <p>
            <strong>{number.format(result.dataset.rows)} filas</strong> · Dataset femenino de
            demostración
          </p>
          <div className="analysis-splits">
            {Object.entries({
              train: 'Entrenamiento',
              validation: 'Validación',
              test: 'Prueba',
            }).map(([key, name]) => {
              const range = result.dataset!.splits[key] as
                | { from?: string; to?: string }
                | undefined;
              return (
                range && (
                  <div key={key}>
                    <strong>{name}</strong>
                    <span>
                      {range.from} a {range.to}
                    </span>
                  </div>
                )
              );
            })}
          </div>
        </article>
      )}
      {result.model && (
        <p className="analysis-model">
          <strong>{result.model.algorithm}</strong> · Versión {result.model.version}
        </p>
      )}
      {result.metrics.length > 0 && (
        <article className="report-panel">
          <h2>Evaluación del modelo</h2>
          <p>
            Las métricas corresponden al conjunto completo de evaluación identificado en este
            resultado.
          </p>
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    'Métrica',
                    'Partición',
                    'Horizonte',
                    'Modelo',
                    'Referencia estacional',
                    'Observaciones',
                  ].map((text) => (
                    <th key={text} scope="col">
                      {text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.metrics.map((metric) => (
                  <tr key={metric.partition + metric.name + metric.horizonDays}>
                    <th scope="row">{names[metric.name] ?? metric.name}</th>
                    <td>{metric.partition === 'PRUEBA' ? 'Prueba' : 'Validación'}</td>
                    <td>{metric.horizonDays ? metric.horizonDays + ' días' : 'Detección'}</td>
                    <td>
                      {metric.value === null
                        ? 'N/A · ' + metric.reason
                        : number.format(metric.value) + (metric.name === 'WAPE' ? ' %' : '')}
                    </td>
                    <td>
                      {metric.baseline === null
                        ? '—'
                        : number.format(metric.baseline) + (metric.name === 'WAPE' ? ' %' : '')}
                    </td>
                    <td>{number.format(metric.observations)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.metrics.some(
            (row) => row.baseline !== null && row.value !== null && row.value > row.baseline,
          ) && (
            <p className="report-warning">
              En alguna métrica de error, el modelo tiene un error mayor que la referencia
              estacional.
            </p>
          )}
        </article>
      )}
      {(result.forecast.length > 0 ||
        result.alerts.length > 0 ||
        result.suggestions.length > 0) && (
        <div className="report-panel report-fields">
          <label>
            Ubicación del resultado
            <select
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setAlertPage(0);
              }}
            >
              <option value="">Todas las incluidas en el corte</option>
              {result.locationIds.map((id) => (
                <option key={id} value={id}>
                  {result.labels?.locations[id] ?? id}
                </option>
              ))}
            </select>
          </label>
          {result.forecast.length > 0 || result.alerts.length > 0 ? (
            <>
              <label>
                Resultado desde
                <input
                  type="date"
                  value={from}
                  min={result.period.from}
                  max={result.period.to}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Resultado hasta
                <input
                  type="date"
                  value={to}
                  min={result.period.from}
                  max={result.period.to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>
      )}
      {rangeError && (
        <p className="report-warning" role="alert">
          Las fechas seleccionadas quedan fuera del corte o están invertidas. Selecciona un período
          entre {result.period.from} y {result.period.to}.
        </p>
      )}
      {result.forecast.length > 0 && !rangeError && (
        <article className="report-panel">
          <h2>Demanda prevista</h2>
          <p>
            Total previsto del período filtrado ·{' '}
            <strong>
              {number.format(forecast.reduce((sum, [, value]) => sum + value, 0))} unidades
            </strong>
          </p>
          <svg
            className="analysis-forecast"
            viewBox="0 0 700 180"
            role="img"
            aria-label="Demanda prevista por día"
          >
            {[35, 75, 115, 155].map((y) => (
              <line key={y} x1={20} x2={680} y1={y} y2={y} stroke="#eadde5" />
            ))}
            <polyline points={points} stroke="#863d63" fill="none" strokeWidth={3} />
          </svg>
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Unidades previstas</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map(([date, value]) => (
                  <tr key={date}>
                    <th scope="row">{date}</th>
                    <td>{number.format(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!forecast.length && (
            <p>No hay predicciones dentro de las fechas y ubicaciones seleccionadas.</p>
          )}
        </article>
      )}
      <RestockReview result={result} location={location} />
      {result.alerts.length > 0 && (
        <article className="report-panel">
          <h2>Anomalías propuestas</h2>
          <p>
            Muestra de hasta 500 observaciones con mayor puntuación del dataset. Revisa cada caso.
          </p>
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  {['Fecha', 'Variante', 'Ubicación', 'Canal', 'Puntuación', 'Umbral'].map(
                    (text) => (
                      <th key={text} scope="col">
                        {text}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {alerts.slice(alertOffset, alertOffset + 20).map((row) => (
                  <tr key={row.date + row.variantId + row.locationId + row.channel}>
                    <td>{row.date}</td>
                    <td>{result.labels?.variants[row.variantId] ?? row.variantId}</td>
                    <td>{result.labels?.locations[row.locationId] ?? row.locationId}</td>
                    <td>{row.channel}</td>
                    <td>{number.format(row.score)}</td>
                    <td>{number.format(row.threshold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="report-toolbar">
            <button
              className="secondary"
              disabled={!alertOffset}
              onClick={() => setAlertPage(alertPage - 1)}
            >
              Anomalías anteriores
            </button>
            <span>
              {alerts.length ? alertOffset + 1 : 0}–{Math.min(alertOffset + 20, alerts.length)} de{' '}
              {alerts.length}
            </span>
            <button
              className="secondary"
              disabled={alertOffset + 20 >= alerts.length}
              onClick={() => setAlertPage(alertPage + 1)}
            >
              Anomalías siguientes
            </button>
          </div>
        </article>
      )}
    </section>
  );
}
