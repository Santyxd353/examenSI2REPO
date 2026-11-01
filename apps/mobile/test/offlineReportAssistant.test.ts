import assert from 'node:assert/strict';
import test from 'node:test';
import { askOfflineReport } from '../src/modules/reports/offlineReportAssistant';

const report = {
  kpis: { pedidos: 3, ventas: 360, unidades: 6, ticketPromedio: 120 },
  summary: 'Resumen',
  generatedBy: 'Prueba',
  products: [
    { variante_id: 'a', producto: 'Camisa', sku: 'CAM-1', unidades: 2, ventas: 100 },
    { variante_id: 'b', producto: 'Chaqueta', sku: 'CHA-1', unidades: 1, ventas: 200 },
  ],
  locations: [],
} as const;

test('responde consultas de ventas, pedidos y producto líder sin conexión', () => {
  assert.match(askOfflineReport(report, '¿Cuánto vendimos?').answer, /360.00/);
  assert.match(askOfflineReport(report, 'cuantos pedidos hay').answer, /3 pedidos/);
  assert.match(askOfflineReport(report, '¿Cuál es el producto más vendido?').answer, /Chaqueta/);
});

test('no inventa una respuesta para consultas fuera de los datos locales', () => {
  const answer = askOfflineReport(report, '¿Cuál es el pronóstico de mañana?');
  assert.equal(answer.intent, 'UNSUPPORTED');
});
