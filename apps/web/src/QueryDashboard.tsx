import { useState } from 'react';
import type { ReportChart } from '../../api/src/report-dashboard';

export function QueryDashboard({ charts }: { charts: ReportChart[] }) {
  const [selected, select] = useState(charts[0]?.id || '');
  const chart = charts.find((item) => item.id === selected) || charts[0];
  const [choice, choose] = useState('');
  if (!chart) return null;
  const kind = choice || chart.defaultType;
  const max = Math.max(1, ...chart.points.map((p) => Math.abs(p.value)));
  const total = chart.points.reduce((sum, p) => sum + p.value, 0);
  const colors = ['#703951', '#286b61', '#a96a34', '#526aa3', '#8a5798'];
  const x = (i: number) => 30 + (i * 540) / Math.max(1, chart.points.length - 1);
  const min = Math.min(0, ...chart.points.map(p => p.value));
  const y = (v: number) => 200 - ((v - min) / (max - min)) * 170;
  let offset = 0;
  return (
    <section className="query-dashboard" aria-label="Dashboard de la consulta">
      <div className="query-chart-tabs">
        {charts.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={chart.id === item.id}
            onClick={() => {
              select(item.id);
              choose('');
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      <h3>{chart.title}</h3>
      <label>
        Tipo de gráfico{' '}
        <select value={kind} onChange={(e) => choose(e.target.value)}>
          <option value="bar">Barras</option>
          <option value="line">Líneas</option>
          <option value="donut" disabled={chart.points.some((p) => p.value < 0)}>
            Dona
          </option>
        </select>
      </label>
      {!chart.points.length || chart.points.every((p) => p.value === 0) ? (
        <p>Sin datos para graficar en este período.</p>
      ) : (
        <svg
          viewBox="0 0 600 230"
          role="img"
          aria-label={chart.title + ', valores en ' + chart.unit}
        >
          <title>{chart.title}</title>
          {kind === 'line' && (
            <>
              <line x1="30" y1="200" x2="570" y2="200" stroke="#ccc" />
              <polyline
                fill="none"
                stroke="#703951"
                strokeWidth="3"
                points={chart.points.map((p, i) => x(i) + ',' + y(p.value)).join(' ')}
              />
              {chart.points.map((p, i) => (
                <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="#703951">
                  <title>{p.label + ' · ' + p.value + ' ' + chart.unit}</title>
                </circle>
              ))}
            </>
          )}
          {kind === 'bar' &&
            chart.points.map((p, i) => (
              <rect
                key={i}
                x={30 + (i * 540) / chart.points.length}
                y={p.value < 0 ? 110 : 110 - (p.value / max) * 95}
                width={Math.max(1, 540 / chart.points.length - 4)}
                height={(Math.abs(p.value) / max) * 95}
                fill={colors[i % colors.length]}
              >
                <title>{p.label + ' · ' + p.value + ' ' + chart.unit}</title>
              </rect>
            ))}
          {kind === 'donut' &&
            total > 0 &&
            chart.points.map((p, i) => {
              const length = (p.value / total) * 502.65;
              const start = offset;
              offset += length;
              return (
                <circle
                  key={i}
                  cx="300"
                  cy="115"
                  r="80"
                  fill="none"
                  stroke={colors[i % colors.length]}
                  strokeWidth="40"
                  strokeDasharray={length + ' ' + (502.65 - length)}
                  strokeDashoffset={-start}
                  transform="rotate(-90 300 115)"
                >
                  <title>{p.label + ' · ' + ((p.value / total) * 100).toFixed(1) + '%'}</title>
                </circle>
              );
            })}
        </svg>
      )}
      <details>
        <summary>Ver valores del gráfico · {chart.unit}</summary>
        <div className="query-chart-values">
          {chart.points.map((p, i) => (
            <div key={i}>
              <span>{p.label}</span>
              <strong>
                {p.value.toLocaleString('es-BO', { maximumFractionDigits: 2 })} {chart.unit}
              </strong>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
