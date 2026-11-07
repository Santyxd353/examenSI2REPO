import { createHash } from 'node:crypto';
import {
  AnalysisResultSchema,
  DateSchema,
  HashSchema,
  MetricValueSchema,
  type AnalysisMetric,
  type AnalysisRequest,
  type AnalysisResult,
} from '@lumina/contracts';
import { z } from 'zod';
import { analyticsRoot, AnalyticsWorkerError, readAnalyticsBytes } from './worker-bridge';

export type FileRef = { path: string; sha256: string };
export type AnalysisArtifacts = {
  files: Record<string, FileRef>;
  datasetJobId?: string;
  modelJobId?: string;
};
export const datasetCode = 'demo-femenino-seed42-v1';
export const demoLocations = Array.from({ length: 5 }, (_, i) => 'demo-ubicacion-0' + (i + 1));
const finite = z.number().finite();
const count = z.number().int().safe().nonnegative();
const invalid = () =>
  new AnalyticsWorkerError(
    'ANALYTICS_ARTIFACT_INVALID',
    'No se pudo validar el artefacto del modelo.',
  );
const jsonValue = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T;

export async function artifactDocument(root: string, path: string, expected?: string) {
  const bytes = await readAnalyticsBytes(root, path, expected ?? null, 4 * 1024 * 1024);
  return {
    body: JSON.parse(bytes.toString('utf8')),
    ref: { path, sha256: createHash('sha256').update(bytes).digest('hex') },
  };
}
export async function verifyFiles(tenant: string, actor: string, artifacts: AnalysisArtifacts) {
  const root = analyticsRoot(tenant, actor);
  for (const file of Object.values(artifacts.files))
    await readAnalyticsBytes(root, file.path, file.sha256, 64 * 1024 * 1024);
}
function demandMetrics(raw: unknown): AnalysisMetric[] {
  const metrics = z.object({
    mae: finite.nonnegative(),
    rmse: finite.nonnegative(),
    wape: finite.nonnegative().nullable(),
    wapeStatus: z.enum(['EVALUABLE', 'NO_APLICA']),
    wapeReason: z.string().nullable(),
    observations: count,
  });
  const groups = z
    .array(
      z.object({
        horizonDays: z.union([z.literal(7), z.literal(30)]),
        model: metrics,
        baseline: metrics,
      }),
    )
    .length(2)
    .parse(raw);
  return groups.flatMap((group) =>
    (['mae', 'rmse', 'wape'] as const).map((name) => {
      const parsed = MetricValueSchema.parse({
        name: name.toUpperCase(),
        value: group.model[name],
        status: name === 'wape' ? group.model.wapeStatus : 'EVALUABLE',
        reason: name === 'wape' ? group.model.wapeReason : null,
        observations: group.model.observations,
      });
      return {
        ...parsed,
        partition: 'PRUEBA' as const,
        horizonDays: group.horizonDays,
        baseline: group.baseline[name],
      };
    }),
  );
}
function anomalyMetrics(raw: unknown, partition: AnalysisMetric['partition']): AnalysisMetric[] {
  const v = z
    .object({
      precision: finite.nullable(),
      precisionReason: z.string().nullable(),
      recall: finite.nullable(),
      recallReason: z.string().nullable(),
      f1: finite.nullable(),
      f1Reason: z.string().nullable(),
      observations: count,
      confusionMatrix: z.object({ tp: count, fp: count, tn: count, fn: count }),
    })
    .parse(raw);
  return [
    ...(['precision', 'recall', 'f1'] as const).map((key) => ({
      name: key.toUpperCase(),
      value: v[key],
      reason: v[(key + 'Reason') as 'precisionReason'],
      status: v[key] === null ? ('NO_APLICA' as const) : ('EVALUABLE' as const),
      partition,
      horizonDays: 0 as const,
      baseline: null,
      observations: v.observations,
    })),
    ...Object.entries(v.confusionMatrix).map(([key, value]) => ({
      name: key.toUpperCase(),
      value,
      reason: null,
      status: 'EVALUABLE' as const,
      partition,
      horizonDays: 0 as const,
      baseline: null,
      observations: v.observations,
    })),
  ];
}
export async function ingestAnalysis(
  tenant: string,
  actor: string,
  jobId: string,
  modelId: string,
  input: AnalysisRequest,
  raw: Record<string, unknown>,
) {
  const root = analyticsRoot(tenant, actor);
  const result: AnalysisResult = {
    schemaVersion: '1.0',
    source: input.source,
    action: input.action,
    asOf: z.string().parse(raw.generatedAt),
    period: { from: '2025-10-01', to: '2026-09-30' },
    limitations: z.array(z.string()).parse(raw.limitations),
    locationIds: input.locationIds ?? [demoLocations[0]],
    metrics: [],
    forecast: [],
    suggestions: [],
    alerts: [],
  };
  const artifacts: AnalysisArtifacts = { files: {} };
  let dataset: Record<string, unknown> | undefined;
  let modelMetadata: Record<string, unknown> | undefined;
  if (input.action === 'GENERATE_DATASET') {
    const manifest = z
      .object({
        datasetId: z.literal(datasetCode),
        source: z.literal('DEMOSTRACION_SINTETICA'),
        dateRange: z.object({ from: DateSchema, to: DateSchema }),
        rowCount: count,
        splits: z.record(z.string(), z.json()),
        filesSha256: z.record(z.string(), HashSchema),
      })
      .parse(raw.manifest);
    const base = 'datasets/' + jobId + '/';
    for (const name of ['panel.csv', 'anomaly-panel.csv', 'anomaly-labels.csv', 'catalog.json']) {
      const sha = HashSchema.parse(manifest.filesSha256[name]);
      await readAnalyticsBytes(root, base + name, sha, 64 * 1024 * 1024);
      artifacts.files[name] = { path: base + name, sha256: sha };
    }
    const catalog = (
      await artifactDocument(root, base + 'catalog.json', manifest.filesSha256['catalog.json'])
    ).body;
    const names = z
      .object({
        products: z.array(z.object({ productId: z.string(), name: z.string() })),
        variants: z.array(
          z.object({
            variantId: z.string(),
            productId: z.string(),
            size: z.string(),
            color: z.string(),
          }),
        ),
        locations: z.array(z.object({ locationId: z.string(), name: z.string() })),
      })
      .parse(catalog);
    result.labels = {
      locations: Object.fromEntries(names.locations.map((item) => [item.locationId, item.name])),
      variants: Object.fromEntries(
        names.variants.map((item) => [
          item.variantId,
          [
            names.products.find((product) => product.productId === item.productId)?.name ??
              item.productId,
            item.size,
            item.color,
          ].join(' · '),
        ]),
      ),
    };
    const manifestDoc = await artifactDocument(root, base + 'manifest.json');
    artifacts.files.manifest = manifestDoc.ref;
    result.period = manifest.dateRange;
    result.dataset = {
      id: jobId,
      workerDatasetId: datasetCode,
      rows: manifest.rowCount,
      sha256: manifest.filesSha256['panel.csv'],
      splits: manifest.splits,
    };
    dataset = { manifest: manifestDoc.body, catalog };
  } else if (input.action === 'TRAIN_DEMAND' || input.action === 'TRAIN_ANOMALY') {
    const anomaly = input.action === 'TRAIN_ANOMALY';
    const metrics = z.record(z.string(), z.unknown()).parse(raw.metrics);
    const artifact = z
      .object({
        filename: z.literal(anomaly ? 'anomaly-model.joblib' : 'demand-model.joblib'),
        sha256: HashSchema,
        bytes: count,
      })
      .parse(metrics.artifact);
    const base = 'models/' + jobId + '/';
    await readAnalyticsBytes(root, base + artifact.filename, artifact.sha256, 64 * 1024 * 1024);
    artifacts.files.model = { path: base + artifact.filename, sha256: artifact.sha256 };
    const metadata = await artifactDocument(
      root,
      base + (anomaly ? 'anomaly-metadata.json' : 'metadata.json'),
    );
    const scope = z.object({
      tenantId: z.literal(tenant),
      jobId: z.literal(jobId),
      source: z.literal(input.source),
      datasetId: z.literal(datasetCode),
    });
    scope.parse(metadata.body.scope);
    if (
      metadata.body.datasetId !== datasetCode ||
      metadata.body.artifact.sha256 !== artifact.sha256
    )
      throw invalid();
    artifacts.files.metadata = metadata.ref;
    modelMetadata = jsonValue(metadata.body);
    result.model = {
      id: modelId,
      version: z.string().parse(raw.modelVersion),
      algorithm: anomaly ? 'IsolationForest' : 'RandomForestRegressor',
    };
    result.metrics = anomaly
      ? [
          ...anomalyMetrics(metrics.validation, 'VALIDACION'),
          ...anomalyMetrics(metrics.test, 'PRUEBA'),
        ]
      : demandMetrics(metrics.test);
    if (anomaly)
      result.alerts = z
        .array(
          z.object({
            date: DateSchema,
            variantId: z.string(),
            locationId: z.string(),
            channel: z.enum(['WEB', 'APP', 'TIENDA']),
            score: finite,
            threshold: finite,
          }),
        )
        .max(500)
        .parse(metrics.alerts ?? []);
  } else if (input.action === 'FORECAST') {
    result.period = z.object({ from: DateSchema, to: DateSchema }).parse(raw.coverage);
    result.forecast = z
      .array(
        z.object({
          date: DateSchema,
          variant_id: z.string(),
          location_id: z.string(),
          channel: z.enum(['WEB', 'APP', 'TIENDA']),
          predicted_units: finite.nonnegative(),
        }),
      )
      .max(50000)
      .parse(raw.rows)
      .filter(
        (row) => result.locationIds.includes(row.location_id) && row.channel === input.channel,
      )
      .map((row) => ({
        date: row.date,
        variantId: row.variant_id,
        locationId: row.location_id,
        channel: row.channel,
        predictedUnits: row.predicted_units,
      }));
  } else {
    result.suggestions = z
      .array(
        z.object({
          variantId: z.string(),
          locationId: z.string(),
          suggestedQuantity: count,
          inputs: z.object({
            demandDuringLead: finite.nonnegative(),
            demandSource: z.enum(['FORECAST', 'REGLA_BASICA']),
            leadTimeDays: finite.nonnegative(),
            safetyStock: finite.nonnegative(),
            available: finite.nonnegative(),
            confirmedInboundNotInAvailable: finite.nonnegative(),
          }),
          limitations: z.array(z.string()),
          effect: z.literal('SUGGESTION_ONLY'),
        }),
      )
      .max(10000)
      .parse(raw.suggestions)
      .map((row) => ({
        variantId: row.variantId,
        locationId: row.locationId,
        suggestedQuantity: row.suggestedQuantity,
        available: row.inputs.available,
        safetyStock: row.inputs.safetyStock,
        demandDuringLead: row.inputs.demandDuringLead,
        confirmedInbound: row.inputs.confirmedInboundNotInAvailable,
        leadTimeDays: row.inputs.leadTimeDays,
        demandSource: row.inputs.demandSource,
        inventoryAsOf: result.asOf,
        limitations: row.limitations,
        effect: row.effect,
      }));
  }
  result.alerts = result.alerts.filter(
    (row) => result.locationIds.includes(row.locationId) && row.channel === input.channel,
  );
  return { result: AnalysisResultSchema.parse(result), artifacts, dataset, modelMetadata };
}
