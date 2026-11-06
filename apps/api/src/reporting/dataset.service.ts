import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { readFile, unlink } from 'fs/promises';
import {
  canonicalJson,
  ReportDatasetManifestSchema,
  ReportDatasetPageSchema,
  ReportDatasetRequestSchema,
  ReportDatasetSchema,
  ReportDefinitionSchema,
  UuidSchema,
  type ReportDataset,
  type ReportDatasetManifest,
  type ReportDatasetRow,
} from '@lumina/contracts';
import { boliviaDate, executeReport, ReportError } from '@lumina/reporting';
import { z } from 'zod';
import { requirePermission, type Identity } from '../auth';
import { requestHash } from '../commerce/idempotency';
import { Db } from '../db';
import { can } from '../inventory/scope';
import { readStoredFile, writePrivateDocument } from '../offline/private-files';
import { storedPath } from '../storage';
import { currentTenant } from '../tenancy/context';
import { captureFacts } from './facts.repository';

const DAY = 86400000;
const MAX_BYTES = 64 * 1024 * 1024;
const sourceDirectory = (source: ReportDataset['source']) =>
  source === 'REAL' ? 'report-real' : 'report-demo';
const storageKey = (source: ReportDataset['source'], actorId: string, id: string) =>
  `private/offline/${sourceDirectory(source)}/${actorId}/${id}.json`;
const missing = () => new NotFoundException('Conjunto de reportes no disponible.');
const pageInput = z.strictObject({
  offset: z.coerce.number().int().min(0).max(50000).default(0),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});
const executeInput = z.strictObject({ definition: ReportDefinitionSchema });
function metadata(dataset: ReportDataset, expiresAt: Date) {
  const { sales, orders, payments, returns, refunds, stock, ...rest } = dataset;
  return ReportDatasetManifestSchema.parse({ ...rest, expiresAt: expiresAt.toISOString() });
}
function sliceRows(dataset: ReportDataset, offset: number, pageSize: number) {
  const result: ReportDatasetRow[] = [];
  let start = 0;
  for (const kind of ['sales', 'orders', 'payments', 'returns', 'refunds', 'stock'] as const) {
    const facts = dataset[kind];
    const from = Math.max(0, offset - start),
      to = Math.min(facts.length, offset + pageSize - start);
    for (let i = from; i < to; i++) result.push({ kind, fact: facts[i] } as ReportDatasetRow);
    start += facts.length;
    if (start >= offset + pageSize) break;
  }
  return result;
}

@Injectable()
export class ReportDatasetService {
  constructor(@Inject(Db) private db: Db) {}

