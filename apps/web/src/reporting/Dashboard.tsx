import type {
  ReportDataset,
  ReportDefinition,
  ReportDimension,
  ReportResult,
} from '@lumina/contracts';
import { Chart, formatValue } from './Chart';
import { describeFilter } from './Filters';
import { ReportDetail } from './ReportDetail';
import { fields, label } from './report-data';

export function Dashboard({
  data,
  definition,
  result,
  select,
}: {
  data: ReportDataset;
  definition: ReportDefinition;
  result: ReportResult;
  select?: (dimension: ReportDimension, value: string) => void;
}) {
  return (
    <section className="report-dashboard" aria-label="Resultado del reporte">
      <div className="report-kpis">
        {definition.metrics.map((metric) => (
          <article className="report-kpi" key={metric}>
            <span>{fields[metric]}</span>
            <strong>{formatValue(result.kpis[metric])}</strong>
            {result.comparison && (
              <small>Comparación {formatValue(result.comparison.kpis[metric])}</small>
            )}
          </article>
        ))}
      </div>
      <div className="report-criteria">
        <strong>Período consultado</strong> {definition.period.from} a {definition.period.to}
        {definition.comparison && (
          <>
            {' '}
            · Comparación {definition.comparison.from} a {definition.comparison.to}
          </>
        )}
        {definition.filters.length > 0 && (
          <ul>
            {definition.filters.map((filter, index) => (
              <li key={index}>{describeFilter(data, filter)}</li>
            ))}
          </ul>
        )}
      </div>
      <article className="report-panel">
        <div className="report-panel-title">
          <div>
            <p className="report-kicker">DESGLOSE</p>
            <h2>{definition.title}</h2>
          </div>
          <span>
            {definition.dimensions.map((field) => fields[field]).join(' · ') || 'Total del período'}
          </span>
        </div>
        {result.warnings.map((warning, i) => (
          <p className="report-warning" key={i}>
            {warning}
          </p>
        ))}
        {definition.chart === 'table' && result.groups.length ? (
          <div className="report-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Grupo</th>
                  {definition.metrics.map((metric) => (
                    <th scope="col" key={metric}>
                      {fields[metric]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.groups.map((group) => (
                  <tr key={group.key}>
                    <th scope="row">
                      {Object.entries(group.dimensions)
                        .map(([field, value]) => label(data, field, value))
                        .join(' · ') || 'Total'}
                    </th>
                    {definition.metrics.map((metric) => (
                      <td key={metric}>{formatValue(group.metrics[metric])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Chart
            data={data}
            groups={result.groups}
            metric={definition.metrics[0]}
            chart={definition.chart}
            dimension={definition.dimensions[0]}
            select={select}
          />
        )}
      </article>
      {definition.dashboard.widgets.length > 0 && (
        <div className="report-widgets">
          {definition.dashboard.widgets.map((widget) => (
            <article key={widget.id} className="report-panel">
              <h3>
                {fields[widget.metric]} · {fields[widget.dimension]}
              </h3>
              <Chart
                data={data}
                groups={result.widgets?.find((item) => item.id === widget.id)?.groups ?? []}
                metric={widget.metric}
                chart={widget.chart}
                dimension={widget.dimension}
                select={select}
              />
            </article>
          ))}
        </div>
      )}
      <ReportDetail key={JSON.stringify(definition)} data={data} result={result} />
    </section>
  );
}
