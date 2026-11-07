import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { analysisSlice, checkedAnalysisCopy, parseAnalysisJobs } from '../src/modules/analysis/analysisResults';
const scope = { tenantId: randomUUID(), actorId: randomUUID(), deviceId: randomUUID() };
const result = {
  schemaVersion: '1.0',
  source: 'DEMOSTRACION_SINTETICA',
  action: 'FORECAST',
  asOf: '2026-11-07T12:00:00Z',
  period: { from: '2026-11-08', to: '2026-11-09' },
  limitations: ['Datos sintéticos'],
  locationIds: ['one', 'two'],
  metrics: [],
  suggestions: [],
  alerts: [],
  forecast: [
    { date: '2026-11-08', variantId: 'v', locationId: 'one', channel: 'APP', predictedUnits: 3 },
    { date: '2026-11-08', variantId: 'v', locationId: 'two', channel: 'APP', predictedUnits: 5 },
    { date: '2026-11-09', variantId: 'v', locationId: 'one', channel: 'WEB', predictedUnits: 4 },
  ],
};
test('la lista usa el sobre jobs que devuelve la API',()=>{
  assert.deepEqual(parseAnalysisJobs({jobs:[]}),[]);assert.throws(()=>parseAnalysisJobs([]));
});
test('el análisis offline filtra fecha, ubicación y canal sin cambiar las métricas del modelo', () => {
  assert.deepEqual(
    analysisSlice(result as any, {
      from: '2026-11-08',
      to: '2026-11-09',
      location: 'one',
      channel: 'APP',
    }).forecast,
    [['2026-11-08', 3]],
  );
  assert.throws(
    () =>
      analysisSlice(result as any, {
        from: '2026-11-07',
        to: '2026-11-09',
        location: '',
        channel: '',
      }),
    /corte/,
  );
});
test('el resultado guardado corresponde al propietario y no acepta otro tipo de análisis', () => {
  const job = {
    id: randomUUID(),
    action: 'FORECAST',
    source: 'DEMOSTRACION_SINTETICA',
    status: 'COMPLETED',
    createdAt: result.asOf,
    startedAt: result.asOf,
    completedAt: result.asOf,
    errorCode: null,
    message: null,
    result,
  };
  assert.equal(checkedAnalysisCopy({ ...scope, job }, scope).id, job.id);
  assert.throws(() => checkedAnalysisCopy({ ...scope, actorId: randomUUID(), job }, scope));
  assert.throws(() =>
    checkedAnalysisCopy({ ...scope, job: { ...job, action: 'TRAIN_DEMAND' } }, scope),
  );
});
