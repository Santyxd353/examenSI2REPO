import assert from 'node:assert/strict';
import test from 'node:test';
import { reportCsv, reportPdfHtml } from '../src/modules/reports/reportExportData';

const report = { kpis: { pedidos: 2, ventas: 120, unidades: 3, ticketPromedio: 60 }, summary: 'Resumen', generatedBy: 'DEMOSTRACION_SINTETICA', products: [{ variante_id: '1', producto: '=Fórmula', sku: 'SKU,"1"', unidades: 3, ventas: 120 }], locations: [{ ubicacion_id: 'l1', ubicacion: 'Centro', pedidos: 2, ventas: 120 }] } as const;

test('CSV protege fórmulas y escapa comillas', () => {
  const csv = reportCsv(report, '2026-10-01', '2026-10-31');
  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /"'=Fórmula"/);
  assert.match(csv, /"SKU,""1"""/);
});

test('PDF local incluye período, fuente y datos sin recursos remotos', () => {
  const html = reportPdfHtml(report, '2026-10-01', '2026-10-31');
  assert.match(html, /DEMOSTRACION_SINTETICA/);
  assert.match(html, /2026-10-01/);
  assert.doesNotMatch(html, /https?:\/\//);
});
