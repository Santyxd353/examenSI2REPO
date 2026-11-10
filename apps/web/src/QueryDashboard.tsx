import { useState } from 'react';
import type { ReportChart } from '../../api/src/report-dashboard';

const palette = [
  '#693952',
  '#2d7a70',
  '#b38042',
  '#516aa0',
  '#9470a5',
  '#5c8875',
  '#b96767',
  '#7794ae',
];
const format = (n: number) => n.toLocaleString('es-BO', { maximumFractionDigits: 2 });
const short = (s: string) => (s.length > 19 ? s.slice(0, 17) + '…' : s);
const choices = {
  bar: 'Barras',
  line: 'Líneas',
  pie: 'Circular',
  donut: 'Dona',
  table: 'Tabla',
  kpi: 'Indicadores',
} as const;

export function QueryDashboard({ charts }: { charts: ReportChart[] }) {
  return (
    <section className="query-dashboard" aria-label="Dashboard de la consulta">
      <div className="generated-report-grid">
        {charts.map((chart) => (
          <ChartCard key={chart.id} chart={chart} />
        ))}
      </div>
    </section>
  );
}
function ChartCard({ chart }: { chart: ReportChart }) {
  const [type, setType] = useState(chart.defaultType);
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...chart.points.map((p) => Math.abs(p.value)));
  const min = Math.min(0, ...chart.points.map((p) => p.value));
  const sum = chart.points.reduce((n, p) => n + p.value, 0);
  const negative = chart.points.some((p) => p.value < 0);
  const x = (i: number) => 64 + (i * 480) / Math.max(1, chart.points.length - 1);
  const y = (v: number) => 210 - ((v - min) / (max - min)) * 170;
  let offset = 0;
  return (
    <article className="generated-chart">
      <header>
        <div>
          <h3>{chart.title}</h3>
          <p>{chart.description || chart.unit}</p>
        </div>
        <label className="chart-kind">
          <span className="sr-only">Tipo de gráfico</span>
          <select
            aria-label={'Tipo de gráfico · ' + chart.title}
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            {Object.entries(choices).map(([key, label]) => (
              <option
                key={key}
                value={key}
                disabled={negative && (key === 'pie' || key === 'donut')}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
      </header>
      {chart.total !== undefined && type !== 'kpi' && (
        <div className="chart-total">
          <strong>{format(chart.total)}</strong>
          <span>{chart.unit} en el alcance consultado</span>
        </div>
      )}
      {!chart.points.length ? (
        <div className="chart-empty">Sin registros con estos filtros.</div>
      ) : type === 'table' ? (
        <DataTable chart={chart} />
      ) : type === 'kpi' ? (
        <div className="generated-kpis">
          {chart.points.map((p, i) => (
            <div key={i}>
              <span>{p.label}</span>
              <strong>
                {format(p.value)} <small>{chart.unit}</small>
              </strong>
            </div>
          ))}
        </div>
      ) : type === 'bar' ? (
        <div className="horizontal-bars" role="img" aria-label={chart.title}>
          {chart.points.map((p, i) => (
            <div key={i}>
              <div className="bar-label">
                <span>{p.label}</span>
                <strong>
                  {format(p.value)} <small>{chart.unit}</small>
                </strong>
              </div>
              <div className="bar-track">
                <div
                  style={{
                    width: (Math.abs(p.value) / max) * 100 + '%',
                    background: palette[i % palette.length],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : type === 'line' ? (
        <svg className="generated-plot" viewBox="0 0 600 264" role="img" aria-label={chart.title}>
          <title>{chart.title}</title>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1="64" x2="544" y1={210 - t * 170} y2={210 - t * 170} stroke="#e9edef" />
              <text x="54" y={214 - t * 170} textAnchor="end" fontSize="11" fill="#73818a">
                {format(min + t * (max - min))}
              </text>
            </g>
          ))}
          <polyline
            fill="none"
            stroke="#693952"
            strokeWidth="3"
            points={chart.points.map((p, i) => x(i) + ',' + y(p.value)).join(' ')}
          />
          {chart.points.map((p, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.value)} r={4} fill="#693952">
                <title>{p.label + ' · ' + format(p.value) + ' ' + chart.unit}</title>
              </circle>
              {(i === 0 ||
                i === chart.points.length - 1 ||
                i === Math.floor(chart.points.length / 2)) && (
                <text x={x(i)} y="240" fontSize="11" textAnchor="middle" fill="#73818a">
                  {short(p.label)}
                </text>
              )}
            </g>
          ))}
        </svg>
      ) : sum <= 0 ? (
        <div className="chart-empty">Los valores son cero en este período.</div>
      ) : (
        <div className="distribution-chart">
          <svg viewBox="0 0 260 260" role="img" aria-label={chart.title}>
            <title>{chart.title}</title>
            {chart.points.map((p, i) => {
              const angle = (p.value / sum) * Math.PI * 2,
                start = offset;
              offset += angle;
              const a = { x: 130 + 96 * Math.cos(start), y: 130 + 96 * Math.sin(start) },
                b = { x: 130 + 96 * Math.cos(offset), y: 130 + 96 * Math.sin(offset) };
              if (type === 'donut')
                return (
                  <circle
                    key={i}
                    cx="130"
                    cy="130"
                    r="96"
                    fill="none"
                    stroke={palette[i % palette.length]}
                    strokeWidth="34"
                    strokeDasharray={(p.value / sum) * 603.186 + ' ' + 603.186}
                    strokeDashoffset={-start * 96}
                    transform="rotate(-90 130 130)"
                  >
                    <title>{p.label + ' · ' + ((p.value / sum) * 100).toFixed(1) + '%'}</title>
                  </circle>
                );
              return p.value === sum ? (
                <circle key={i} cx="130" cy="130" r="96" fill={palette[i % palette.length]} />
              ) : (
                <path
                  key={i}
                  d={
                    'M130,130 L' +
                    a.x +
                    ',' +
                    a.y +
                    ' A96,96 0 ' +
                    (angle > Math.PI ? 1 : 0) +
                    ' 1 ' +
                    b.x +
                    ',' +
                    b.y +
                    ' Z'
                  }
                  fill={palette[i % palette.length]}
                >
                  <title>{p.label + ' · ' + ((p.value / sum) * 100).toFixed(1) + '%'}</title>
                </path>
              );
            })}
          </svg>
          <ul className="chart-legend">
            {chart.points.map((p, i) => (
              <li key={i}>
                <i style={{ background: palette[i % palette.length] }} />
                <span>{p.label}</span>
                <strong>
                  {format(p.value)}{' '}
                  <small>
                    {chart.unit} · {((p.value / sum) * 100).toFixed(1)}%
                  </small>
                </strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {type !== 'table' && type !== 'kpi' && chart.points.length > 0 && (
        <>
          <button
            className="chart-values-button"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Ocultar' : 'Ver'} datos del gráfico
          </button>
          {expanded && <DataTable chart={chart} />}
        </>
      )}
    </article>
  );
}
function DataTable({ chart }: { chart: ReportChart }) {
  return (
    <div className="generated-table">
      <table>
        <thead>
          <tr>
            <th>Grupo</th>
            <th>{chart.unit}</th>
          </tr>
        </thead>
        <tbody>
          {chart.points.map((p, i) => (
            <tr key={i}>
              <td>{p.label}</td>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
