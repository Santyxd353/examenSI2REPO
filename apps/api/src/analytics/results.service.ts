import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AnalysisJobViewSchema,
  AnalysisRequestSchema,
  AnalysisResultSchema,
  UuidSchema,
  type AnalysisRequest,
} from '@lumina/contracts';
import type { ejecucion_analitica } from '@prisma/client';
import { requirePermission, type Identity } from '../auth';
import { Db } from '../db';
import { currentTenant } from '../tenancy/context';
import { EntitlementsService } from '../billing/entitlements.service';
import { demoLocations, type AnalysisArtifacts } from './artifacts';

export type JobMetadata = {
  kind: 'ML_JOB_V1';
  tenantId: string;
  input: AnalysisRequest;
  hash: string;
  queue: { state: 'QUEUED' | 'RUNNING'; startedAt?: string };
  artifacts?: AnalysisArtifacts;
  errorCode?: string;
  message?: string;
};
export function jobMetadata(row: ejecucion_analitica): JobMetadata {
  const value = row.filtros as unknown as JobMetadata;
  if (value.kind !== 'ML_JOB_V1' || value.tenantId !== currentTenant()!.id)
    throw new NotFoundException('Análisis no disponible.');
  return { ...value, input: AnalysisRequestSchema.parse(value.input) };
}
@Injectable()
export class AnalysisResults {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(EntitlementsService) private entitlements: EntitlementsService,
  ) {}

  async access(actor: Identity, input: AnalysisRequest) {
    requirePermission(actor, 'reportes:consultar');
    const plan = await this.entitlements.forTenant(currentTenant()!.id);
    if (!plan.features.demand || (input.action === 'TRAIN_ANOMALY' && !plan.features.anomalies))
      throw new ForbiddenException({
        code: 'FEATURE_NOT_INCLUDED',
        message: 'El análisis solicitado requiere un plan habilitado.',
      });
    const ids = input.locationIds;
    if (ids && new Set(ids).size !== ids.length)
      throw new ForbiddenException('Las ubicaciones no deben repetirse.');
    if ((ids?.length ?? 1) > 1 && !plan.features.multilocationAnalysis)
      throw new ForbiddenException('La comparación entre ubicaciones requiere Negocio.');
    if (input.source === 'DEMOSTRACION_SINTETICA') {
      const selected = ids ?? [demoLocations[0]];
      if (selected.some((id) => !demoLocations.includes(id)))
        throw new ForbiddenException('La ubicación está fuera del dataset de demostración.');
      return selected;
    }
    if (ids) ids.forEach((id) => UuidSchema.parse(id));
    const all =
      actor.roles.includes('Administrador') || actor.permissions.includes('ubicaciones:gestionar');
    const rows = await this.db.ubicacion.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(all ? {} : { usuario_ubicacion: { some: { usuario_id: actor.id } } }),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 101,
    });
    if (ids?.some((id) => !rows.some((row) => row.id === id)))
      throw new ForbiddenException('No tienes acceso a las ubicaciones del análisis.');
    if (rows.length > 1 && !ids && !plan.features.multilocationAnalysis)
      return rows.slice(0, 1).map((row) => row.id);
    if (!rows.length || rows.length > 100)
      throw new ForbiddenException('Selecciona ubicaciones autorizadas.');
    return rows.map((row) => row.id);
  }
  async row(actor: Identity, rawId: string) {
    const row = await this.db.ejecucion_analitica.findFirst({
      where: { id: UuidSchema.parse(rawId), solicitante_id: actor.id },
    });
    if (!row) throw new NotFoundException('Análisis no disponible.');
    await this.access(actor, jobMetadata(row).input);
    return row;
  }
  view(row: ejecucion_analitica) {
    const meta = jobMetadata(row);
    const rawResult = meta.input.source === 'REAL' ? row.metricas : row.resultado_demostracion;
    const result = rawResult === null ? null : AnalysisResultSchema.parse(rawResult);
    return AnalysisJobViewSchema.parse({
      id: row.id,
      source: meta.input.source,
      action: meta.input.action,
      status:
        row.estado === 'COMPLETADA'
          ? 'COMPLETED'
          : row.estado === 'FALLIDA'
            ? 'FAILED'
            : row.estado === 'SIN_DATOS'
              ? 'INSUFFICIENT_DATA'
              : meta.queue.state,
      createdAt: row.creada_en.toISOString(),
      startedAt: meta.queue.startedAt ?? null,
      completedAt: row.terminada_en?.toISOString() ?? null,
      errorCode: meta.errorCode ?? null,
      message: meta.message ?? null,
      result,
    });
  }
  async get(actor: Identity, id: string) {
    return this.view(await this.row(actor, id));
  }
  async list(actor: Identity) {
    requirePermission(actor, 'reportes:consultar');
    const entitlement = await this.entitlements.forTenant(currentTenant()!.id);
    if (!entitlement.features.demand)
      throw new ForbiddenException('Los análisis requieren Profesional o Negocio.');
    const rows = await this.db.ejecucion_analitica.findMany({
      where: { solicitante_id: actor.id, filtros: { path: ['kind'], equals: 'ML_JOB_V1' } },
      orderBy: [{ creada_en: 'desc' }, { id: 'desc' }],
      take: 30,
      omit: { metricas: true, resultado_demostracion: true },
    });
    const jobs = [];
    for (const row of rows) {
      try {
        const summary = { ...row, metricas: null, resultado_demostracion: null };
        await this.access(actor, jobMetadata(summary).input);
        jobs.push(this.view(summary));
      } catch (error) {
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return { jobs };
  }
}