  private async locations(
    tx: Pick<Prisma.TransactionClient, 'ubicacion'>,
    actor: Identity,
    requested?: string[],
  ) {
    const all = actor.roles.includes('Administrador') || can(actor, 'ubicaciones:gestionar');
    const locations = (
      await tx.ubicacion.findMany({
        where: {
          ...(requested ? { id: { in: requested } } : {}),
          ...(all ? {} : { usuario_ubicacion: { some: { usuario_id: actor.id } } }),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 101,
      })
    ).map((row) => row.id);
    if (requested?.some((id) => !locations.includes(id)))
      throw new ForbiddenException('No tienes acceso a todas las ubicaciones del conjunto.');
    if (locations.length > 100)
      throw new UnprocessableEntityException('Selecciona hasta 100 ubicaciones para la descarga.');
    return locations;
  }

  async create(actor: Identity, raw: unknown) {
    requirePermission(actor, 'reportes:consultar');
    const input = ReportDatasetRequestSchema.parse(raw);
    const tenantId = currentTenant()!.id,
      datasetId = randomUUID();
    const identity = {
      datasetId,
      tenantId,
      ownerId: actor.id,
      schemaVersion: '1.0' as const,
      semanticsVersion: '1.0' as const,
    };
    const definition = input.definitionId
      ? await this.db.definicion_reporte.findFirst({
          where: { id: input.definitionId, autor_id: actor.id, estado: 'ACTIVA' },
        })
      : null;
    if (input.definitionId && !definition) throw missing();
    const savedDefinition = definition
      ? ReportDefinitionSchema.parse({
          ...(definition.especificacion as object),
          dashboard: definition.diseno,
          id: definition.id,
        })
      : undefined;
    if (savedDefinition && savedDefinition.source !== input.source)
      throw new BadRequestException('La fuente de la definición no coincide con la descarga.');

    let unsigned: Omit<ReportDataset, 'sha256'>;
    if (input.source === 'REAL') {
      const { from, to } = input.period;
      if (Date.parse(to) - Date.parse(from) > 730 * DAY)
        throw new BadRequestException('El período máximo de descarga es de dos años.');
      if (to > boliviaDate(new Date().toISOString()))
        throw new UnprocessableEntityException({
          code: 'DATASET_COVERAGE_INSUFFICIENT',
          message: 'La descarga no puede incluir fechas futuras.',
        });
      unsigned = await this.db.$transaction(
        async (tx) => {
          const locations = await this.locations(tx, actor, input.locationIds);
          if (!locations.length)
            throw new ForbiddenException('No tienes ubicaciones asignadas para reportes.');
          const facts = await captureFacts(tx, locations, input.period);
          return {
            ...facts,
            ...identity,
            source: input.source,
            authorizedLocationIds: locations,
            downloadedLocationIds: locations,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
      );
    } else {
      const fixture = JSON.parse(
        await readFile('packages/contracts/fixtures/report-golden-v1.json', 'utf8'),
      );
      const { sha256: _, ...demo } = ReportDatasetSchema.parse(fixture.dataset);
      unsigned = { ...demo, ...identity, source: input.source };
    }
    const dataset = ReportDatasetSchema.parse({ ...unsigned, sha256: requestHash(unsigned) });
    const now = new Date(),
      expiry = new Date(now.getTime() + DAY);
    const manifest = metadata(dataset, expiry);
    const key = storageKey(input.source, actor.id, datasetId);
    await writePrivateDocument(key, dataset, MAX_BYTES);
    try {
      await this.db.$transaction(async (tx) => {
        if (dataset.source === 'REAL')
          await this.locations(tx, actor, dataset.downloadedLocationIds);
        await tx.conjunto_reporte.create({
          data: {
            id: datasetId,
            solicitante_id: actor.id,
            definicion_id: definition?.id,
            definicion_version: definition?.version,
            esquema_version: 1,
            definicion_snapshot: savedDefinition
              ? ({ ...savedDefinition, datasetId } as Prisma.InputJsonObject)
              : {},
            cobertura: manifest,
            ambito_autorizado: {
              tenantId,
              source: dataset.source,
              locationIds: dataset.downloadedLocationIds,
            },
            clave_datos: key,
            sha256: dataset.sha256,
            filas: dataset.rowCount,
            bytes: Buffer.byteLength(canonicalJson(dataset)),
            generado_en: now,
            vence_en: expiry,
          },
        });
        await tx.auditoria.create({
          data: {
            actor_id: actor.id,
            entidad: 'conjunto_reporte',
            entidad_id: datasetId,
            accion: 'REPORT_DATASET_CREATE',
            correlacion: datasetId,
            creado_en: now,
            cambios: {
              source: dataset.source,
              filas: dataset.rowCount,
              complete: dataset.complete,
            },
          },
        });
      });
    } catch (error) {
      await unlink(storedPath(key)).catch(() => {});
      throw error;
    }
    return manifest;
  }

  async manifest(actor: Identity, rawId: string): Promise<ReportDatasetManifest> {
    requirePermission(actor, 'reportes:consultar');
    const id = UuidSchema.parse(rawId);
    const row = await this.db.conjunto_reporte.findFirst({
      where: { id, solicitante_id: actor.id },
    });
    if (!row) throw missing();
    const manifest = ReportDatasetManifestSchema.parse(row.cobertura);
    if (
      manifest.tenantId !== currentTenant()!.id ||
      manifest.ownerId !== actor.id ||
      manifest.datasetId !== id
    )
      throw missing();
    if (manifest.source === 'REAL')
      await this.locations(this.db, actor, manifest.downloadedLocationIds);
    if (!row.vence_en || row.vence_en.getTime() <= Date.now())
      throw new GoneException({
        code: 'REPORT_DATASET_EXPIRED',
        message: 'La descarga venció. Prepara un corte nuevo.',
      });
    return manifest;
  }

  async load(actor: Identity, id: string) {
    const manifest = await this.manifest(actor, id);
    try {
      const bytes = await readStoredFile(
        storageKey(manifest.source, actor.id, manifest.datasetId),
        MAX_BYTES,
      );
      const dataset = ReportDatasetSchema.parse(JSON.parse(bytes.toString('utf8')));
      const { sha256, ...unsigned } = dataset;
      if (
        sha256 !== manifest.sha256 ||
        requestHash(unsigned) !== sha256 ||
        canonicalJson(metadata(dataset, new Date(manifest.expiresAt))) !== canonicalJson(manifest)
      )
        throw new Error('El contenido no coincide con el manifiesto.');
      return dataset;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new GoneException({
          code: 'REPORT_DATASET_EXPIRED',
          message: 'La descarga ya no está disponible.',
        });
      throw new ServiceUnavailableException({
        code: 'REPORT_DATASET_INTEGRITY',
        message: 'No se pudo verificar la copia. Prepara una descarga nueva.',
      });
    }
  }

  async page(actor: Identity, id: string, query: unknown) {
    const { offset, pageSize } = pageInput.parse(query);
    const dataset = await this.load(actor, id);
    if (offset > dataset.rowCount) throw new BadRequestException('Página fuera de la descarga.');
    const rows = sliceRows(dataset, offset, pageSize),
      next = offset + rows.length;
    return ReportDatasetPageSchema.parse({
      datasetId: dataset.datasetId,
      asOf: dataset.asOf,
      sha256: dataset.sha256,
      offset,
      rows,
      nextOffset: next < dataset.rowCount ? next : null,
    });
  }

  async execute(actor: Identity, raw: unknown) {
    const { definition } = executeInput.parse(raw);
    const dataset = await this.load(actor, definition.datasetId);
    try {
      return executeReport(definition, dataset);
    } catch (error) {
      if (!(error instanceof ReportError)) throw error;
      const issue = error.problems[0];
      throw new UnprocessableEntityException({
        code: issue.code,
        message: issue.message,
        details: { problems: error.problems },
      });
    }
  }
}
