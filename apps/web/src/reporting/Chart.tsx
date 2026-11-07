import {
  minorToDecimal,
  type ReportDataset,
  type ReportDefinition,
  type ReportDimension,
  type ReportGroup,
  type ReportMetric,
  type ReportValue,
} from '@lumina/contracts';
import { fields, label } from './report-data';

const palette = [
  '#863d63',
  '#275e5a',
  '#aa6537',
  '#5d508f',
  '#925572',
  '#3b7286',
  '#79663d',
  '#4a585b',
];
const digits = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 0 });
export function formatValue(value?: ReportValue) {
  if (value?.value == null) return 'N/D';
  if (value.unit === 'CENTAVOS') {
    const [whole, cents] = minorToDecimal(value.value).split('.');
    return 'Bs ' + digits.format(BigInt(whole)) + ',' + cents;
  }
  return digits.format(value.value);
}
export function Chart({
  data,
  groups,
  metric,
  chart,
  dimension,
  select,
}: {
  data: ReportDataset;
  groups: ReportGroup[];
  metric: ReportMetric;
  chart: ReportDefinition['chart'];
  dimension?: ReportDimension;
  select?: (dimension: ReportDimension, value: string) => void;
}) {
  if (!groups.length) return <p className="report-empty">No hay resultados para estos filtros.</p>;
  const items = groups.map((group, index) => {
    const name =
      Object.entries(group.dimensions)
        .map(([field, value]) => label(data, field, value))
        .join(' · ') || 'Total del período';
    return {
      key: group.key,
      name,
      value: group.metrics[metric],
      group,
      color: palette[index % palette.length],
    };
  });
  const max = Math.max(1, ...items.map((item) => item.value?.value ?? 0));
  const total = items.reduce((sum, item) => sum + (item.value?.value ?? 0), 0);
  const points = items.map((item, index) => [
    18 + (index * 464) / Math.max(1, items.length - 1),
    152 - ((item.value?.value ?? 0) / max) * 122,
  ]);
  const path = points.map(([x, y]) => x + ',' + y).join(' ');
  let start = 0;
  const gradient = items
    .map((item) => {
      const before = start;
      start += total ? ((item.value?.value ?? 0) / total) * 100 : 0;
      return item.color + ' ' + before + '% ' + start + '%';
    })
    .join(',');
  return (
    <div className={'report-chart report-chart-' + chart}>
      {chart === 'donut' && total > 0 && (
        <div
          className="report-donut"
          aria-hidden="true"
          style={{ background: 'conic-gradient(' + gradient + ')' }}
        />
      )}
      {(chart === 'line' || chart === 'area') && (
        <svg
          className="report-line"
          viewBox="0 0 500 172"
          role="img"
          aria-label={fields[metric] + ' por grupo'}
        >
          {[30, 70, 111, 152].map((y) => (
            <line key={y} x1={18} x2={482} y1={y} y2={y} stroke="#e7d9de" />
          ))}
          {chart === 'area' && (
            <polygon
              points={`18,152 ${path} ${points.at(-1)?.[0]},152`}
              fill="#e4bed0"
              opacity=".65"
            />
          )}
          <polyline points={path} fill="none" stroke={palette[0]} strokeWidth="3" />
          {points.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={3.5} fill={palette[0]}>
              <title>
                {items[i].name}: {formatValue(items[i].value)}
              </title>
            </circle>
          ))}
        </svg>
      )}
      <ul className="report-series" aria-label={fields[metric]}>
        {items.map((item) => {
          const value = dimension ? item.group.dimensions[dimension] : null;
          const caption = (
            <>
              <span className="report-series-name">
                <i aria-hidden="true" style={{ background: item.color }} />
                {item.name}
              </span>
              <strong>{formatValue(item.value)}</strong>
            </>
          );
          return (
            <li key={item.key}>
              {select && dimension && value != null ? (
                <button
                  type="button"
                  onClick={() => select(dimension, value)}
                  aria-label={`Filtrar ${fields[dimension]}: ${label(data, dimension, value)}`}
                >
                  {caption}
                </button>
              ) : (
                <div>{caption}</div>
              )}
              {chart === 'bar' && (
                <span className="report-bar" aria-hidden="true">
                  <i
                    style={{
                      width: ((item.value?.value ?? 0) / max) * 100 + '%',
                      background: item.color,
                    }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
