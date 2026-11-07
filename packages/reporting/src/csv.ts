import { canonicalJson, type ReportResult, type ReportValue } from '@lumina/contracts';
import { decimalMinor } from './money';
function cell(value: unknown) {
  if (value === undefined || value === null) return '""';
  if (typeof value === 'number') return String(value);
  const text = typeof value === 'string' ? value : canonicalJson(value);
  const escaped = /^[\t\r\n]/.test(text) || /^[=+@-]/.test(text.trimStart()) ? "'" + text : text;
  return '"' + escaped.replaceAll('"', '""') + '"';
}
function metric(value: ReportValue) {
  return value.value === null
    ? 'N/A'
    : value.unit === 'CENTAVOS'
      ? decimalMinor(value.value)
      : value.value;
}
export function exportReportCsv(result: ReportResult) {
  const rows: unknown[][] = [
    ['seccion', 'registro', 'campo', 'valor'],
    ['contexto', '', 'tienda', result.tenantId],
    ['contexto', '', 'origen', result.source],
    ['contexto', '', 'conjunto', result.datasetId],
    ['contexto', '', 'corte', result.asOf],
    ['contexto', '', 'cobertura', result.coverage],
    ['contexto', '', 'periodo', result.definition?.period],
    ['contexto', '', 'filtros', result.definition?.filters],
    ['contexto', '', 'moneda', 'BOB'],
  ];
  for (const [key, value] of Object.entries(result.kpis))
    rows.push(['total', '', key, metric(value)]);
  for (const group of result.groups) {
    for (const [key, value] of Object.entries(group.dimensions))
      rows.push(['grupo', group.key, key, value]);
    for (const [key, value] of Object.entries(group.metrics))
      rows.push(['grupo', group.key, key, metric(value)]);
  }
  for (const row of result.detail.rows)
    for (const [key, value] of Object.entries(row))
      if (key !== 'id') rows.push(['detalle', row.id, key, value]);
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
