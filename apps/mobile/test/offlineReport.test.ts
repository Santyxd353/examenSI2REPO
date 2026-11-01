import assert from 'node:assert/strict';
import test from 'node:test';
import { reportSnapshotKey, verifyOfflineDashboard } from '../src/modules/reports/offlineReport';

const report = {
  kpis: { pedidos: 2, ventas: 120, unidades: 3, ticketPromedio: 60 },
  summary: 'Dos pedidos confirmados.',
  generatedBy: 'Prueba',
  products: [],
  locations: [],
} as const;

test('construye claves de reporte por período y ubicación', () => {
  assert.equal(reportSnapshotKey('2026-10-01', '2026-10-31'), '2026-10-01:2026-10-31:TODAS');
  assert.equal(reportSnapshotKey('2026-10-01', '2026-10-31', 'location-1'), '2026-10-01:2026-10-31:location-1');
  assert.throws(() => reportSnapshotKey('2026-11-01', '2026-10-01'), /válido/);
});

test('solo conserva dashboards completos con indicadores finitos', () => {
  assert.equal(verifyOfflineDashboard(report), report);
  assert.throws(() => verifyOfflineDashboard({ ...report, kpis: { ...report.kpis, ventas: Number.NaN } }), /indicadores/);
});
