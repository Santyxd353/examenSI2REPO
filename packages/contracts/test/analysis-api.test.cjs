const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { AnalysisRequestSchema, AnalysisMetricSchema } = require('../dist');

test('el pronóstico real sin modelo puede declarar historia insuficiente; la demostración necesita un modelo', () => {
  const input = { operationId: randomUUID(), action: 'FORECAST', source: 'REAL', horizonDays: 7 };
  assert.equal(AnalysisRequestSchema.safeParse(input).success, true);
  assert.equal(
    AnalysisRequestSchema.safeParse({ ...input, source: 'DEMOSTRACION_SINTETICA' }).success,
    false,
  );
  assert.equal(
    AnalysisRequestSchema.safeParse({ ...input, workDir: '.local/otra-tienda' }).success,
    false,
  );
});
test('una métrica N/A conserva valor nulo y motivo, sin convertir el error en precisión cero', () => {
  const metric = {
    name: 'WAPE',
    partition: 'PRUEBA',
    horizonDays: 30,
    value: null,
    baseline: null,
    status: 'NO_APLICA',
    reason: 'SUMA_REAL_CERO',
    observations: 10,
  };
  assert.equal(AnalysisMetricSchema.safeParse(metric).success, true);
  assert.equal(AnalysisMetricSchema.safeParse({ ...metric, value: 0 }).success, false);
  assert.equal(AnalysisMetricSchema.safeParse({ ...metric, reason: null }).success, false);
});
