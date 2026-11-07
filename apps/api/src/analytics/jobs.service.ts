import { ConflictException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  AnalysisRequestSchema,
  AnalysisResultSchema,
  type AnalysisRequest,
  type AnalysisResult,
  type AnalyticsJobV1,
} from '@lumina/contracts';
import { Prisma, type ejecucion_analitica } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { boliviaDate } from '@lumina/reporting';
import { AuthService, type Identity } from '../auth';
import { Db } from '../db';
import { TenantRegistry } from '../tenancy/platform';
import { currentTenant, runForTenant, type TenantContext } from '../tenancy/context';
import { assertRequestHash, lockOperation, requestHash } from '../commerce/idempotency';
import { AnalyticsWorkerBridge, AnalyticsWorkerError } from './worker-bridge';
import { datasetCode, ingestAnalysis, verifyFiles, type AnalysisArtifacts } from './artifacts';
import { AnalysisResults, jobMetadata, type JobMetadata } from './results.service';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
const insufficient =
  'La tienda todavía no dispone de un modelo entrenado con historial real suficiente. Puedes consultar reglas de reposición identificadas o usar la demostración sintética.';
const pendingWhere = { estado: 'PENDIENTE', filtros: { path: ['kind'], equals: 'ML_JOB_V1' } };
type Prepared = Awaited<ReturnType<typeof ingestAnalysis>>;

