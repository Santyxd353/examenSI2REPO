import { useState } from 'react';
import type { AnalysisResult } from '@lumina/contracts';

export function RestockReview({ result, location }: { result: AnalysisResult; location: string }) {
  const [onlyPositive, setOnlyPositive] = useState(true);
  const [page, setPage] = useState(0);
  const rows = result.suggestions
    .filter(
      (row) =>
        (!location || row.locationId === location) && (!onlyPositive || row.suggestedQuantity > 0),
    )
    .sort((a, b) => b.suggestedQuantity - a.suggestedQuantity);
  const offset = Math.min(page, Math.max(0, Math.ceil(rows.length / 20) - 1)) * 20;
  if (!result.suggestions.length) return null;
  return (
    <article className="report-panel">
      <h2>Revisión de reposición</h2>
      <p>
        Las cantidades son propuestas para revisar. Inventario del corte{' '}
        {new Date(result.asOf).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}.
      </p>
      <label className="report-check">
        <input
          type="checkbox"
          checked={onlyPositive}
          onChange={(e) => {
            setOnlyPositive(e.target.checked);
            setPage(0);
          }}
        />
        Mostrar cantidades mayores a cero
      </label>
      <div className="report-table-scroll">
        <table>
          <thead>
            <tr>
              {[
                'Variante',
                'Ubicación',
                'Disponible',
                'Seguridad',
                'Demanda en plazo',
                'Entrante',
                'Sugerencia',
                'Base',
              ].map((key) => (
                <th scope="col" key={key}>
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(offset, offset + 20).map((row) => (
              <tr key={row.variantId + row.locationId}>
                <td>{result.labels?.variants[row.variantId] ?? row.variantId}</td>
                <td>{result.labels?.locations[row.locationId] ?? row.locationId}</td>
                <td>{row.available}</td>
                <td>{row.safetyStock}</td>
                <td>{row.demandDuringLead.toFixed(2)}</td>
                <td>{row.confirmedInbound}</td>
                <td>
                  <strong>{row.suggestedQuantity}</strong>
                </td>
                <td>
                  {row.demandSource === 'FORECAST' ? 'Pronóstico' : 'Regla de seguridad'}
                  {row.limitations.map((text) => (
                    <small className="analysis-note" key={text}>
                      {text}
                    </small>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>No hay propuestas para estos filtros.</p>}
      <div className="report-toolbar">
        <button
          className="secondary"
          disabled={!offset}
          onClick={() => setPage(Math.max(0, page - 1))}
        >
          Anterior
        </button>
        <span>
          {rows.length ? offset + 1 : 0}–{Math.min(offset + 20, rows.length)} de {rows.length}
        </span>
        <button
          className="secondary"
          disabled={offset + 20 >= rows.length}
          onClick={() => setPage(page + 1)}
        >
          Siguiente
        </button>
      </div>
    </article>
  );
}
