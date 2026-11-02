import { ForbiddenException, Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChildProcess, spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { relative, resolve } from 'path';
import { Db } from './db';
import { Identity, requirePermission } from './auth';
import { TenantRegistry } from './tenancy/platform';
import { TenantContext, currentTenant, runForTenant } from './tenancy/context';

const SOURCE = 'DEMOSTRACION_SINTETICA';
const WORKER_MODEL = 'Worker ML sintético';
const DATE_FROM = new Date('2025-10-01T00:00:00.000Z');
const DATE_TO = new Date('2026-09-30T00:00:00.000Z');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

type Workflow = Readonly<{
  id: string;
  demandExecutionId: string;
  anomalyExecutionId: string;
  actorId: string;
}>;

type WorkerResponse = Readonly<{
  ok: boolean;
  jobId?: string;
  resultPath?: string;
  sha256?: string;
  error?: { code?: string };
}>;

class AnalyticsWorkerError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class AnalyticsJobs implements OnModuleDestroy {
  private readonly active = new Set<string>();
  private readonly timeoutMs = Number(process.env.ANALYTICS_TIMEOUT_MS || 2_100_000);
  private child?: ChildProcess;
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(TenantRegistry) private readonly registry: TenantRegistry,
  ) {}

  start() {
    this.timer = setInterval(() => void this.resume().catch(() => undefined), 15_000);
    this.timer.unref();
    void this.resume().catch(() => undefined);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.child?.kill();
  }

  async scheduleDemoTraining(user: Identity) {
    requirePermission(user, 'reportes:consultar');
    const tenant = currentTenant();
    if (!tenant) throw new ForbiddenException('No hay una tienda activa para ejecutar la analítica.');
    const [demandModel, anomalyModel] = await Promise.all([
      this.db.modelo_analitico.upsert({
        where: { tipo_nombre_version: { tipo: 'DEMANDA', nombre: WORKER_MODEL, version: '1.0' } },
        update: { estado: 'ACTIVO' },
        create: {
          tipo: 'DEMANDA',
          nombre: WORKER_MODEL,
          version: '1.0',
          parametros: { worker: 'RandomForestRegressor', source: SOURCE, horizons: [7, 30] },
          estado: 'ACTIVO',
        },
      }),
      this.db.modelo_analitico.upsert({
        where: { tipo_nombre_version: { tipo: 'ANOMALIA', nombre: WORKER_MODEL, version: '1.0' } },
        update: { estado: 'ACTIVO' },
        create: {
          tipo: 'ANOMALIA',
          nombre: WORKER_MODEL,
          version: '1.0',
          parametros: { worker: 'IsolationForest', source: SOURCE },
          estado: 'ACTIVO',
        },
      }),
    ]);
    const workflowId = randomUUID();
    const base = { workflowId, tenantId: tenant.id, source: SOURCE, kind: 'B02_B03_WORKER' };
    const [demand, anomaly] = await Promise.all([
      this.db.ejecucion_analitica.create({
        data: {
          modelo_id: demandModel.id,
          solicitante_id: user.id,
          desde: DATE_FROM,
          hasta: DATE_TO,
          filtros: { ...base, role: 'DEMAND' },
          estado: 'PENDIENTE',
          creada_en: new Date(),
        },
      }),
      this.db.ejecucion_analitica.create({
        data: {
          modelo_id: anomalyModel.id,
          solicitante_id: user.id,
          desde: DATE_FROM,
          hasta: DATE_TO,
          filtros: { ...base, role: 'ANOMALY' },
          estado: 'PENDIENTE',
          creada_en: new Date(),
        },
      }),
    ]);
    const workflow = { id: workflowId, demandExecutionId: demand.id, anomalyExecutionId: anomaly.id, actorId: user.id };
    this.enqueue(tenant, workflow);
    return { workflowId, source: SOURCE, status: 'PENDIENTE', executionIds: { demand: demand.id, anomalies: anomaly.id } };
  }

  async status(user: Identity, id: string) {
    requirePermission(user, 'reportes:consultar');
    const execution = await this.db.ejecucion_analitica.findUnique({
      where: { id },
      include: { modelo_analitico: { select: { tipo: true, nombre: true, version: true } } },
    });
    if (!execution) throw new ForbiddenException('La ejecución analítica no está disponible.');
    return {
      id: execution.id,
      status: execution.estado,
      model: execution.modelo_analitico,
      metrics: execution.metricas,
      createdAt: execution.creada_en,
      source: (execution.filtros as Record<string, unknown>).source ?? 'REAL',
    };
  }

  private async resume() {
    for (const tenant of await this.registry.listForMaintenance()) {
      await runForTenant(tenant, async () => {
        const pending = await this.db.ejecucion_analitica.findMany({
          where: { estado: 'PENDIENTE', modelo_analitico: { nombre: WORKER_MODEL } },
          orderBy: { creada_en: 'asc' },
          take: 20,
        });
        for (const row of pending) {
          const filters = row.filtros as Record<string, unknown>;
          if (filters.kind !== 'B02_B03_WORKER' || typeof filters.workflowId !== 'string') continue;
          const pair = pending.find(
            (candidate) =>
              candidate.id !== row.id &&
              (candidate.filtros as Record<string, unknown>).workflowId === filters.workflowId,
          );
          if (!pair) continue;
          const demand = (row.filtros as Record<string, unknown>).role === 'DEMAND' ? row : pair;
          const anomaly = demand.id === row.id ? pair : row;
          this.enqueue(tenant, {
            id: filters.workflowId,
            demandExecutionId: demand.id,
            anomalyExecutionId: anomaly.id,
            actorId: row.solicitante_id,
          });
          break;
        }
      });
    }
  }

  private enqueue(tenant: TenantContext, workflow: Workflow) {
    const key = `${tenant.id}:${workflow.id}`;
    if (this.active.has(key)) return;
    this.active.add(key);
    void runForTenant(tenant, () => this.runWorkflow(workflow))
      .catch(() => undefined)
      .finally(() => this.active.delete(key));
  }

  private async runWorkflow(workflow: Workflow) {
    // Un proceso Python a la vez: evita que dos entrenamientos compitan por RAM en el servidor local.
    if (this.busy) return;
    this.busy = true;
    try {
    const rows = await this.db.ejecucion_analitica.findMany({
      where: { id: { in: [workflow.demandExecutionId, workflow.anomalyExecutionId] } },
    });
    if (rows.length !== 2 || rows.some((row) => row.estado !== 'PENDIENTE')) return;
    await this.db.ejecucion_analitica.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, estado: 'PENDIENTE' },
      // El esquema histórico permite PENDIENTE/COMPLETADA/FALLIDA/SIN_DATOS.
      // La fase de ejecución vive en métricas sin inventar un estado no permitido.
      data: { metricas: { source: SOURCE, phase: 'PROCESANDO' } },
    });
    try {
      const tenantId = rows[0].filtros as Record<string, unknown>;
      const workDir = `.local/analytics/api/${String(tenantId.workflowId)}`;
      const root = resolve(workDir);
      await mkdir(root, { recursive: true });
      const generated = await this.invoke(root, {
        jobId: `dataset-${workflow.id}`,
        tenantId: String((rows[0].filtros as Record<string, unknown>).tenantId || 'tenant-local'),
        actorId: workflow.actorId,
        action: 'GENERATE_DATASET',
        workDir,
        parameters: {},
      });
      const demand = await this.invoke(root, {
        jobId: `demand-${workflow.demandExecutionId}`,
        tenantId: String((rows[0].filtros as Record<string, unknown>).tenantId || 'tenant-local'),
        actorId: workflow.actorId,
        action: 'TRAIN_DEMAND',
        workDir,
        parameters: { panelPath: `datasets/dataset-${workflow.id}/panel.csv`, nEstimators: 200 },
      });
      const anomaly = await this.invoke(root, {
        jobId: `anomaly-${workflow.anomalyExecutionId}`,
        tenantId: String((rows[0].filtros as Record<string, unknown>).tenantId || 'tenant-local'),
        actorId: workflow.actorId,
        action: 'TRAIN_ANOMALY',
        workDir,
        parameters: {
          panelPath: `datasets/dataset-${workflow.id}/anomaly-panel.csv`,
          labelsPath: `datasets/dataset-${workflow.id}/anomaly-labels.csv`,
        },
      });
      await this.db.$transaction([
        this.db.ejecucion_analitica.update({
          where: { id: workflow.demandExecutionId },
          data: { estado: 'COMPLETADA', metricas: { source: SOURCE, generated, worker: demand } },
        }),
        this.db.ejecucion_analitica.update({
          where: { id: workflow.anomalyExecutionId },
          data: { estado: 'COMPLETADA', metricas: { source: SOURCE, worker: anomaly } },
        }),
      ]);
    } catch (error) {
      const code = error instanceof AnalyticsWorkerError ? error.code : 'ANALYTICS_FAILED';
      await this.db.ejecucion_analitica.updateMany({
        where: { id: { in: [workflow.demandExecutionId, workflow.anomalyExecutionId] } },
        data: { estado: 'FALLIDA', metricas: { source: SOURCE, errorCode: code } },
      });
    }
    } catch {
      await this.db.ejecucion_analitica.updateMany({
        where: { id: { in: [workflow.demandExecutionId, workflow.anomalyExecutionId] } },
        data: { estado: 'FALLIDA', metricas: { source: SOURCE, errorCode: 'SUPERVISOR_FAILED' } },
      });
    } finally {
      this.busy = false;
    }
  }

  private async invoke(
    workRoot: string,
    input: { jobId: string; tenantId: string; actorId: string; action: string; workDir: string; parameters: Record<string, unknown> },
  ) {
    await mkdir(workRoot, { recursive: true });
    const jobFile = resolve(workRoot, `${input.jobId}.json`);
    await writeFile(
      jobFile,
      JSON.stringify({ schemaVersion: '1.0', ...input, source: SOURCE, datasetId: 'demo-femenino-seed42-v1', inventorySnapshot: [] }),
      'utf8',
    );
    const response = await new Promise<WorkerResponse>((resolveResult, reject) => {
      const child = spawn(
        resolve(process.env.ANALYTICS_PYTHON_PATH || '.local/analytics-venv/Scripts/python.exe'),
        ['-m', 'lumina_analytics.cli', '--job', jobFile],
        { cwd: resolve('workers/analytics'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.child = child;
      let stdout = '';
      const timeout = setTimeout(() => {
        child.kill();
        reject(new AnalyticsWorkerError('TIMEOUT'));
      }, this.timeoutMs);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString()).slice(-200_000);
      });
      child.on('error', () => {
        clearTimeout(timeout);
        reject(new AnalyticsWorkerError('WORKER_UNAVAILABLE'));
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        this.child = undefined;
        try {
          const parsed = JSON.parse(stdout.trim()) as WorkerResponse;
          if (code !== 0 || !parsed.ok) throw new AnalyticsWorkerError(parsed.error?.code || 'WORKER_FAILED');
          resolveResult(parsed);
        } catch (error) {
          reject(error instanceof AnalyticsWorkerError ? error : new AnalyticsWorkerError('INVALID_WORKER_OUTPUT'));
        }
      });
    });
    if (!response.resultPath || !response.sha256 || !/^[a-f0-9]{64}$/i.test(response.sha256))
      throw new AnalyticsWorkerError('INVALID_WORKER_OUTPUT');
    const result = resolve(workRoot, response.resultPath);
    if (relative(workRoot, result).startsWith('..')) throw new AnalyticsWorkerError('INVALID_RESULT_PATH');
    const content = await readFile(result);
    if (sha256(content) !== response.sha256) throw new AnalyticsWorkerError('RESULT_HASH_MISMATCH');
    const parsed = JSON.parse(content.toString('utf8')) as Record<string, unknown>;
    if (parsed.source !== SOURCE || parsed.jobId !== input.jobId)
      throw new AnalyticsWorkerError('INVALID_RESULT_SCOPE');
    return { sha256: response.sha256, resultPath: response.resultPath, action: input.action, metrics: parsed.metrics ?? null } as Prisma.InputJsonValue;
  }
}
