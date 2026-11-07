import { useState } from 'react';
import { pageReportDetail } from '@lumina/reporting';
import type { ReportDataset, ReportResult } from '@lumina/contracts';
import { fields, label } from './report-data';

export function ReportDetail({ data, result }: { data: ReportDataset; result: ReportResult }) {
  const [offset, setOffset] = useState(0);
  const page = pageReportDetail(result, offset, 20);
  const columns = [
    ...new Set(page.rows.flatMap((row) => Object.keys(row).filter((key) => key !== 'id'))),
  ];
  if (!page.total || !columns.length) return null;
  return (
    <details className="report-panel">
      <summary>Detalle de registros · {page.total}</summary>
      <div className="report-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((key) => (
                <th scope="col" key={key}>
                  {fields[key] ?? key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row, index) => (
              <tr key={String(row.id ?? index)}>
                {columns.map((key) => (
                  <td key={key}>{row[key] == null ? '—' : label(data, key, String(row[key]))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="report-actions">
        <button
          type="button"
          className="secondary"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 20))}
        >
          Anterior
        </button>
        <span>
          {offset + 1}–{offset + page.rows.length} de {page.total}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={page.nextOffset === null}
          onClick={() => setOffset(page.nextOffset ?? offset)}
        >
          Siguiente
        </button>
      </div>
    </details>
  );
}