@Injectable()
export class AnalysisJobs implements OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private abort?: AbortController;
  private closing = false;
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TenantRegistry) private registry: TenantRegistry,
    @Inject(AuthService) private auth: AuthService,
    @Inject(AnalysisResults) private results: AnalysisResults,
    @Inject(AnalyticsWorkerBridge) private worker: AnalyticsWorkerBridge,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () =>
        void this.sweep().catch(() => console.error('La cola analítica se revisará nuevamente.')),
      3000,
    );
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.closing = true;
    if (this.timer) clearInterval(this.timer);
    this.abort?.abort();
    await this.running;
  }
  async create(actor: Identity, raw: unknown) {
    const input = AnalysisRequestSchema.parse(raw);
    const hash = requestHash(input);
    const scope = currentTenant()!;
    return this.registry.withWriteAccess(scope, async () => {
      actor = await this.auth.identity(actor.id);
      const locationIds = await this.results.access(actor, input);
      return this.db.$transaction(async (tx) => {
        await lockOperation(tx, 'analysis-job', input.operationId);
        const old = await tx.ejecucion_analitica.findUnique({ where: { id: input.operationId } });
        if (old) {
          if (old.solicitante_id !== actor.id)
            throw new ConflictException('La intención pertenece a otra cuenta.');
          assertRequestHash(jobMetadata(old).hash, hash);
          return this.results.view(old);
        }
        const waiting = await tx.ejecucion_analitica.count({ where: pendingWhere });
        const own = await tx.ejecucion_analitica.count({
          where: { ...pendingWhere, solicitante_id: actor.id },
        });
        if (waiting >= 16 || own >= 2)
          throw new ConflictException('Espera a que termine uno de los análisis pendientes.');
        const meta: JobMetadata = {
          kind: 'ML_JOB_V1',
          tenantId: scope.id,
          input: { ...input, locationIds },
          hash,
          queue: { state: 'QUEUED' },
        };
        const realWithoutHistory = input.source === 'REAL' && input.action !== 'SUGGEST_RESTOCK';
        if (!realWithoutHistory) await this.dependencies(actor, input);
        if (realWithoutHistory) {
          meta.errorCode = 'MODEL_DATA_INSUFFICIENT';
          meta.message = insufficient;
        }
        const modelId = randomUUID();
        await tx.modelo_analitico.create({
          data: {
            id: modelId,
            tipo: input.action === 'TRAIN_ANOMALY' ? 'ANOMALIA' : 'DEMANDA',
            nombre: 'Análisis ' + input.action,
            version: input.operationId,
            parametros: {},
            estado: realWithoutHistory ? 'SIN_DATOS' : 'PENDIENTE',
            procedencia: 'REGLA_LEGADA',
          },
        });
        const row = await tx.ejecucion_analitica.create({
          data: {
            id: input.operationId,
            modelo_id: modelId,
            solicitante_id: actor.id,
            desde: new Date('2025-10-01'),
            hasta: new Date('2026-09-30'),
            filtros: json(meta),
            estado: realWithoutHistory ? 'SIN_DATOS' : 'PENDIENTE',
            modo: input.source === 'REAL' ? 'REGLA' : 'DEMOSTRACION',
            creada_en: new Date(),
            terminada_en: realWithoutHistory ? new Date() : null,
            ambito_ubicaciones: locationIds,
            limitaciones: realWithoutHistory ? [insufficient] : [],
          },
        });
        await tx.auditoria.create({
          data: {
            actor_id: actor.id,
            entidad: 'ejecucion_analitica',
            entidad_id: row.id,
            accion: 'ANALYSIS_REQUEST',
            correlacion: row.id,
            cambios: { source: input.source, action: input.action },
            creado_en: new Date(),
          },
        });
        return this.results.view(row);
      });
    });
  }
  private async dependencies(actor: Identity, input: AnalysisRequest) {
    const required =
      input.action === 'TRAIN_DEMAND' || input.action === 'TRAIN_ANOMALY'
        ? [input.datasetJobId, 'GENERATE_DATASET']
        : input.action === 'FORECAST'
          ? [input.modelJobId, 'TRAIN_DEMAND']
          : input.action === 'SUGGEST_RESTOCK' && input.source === 'DEMOSTRACION_SINTETICA'
            ? [input.forecastJobId, 'FORECAST']
            : null;
    if (!required) return null;
    const row = await this.results.row(actor, required[0]!);
    const meta = jobMetadata(row);
    if (
      row.estado !== 'COMPLETADA' ||
      meta.input.action !== required[1] ||
      meta.input.source !== input.source
    )
      throw new ConflictException('Selecciona un resultado completo de la misma fuente.');
    if (
      input.locationIds?.some((id) => !meta.input.locationIds?.includes(id)) &&
      meta.input.action === 'FORECAST'
    )
      throw new ConflictException('El pronóstico no cubre las ubicaciones solicitadas.');
    return row;
  }
  sweep(): Promise<void> {
    if (this.running || this.closing) return this.running ?? Promise.resolve();
    this.running = this.process().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async process() {
    const connection = await this.registry.pool.connect();
    let locked = false;
    const abort = new AbortController();
    this.abort = abort;
    const disconnected = () => abort.abort();
    connection.on('error', disconnected);
    try {
      const claim = await connection.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('lumina:analytics:worker:v1',0)) AS locked",
      );
      locked = claim.rows[0].locked;
      if (!locked) return;
      const tenants = await this.registry.listForMaintenance();
      // The global lease proves no other server owns a running child.
      for (const tenant of tenants)
        await runForTenant(tenant, async () => {
          const stranded = await this.db.ejecucion_analitica.findMany({ where: pendingWhere });
          for (const row of stranded)
            if (jobMetadata(row).queue.state === 'RUNNING')
              await this.fail(
                row,
                'ANALYTICS_INTERRUPTED',
                'El análisis se interrumpió al reiniciar el servidor. Inicia uno nuevo.',
              );
        });
      for (const tenant of tenants) {
        if (abort.signal.aborted) return;
        const processed = await runForTenant(tenant, async () => {
          const row = await this.db.ejecucion_analitica.findFirst({
            where: pendingWhere,
            orderBy: [{ creada_en: 'asc' }, { id: 'asc' }],
          });
          if (!row) return false;
          try {
            let actor: Identity;
            await this.registry.withWriteAccess(tenant, async () => {
              actor = await this.auth.identity(row.solicitante_id);
              await this.results.access(actor, jobMetadata(row).input);
              const meta = jobMetadata(row);
              meta.queue = { state: 'RUNNING', startedAt: new Date().toISOString() };
              await this.db.ejecucion_analitica.update({
                where: { id: row.id },
                data: { filtros: json(meta) },
              });
            });
            const heartbeat = setInterval(
              () => void connection.query('SELECT 1').catch(disconnected),
              15000,
            );
            let prepared: Prepared;
            try {
              prepared = await this.execute(row, actor!, abort.signal);
            } finally {
              clearInterval(heartbeat);
            }
            abort.signal.throwIfAborted();
            await this.registry.withWriteAccess(tenant, async () => {
              const fresh = await this.auth.identity(actor!.id);
              await this.results.access(fresh, jobMetadata(row).input);
              await this.save(row, prepared);
            });
          } catch (error) {
            if (this.closing) return true;
            const code = error instanceof AnalyticsWorkerError ? error.code : 'ANALYTICS_FAILED';
            const message =
              error instanceof AnalyticsWorkerError
                ? error.message
                : 'No se pudo completar el análisis con los permisos y datos actuales.';
            await this.fail(row, code, message);
          }
          return true;
        });
        if (processed) return;
      }
    } finally {
      connection.removeListener('error', disconnected);
      if (locked)
        await connection
          .query("SELECT pg_advisory_unlock(hashtextextended('lumina:analytics:worker:v1',0))")
          .catch(() => {});
      connection.release();
      if (this.abort === abort) this.abort = undefined;
    }
  }
  private async execute(
    row: ejecucion_analitica,
    actor: Identity,
    signal: AbortSignal,
  ): Promise<Prepared> {
    const meta = jobMetadata(row);
    const input = meta.input;
    if (input.source === 'REAL') return this.realStock(row, actor);
    const job: Omit<AnalyticsJobV1, 'workDir'> = {
      schemaVersion: '1.0',
      jobId: row.id,
      tenantId: currentTenant()!.id,
      actorId: actor.id,
      source: input.source,
      action: input.action,
      datasetId: datasetCode,
      parameters: {},
    };
    const dependency = await this.dependencies(actor, input);
    let inherited: AnalysisArtifacts | undefined;
    if (dependency) {
      inherited = jobMetadata(dependency).artifacts;
      if (!inherited)
        throw new AnalyticsWorkerError(
          'ANALYTICS_ARTIFACT_INVALID',
          'El análisis dependiente no tiene artefactos válidos.',
        );
      await verifyFiles(job.tenantId, actor.id, inherited);
    }
    if (input.action === 'TRAIN_DEMAND' || input.action === 'TRAIN_ANOMALY') {
      const files = inherited!.files;
      job.parameters =
        input.action === 'TRAIN_DEMAND'
          ? { panelPath: files['panel.csv'].path, nEstimators: 200 }
          : {
              panelPath: files['anomaly-panel.csv'].path,
              labelsPath: files['anomaly-labels.csv'].path,
            };
    } else if (input.action === 'FORECAST') {
      const files = inherited!.files;
      job.modelId = dependency!.id;
      job.horizonDays = input.horizonDays;
      job.parameters = {
        artifactPath: files.model.path,
        artifactSha256: files.model.sha256,
        artifactJobId: dependency!.id,
        panelPath: files['panel.csv'].path,
        origin: '2026-09-30',
      };
    } else if (input.action === 'SUGGEST_RESTOCK') {
      const forecast = this.results.view(dependency!).result!;
      const aggregated = new Map<
        string,
        { variantId: string; locationId: string; demandDuringLead: number }
      >();
      for (const point of forecast.forecast) {
        if (!input.locationIds!.includes(point.locationId) || point.channel !== input.channel)
          continue;
        const key = point.variantId + ':' + point.locationId;
        const value = aggregated.get(key) ?? {
          variantId: point.variantId,
          locationId: point.locationId,
          demandDuringLead: 0,
        };
        const lastLeadDay = new Date(Date.parse(forecast.period.from + 'T00:00:00Z') + 6 * 86400000)
          .toISOString()
          .slice(0, 10);
        if (point.date <= lastLeadDay) value.demandDuringLead += point.predictedUnits;
        aggregated.set(key, value);
      }
      job.inventorySnapshot = [...aggregated.values()].map((value) => ({
        ...value,
        available: 0,
        safetyStock: 3,
        confirmedInboundNotInAvailable: 0,
        leadTimeDays: 7,
        demandSource: 'FORECAST',
      }));
    }
    const raw = await this.worker.run(job, signal);
    const prepared = await ingestAnalysis(
      job.tenantId,
      actor.id,
      row.id,
      row.modelo_id,
      input,
      raw,
    );
    if (inherited) {
      prepared.result.dataset = this.results.view(dependency!).result!.dataset;
      prepared.result.labels = this.results.view(dependency!).result!.labels;
      prepared.artifacts = {
        files: { ...inherited.files, ...prepared.artifacts.files },
        datasetJobId: input.datasetJobId ?? inherited.datasetJobId,
        modelJobId: input.modelJobId ?? inherited.modelJobId,
      };
      if (input.action === 'TRAIN_DEMAND' || input.action === 'TRAIN_ANOMALY')
        prepared.artifacts.datasetJobId = dependency!.id;
      if (input.action === 'FORECAST') {
        prepared.artifacts.modelJobId = dependency!.id;
        prepared.result.model = this.results.view(dependency!).result!.model;
      }
      if (input.action === 'SUGGEST_RESTOCK') {
        prepared.result.model = this.results.view(dependency!).result!.model;
        prepared.result.limitations.push(
          'El inventario de demostración usa disponible 0, seguridad 3 y entrante 0. Revisa los supuestos antes de interpretar cantidades.',
        );
      }
    }
    return prepared;
  }
  private async realStock(row: ejecucion_analitica, actor: Identity): Promise<Prepared> {
    const input = jobMetadata(row).input;
    await this.results.access(actor, input);
    const now = new Date().toISOString();
    const balances = await this.db.inventario.findMany({
      where: { ubicacion_id: { in: input.locationIds } },
      take: 10001,
      include: {
        ubicacion: true,
        variante: {
          include: { producto: true, disponibilidad_canal: { where: { canal: input.channel } } },
        },
      },
      orderBy: [{ ubicacion_id: 'asc' }, { variante_id: 'asc' }],
    });
    if (balances.length > 10000)
      throw new AnalyticsWorkerError(
        'ANALYTICS_COVERAGE_LIMIT',
        'Selecciona menos ubicaciones para consultar hasta 10.000 saldos.',
      );
    const result = AnalysisResultSchema.parse({
      schemaVersion: '1.0',
      source: 'REAL',
      action: 'SUGGEST_RESTOCK',
      asOf: now,
      period: { from: boliviaDate(now), to: boliviaDate(now) },
      locationIds: input.locationIds,
      limitations: [
        'MODEL_DATA_INSUFFICIENT. Regla de stock de seguridad sin demanda estimada ni entrantes confirmados.',
      ],
      metrics: [],
      labels: {
        locations: Object.fromEntries(
          balances.map((balance) => [balance.ubicacion_id, balance.ubicacion.nombre]),
        ),
        variants: Object.fromEntries(
          balances.map((balance) => [
            balance.variante_id,
            [balance.variante.producto.nombre, balance.variante.talla, balance.variante.color].join(
              ' · ',
            ),
          ]),
        ),
      },
      forecast: [],
      alerts: [],
      suggestions: balances.map((balance) => {
        const available = Math.max(0, balance.fisico - balance.reservado - balance.comprometido);
        const safety =
          balance.variante.disponibilidad_canal.find(
            (item) => item.ubicacion_id === balance.ubicacion_id,
          )?.stock_seguridad ?? 0;
        return {
          variantId: balance.variante_id,
          locationId: balance.ubicacion_id,
          suggestedQuantity: Math.max(0, safety - available),
          available,
          safetyStock: safety,
          demandDuringLead: 0,
          confirmedInbound: 0,
          leadTimeDays: 0,
          demandSource: 'REGLA_BASICA',
          inventoryAsOf: now,
          limitations: ['Sin pronóstico ML para esta tienda.'],
          effect: 'SUGGESTION_ONLY',
        };
      }),
    });
    return { result, artifacts: { files: {} }, dataset: undefined, modelMetadata: undefined };
  }
  private async save(row: ejecucion_analitica, prepared: Prepared) {
    const { result, artifacts } = prepared;
    let datasetId: string | undefined = artifacts.datasetJobId;
    await this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'analysis-job', row.id);
      const current = await tx.ejecucion_analitica.findUniqueOrThrow({ where: { id: row.id } });
      if (current.estado !== 'PENDIENTE' || jobMetadata(current).queue.state !== 'RUNNING')
        throw new AnalyticsWorkerError(
          'ANALYTICS_INTERRUPTED',
          'La ejecución dejó de estar activa.',
        );
      const meta = jobMetadata(current);
      meta.artifacts = artifacts;
      if (prepared.dataset) {
        const manifest = prepared.dataset.manifest as Record<string, unknown>;
        const catalog = prepared.dataset.catalog as Record<string, unknown>;
        datasetId = row.id;
        await tx.conjunto_entrenamiento.create({
          data: {
            id: row.id,
            nombre: datasetCode,
            version: row.id,
            origen: 'SINTETICO',
            espacio_identificadores: 'demo',
            esquema_version: 1,
            desde: new Date(result.period.from),
            hasta: new Date(result.period.to),
            cortes_temporales: json(manifest.splits),
            catalogo_referencia: json(catalog),
            ubicaciones_referencia: json(catalog.locations),
            canales_referencia: json(catalog.channels),
            parametros_generacion: { seed: 42, version: '1.0.0' },
            clave_datos: artifacts.files['panel.csv'].path,
            sha256: result.dataset!.sha256,
            filas: result.dataset!.rows,
            creado_por: row.solicitante_id,
            creado_en: new Date(),
          },
        });
      }
      if (prepared.modelMetadata && datasetId) {
        await tx.modelo_analitico.update({
          where: { id: row.modelo_id },
          data: {
            estado: 'ENTRENADO',
            procedencia: 'DEMOSTRACION',
            algoritmo: result.model!.algorithm,
            version: result.model!.version + '-' + row.id.slice(0, 8),
            conjunto_entrenamiento_id: datasetId,
            clave_artefacto: artifacts.files.model.path,
            sha256_artefacto: artifacts.files.model.sha256,
            entrenado_en: new Date(),
            metricas_validacion: json(result.metrics),
            parametros: json(prepared.modelMetadata),
          },
        });
        for (const metric of result.metrics)
          await tx.metrica_modelo.create({
            data: {
              modelo_id: row.modelo_id,
              conjunto_id: datasetId,
              particion: metric.partition,
              nombre: metric.name,
              valor: metric.value,
              valor_referencia: metric.baseline,
              horizonte_dias: metric.horizonDays,
              segmento: { source: result.source, scope: 'dataset_completo' },
              segmento_hash: requestHash({ source: result.source, scope: 'dataset_completo' }),
              observaciones: metric.observations,
              calculada_en: new Date(),
              estado: metric.status,
              motivo_no_aplica: metric.reason,
            },
          });
      }
      await tx.ejecucion_analitica.update({
        where: { id: row.id },
        data: {
          estado: 'COMPLETADA',
          terminada_en: new Date(),
          filtros: json(meta),
          conjunto_id: datasetId,
          desde: new Date(result.period.from),
          hasta: new Date(result.period.to),
          limitaciones: result.limitations,
          ...(meta.input.source === 'REAL'
            ? { metricas: json(result) }
            : { resultado_demostracion: json(result) }),
        },
      });
    });
  }
  private async fail(row: ejecucion_analitica, code: string, message: string) {
    await this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'analysis-job', row.id);
      const fresh = await tx.ejecucion_analitica.findUniqueOrThrow({ where: { id: row.id } });
      if (fresh.estado !== 'PENDIENTE') return;
      const meta = jobMetadata(fresh);
      meta.errorCode = code;
      meta.message = message;
      await tx.ejecucion_analitica.update({
        where: { id: row.id },
        data: {
          estado: 'FALLIDA',
          filtros: json(meta),
          terminada_en: new Date(),
          limitaciones: [message],
        },
      });
      await tx.modelo_analitico.update({
        where: { id: row.modelo_id },
        data: { estado: 'FALLIDO' },
      });
    });
  }
}
