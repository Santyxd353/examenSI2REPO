import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type definicion_reporte } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ReportDefinitionSchema, UuidSchema, type ReportDefinition } from '@lumina/contracts';
import { z } from 'zod';
import { Db } from '../db';
import { requirePermission, type Identity } from '../auth';
import { requireCapacity } from '../tenancy/capacity';
import { lockOperation, requestHash } from '../commerce/idempotency';
import { currentTenant } from '../tenancy/context';

const version = z.number().int().positive().max(2147483646);
const createInput = z.strictObject({
  operationId: UuidSchema.optional(),
  definition: ReportDefinitionSchema,
});
const editInput = z.strictObject({ expectedVersion: version, definition: ReportDefinitionSchema });
const archiveInput = z.strictObject({ expectedVersion: z.coerce.number().pipe(version) });
const missing = () => new NotFoundException('Reporte guardado no disponible.');

function storedDefinition(raw: ReportDefinition, id: string) {
  const title = raw.title.trim();
  if (!title || title.length > 120)
    throw new BadRequestException('El nombre del reporte requiere entre 1 y 120 caracteres.');
  return { ...raw, title, id };
}
function fields(definition: ReportDefinition) {
  const { dashboard, ...specification } = definition;
  return {
    nombre: definition.title,
    especificacion: JSON.parse(JSON.stringify(specification)) as Prisma.InputJsonObject,
    diseno: JSON.parse(JSON.stringify(dashboard)) as Prisma.InputJsonObject,
  };
}
function view(row: definicion_reporte) {
  return {
    id: row.id,
    tenantId: currentTenant()!.id,
    ownerId: row.autor_id,
    version: row.version,
    state: row.estado,
    updatedAt: row.actualizada_en.toISOString(),
    definition: ReportDefinitionSchema.parse({
      ...(row.especificacion as object),
      id: row.id,
      dashboard: row.diseno,
    }),
  };
}
function checkVersion(row: definicion_reporte, expected: number) {
  if (row.version !== expected)
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'El reporte cambió. Abre la versión actual antes de guardar.',
      details: { currentVersion: row.version },
    });
}

@Injectable()
export class ReportDefinitionsService {
  constructor(@Inject(Db) private db: Db) {}
  private permission(actor: Identity) {
    requirePermission(actor, 'reportes:consultar');
  }
  private async audit(
    tx: Prisma.TransactionClient,
    actor: Identity,
    row: definicion_reporte,
    action: string,
    hash?: string,
  ) {
    await tx.auditoria.create({
      data: {
        actor_id: actor.id,
        entidad: 'definicion_reporte',
        entidad_id: row.id,
        accion: action,
        correlacion: action === 'REPORT_DEFINITION_CREATE' ? row.id : randomUUID(),
        cambios: {
          version: row.version,
          estado: row.estado,
          ...(hash ? { requestHash: hash } : {}),
        },
        creado_en: new Date(),
      },
    });
  }
  async list(actor: Identity) {
    this.permission(actor);
    return {
      definitions: (
        await this.db.definicion_reporte.findMany({
          where: { autor_id: actor.id, estado: 'ACTIVA' },
          orderBy: [{ actualizada_en: 'desc' }, { id: 'asc' }],
        })
      ).map(view),
    };
  }
  async get(actor: Identity, id: string) {
    this.permission(actor);
    const row = await this.db.definicion_reporte.findFirst({
      where: { id: UuidSchema.parse(id), autor_id: actor.id, estado: 'ACTIVA' },
    });
    if (!row) throw missing();
    return view(row);
  }
  async create(actor: Identity, raw: unknown) {
    this.permission(actor);
    const input = createInput.parse(raw),
      id = input.operationId ?? randomUUID();
    const definition = storedDefinition(input.definition, id),
      hash = requestHash(definition);
    return this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'report-definition', id);
      const old = await tx.definicion_reporte.findUnique({ where: { id } });
      if (old) {
        if (old.autor_id !== actor.id) throw missing();
        const audit = await tx.auditoria.findFirst({
          where: { entidad_id: id, actor_id: actor.id, accion: 'REPORT_DEFINITION_CREATE' },
          select: { cambios: true },
        });
        if ((audit?.cambios as { requestHash?: string } | null)?.requestHash !== hash)
          throw new ConflictException({
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
            message: 'Ese UUID ya identifica otra definición.',
          });
        return view(old);
      }
      await requireCapacity(tx, 'savedReports');
      const now = new Date();
      const row = await tx.definicion_reporte.create({
        data: {
          id,
          autor_id: actor.id,
          version: 1,
          esquema_version: 1,
          estado: 'ACTIVA',
          creada_en: now,
          actualizada_en: now,
          ...fields(definition),
        },
      });
      await this.audit(tx, actor, row, 'REPORT_DEFINITION_CREATE', hash);
      return view(row);
    });
  }
  async edit(actor: Identity, rawId: string, raw: unknown) {
    this.permission(actor);
    const id = UuidSchema.parse(rawId),
      input = editInput.parse(raw);
    const definition = storedDefinition(input.definition, id);
    return this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'report-definition', id);
      const row = await tx.definicion_reporte.findFirst({
        where: { id, autor_id: actor.id, estado: 'ACTIVA' },
      });
      if (!row) throw missing();
      checkVersion(row, input.expectedVersion);
      const updated = await tx.definicion_reporte.update({
        where: { id },
        data: {
          ...fields(definition),
          version: { increment: 1 },
          actualizada_en: new Date(),
        },
      });
      await this.audit(tx, actor, updated, 'REPORT_DEFINITION_UPDATE');
      return view(updated);
    });
  }
  async archive(actor: Identity, rawId: string, raw: unknown) {
    this.permission(actor);
    const id = UuidSchema.parse(rawId),
      { expectedVersion } = archiveInput.parse(raw);
    return this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'report-definition', id);
      const row = await tx.definicion_reporte.findFirst({ where: { id, autor_id: actor.id } });
      if (!row) throw missing();
      if (row.estado === 'ARCHIVADA' && row.version === expectedVersion + 1) return view(row);
      checkVersion(row, expectedVersion);
      if (row.estado === 'ARCHIVADA') return view(row);
      const updated = await tx.definicion_reporte.update({
        where: { id },
        data: {
          estado: 'ARCHIVADA',
          version: { increment: 1 },
          actualizada_en: new Date(),
        },
      });
      await this.audit(tx, actor, updated, 'REPORT_DEFINITION_ARCHIVE');
      return view(updated);
    });
  }
}
