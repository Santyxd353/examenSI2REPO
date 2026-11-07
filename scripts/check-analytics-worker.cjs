// Local Node-to-Python acceptance. Run after build:api with ANALYTICS_PYTHON_PATH.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const {
  AnalyticsWorkerBridge,
  verifiedAnalyticsBytes,
} = require('../dist/api/analytics/worker-bridge');
const { inventorySnapshot } = require('../workers/analytics/examples/suggest-restock-demo.json');

async function main() {
  const worker = new AnalyticsWorkerBridge();
  const scope = {
    schemaVersion: '1.0',
    tenantId: randomUUID(),
    actorId: randomUUID(),
    source: 'DEMOSTRACION_SINTETICA',
    datasetId: 'demo-femenino-seed42-v1',
  };
  const datasetJob = randomUUID();
  const generated = await worker.run({
    ...scope,
    jobId: datasetJob,
    action: 'GENERATE_DATASET',
    parameters: {},
  });
  assert.equal(generated.manifest.rowCount, 197100);
  const datasetPath = 'datasets/' + datasetJob + '/';
  const root = join('.local', 'analytics-private', scope.tenantId, scope.actorId);
  for (const name of ['panel.csv', 'anomaly-panel.csv', 'anomaly-labels.csv', 'catalog.json']) {
    const hash = generated.manifest.filesSha256[name];
    await verifiedAnalyticsBytes(root, datasetPath + name, hash, 64 * 1024 * 1024);
  }
  console.log('Dataset generado con 197.100 filas y cuatro archivos verificados.');
  const anomaly = await worker.run({
    ...scope,
    jobId: randomUUID(),
    action: 'TRAIN_ANOMALY',
    parameters: {
      panelPath: datasetPath + 'anomaly-panel.csv',
      labelsPath: datasetPath + 'anomaly-labels.csv',
    },
  });
  assert.equal(anomaly.modelId, anomaly.jobId);
  assert.equal(anomaly.modelVersion, 'anomaly-iforest-seed42-v1');
  assert.ok(anomaly.metrics);
  console.log('Anomalías entrenadas mediante el worker real.');
  const restock = await worker.run({
    ...scope,
    jobId: randomUUID(),
    action: 'SUGGEST_RESTOCK',
    parameters: {},
    inventorySnapshot,
  });
  assert.equal(restock.suggestions[0].suggestedQuantity, 6);
  assert.equal(restock.suggestions[0].effect, 'SUGGESTION_ONLY');
  console.log('Reposición revisada sobre seis unidades de demostración.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
