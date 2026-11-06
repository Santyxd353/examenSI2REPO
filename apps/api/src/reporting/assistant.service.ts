import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  REPORT_DIMENSIONS,
  REPORT_FILTER_FIELDS,
  REPORT_METRICS,
  ReportDefinitionSchema,
  UuidSchema,
  type ReportDataset,
} from '@lumina/contracts';
import { boliviaDate, validateReport } from '@lumina/reporting';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthService, requirePermission, type AuthRequest, type Identity } from '../auth';
import { EntitlementsService } from '../billing/entitlements.service';
import { QuotaService } from '../billing/quota.service';
import { assertRequestHash, lockOperation, requestHash } from '../commerce/idempotency';
import { Db } from '../db';
import { currentTenant } from '../tenancy/context';
import { TenantRegistry } from '../tenancy/platform';
import { invalidProposal, ReportAiProvider } from './ai-provider';
import { ReportDatasetService } from './dataset.service';

const resource = 'IA_INTERPRETACION';
const namespace = 'report-ai';
const staleMs = 120_000;
const requestSchema = z.strictObject({
  operationId: UuidSchema,
  datasetId: UuidSchema,
  text: z.string().trim().min(4).max(1200),
  channel: z.enum(['TEXTO', 'VOZ']).default('TEXTO'),
});
const responseSchema = z.strictObject({
  consultationId: UuidSchema,
  explanation: z.string().trim().min(1).max(500),
  definition: ReportDefinitionSchema.nullable(),
});
const providerSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('PROPOSE'),
    explanation: z.string().trim().min(1).max(500),
    specification: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    action: z.literal('CLARIFY'),
    explanation: z.string().trim().min(1).max(500),
    specification: z.null(),
  }),
]);
const writable = new Set([
  'title',
  'fact',
  'metrics',
  'dimensions',
  'period',
  'comparison',
  'filters',
  'chart',
  'order',
  'limit',
]);
const dimensions = ['categoria', 'marca', 'talla', 'color', 'canal', 'estado_pedido'] as const;
function allowedCatalog(data: ReportDataset) {
  const allowed = new Set(data.availableColumns);
  return {
    from: data.periodFrom,
    to: data.periodTo,
    stockDate: boliviaDate(data.asOf),
    metrics: REPORT_METRICS.filter((key) => allowed.has(key)),
    dimensions: REPORT_DIMENSIONS.filter((key) => allowed.has(key)),
    filters: REPORT_FILTER_FIELDS.filter((key) => allowed.has(key)),
    values: Object.fromEntries(
      dimensions
        .filter((key) => allowed.has(key))
        .map((key) => {
          const values = new Set<string>();
          for (const row of data.sales) {
            const value = row.dimensions[key];
            if (value) values.add(value);
            if (values.size >= 40) break;
          }
          return [key, [...values]];
        }),
    ),
  };
}

function proposal(raw: unknown, data: ReportDataset, operationId: string) {
  const parsed = providerSchema.safeParse(raw);
  if (!parsed.success) throw invalidProposal();
  const { specification, explanation } = parsed.data;
  if (!specification)
    return responseSchema.parse({ consultationId: operationId, explanation, definition: null });
  if (Object.keys(specification).some((key) => !writable.has(key))) throw invalidProposal();
  const stock = specification.fact === 'stock_al_corte';
  const at = boliviaDate(data.asOf);
  const definition = ReportDefinitionSchema.safeParse({
    schemaVersion: '1.0',
    source: data.source,
    datasetId: data.datasetId,
    timezone: 'America/La_Paz',
    currency: 'BOB',
    period: { from: stock ? at : data.periodFrom, to: stock ? at : data.periodTo, inclusive: true },
    dimensions: [],
    filters: [],
    order: [],
    chart: 'bar',
    limit: 12,
    dashboard: {
      widgets: [],
      crossFilter: true,
      detailAvailableColumns: (stock
        ? ['ubicacion', 'producto', 'variante', 'disponible_al_corte']
        : ['dia', 'ubicacion', 'producto', 'talla', 'canal', 'unidades', 'importe_bob']
      ).filter((key) => data.availableColumns.includes(key)),
    },
    ...specification,
  });
  if (!definition.success || !validateReport(definition.data, data).ok) throw invalidProposal();
  return responseSchema.parse({
    consultationId: operationId,
    explanation,
    definition: definition.data,
  });
}

const audioTypes: Record<string, { extension: string; valid: (file: Buffer) => boolean }> = {
  'audio/wav': {
    extension: 'wav',
    valid: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE',
  },
  'audio/webm': {
    extension: 'webm',
    valid: (b) => b.subarray(0, 4).toString('hex') === '1a45dfa3',
  },
  'audio/ogg': { extension: 'ogg', valid: (b) => b.subarray(0, 4).toString() === 'OggS' },
  'audio/mp4': { extension: 'm4a', valid: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  'audio/x-m4a': { extension: 'm4a', valid: (b) => b.subarray(4, 8).toString() === 'ftyp' },
};

@Injectable()
export class ReportAssistantService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AuthService) private auth: AuthService,
    @Inject(TenantRegistry) private registry: TenantRegistry,
    @Inject(EntitlementsService) private entitlements: EntitlementsService,
    @Inject(QuotaService) private quota: QuotaService,
    @Inject(ReportDatasetService) private datasets: ReportDatasetService,
    @Inject(ReportAiProvider) private provider: ReportAiProvider,
  ) {}

  private async authorized<T>(
    request: AuthRequest,
    work: (
      entitlement: Awaited<ReturnType<EntitlementsService['forTenant']>>,
      actor: Identity,
    ) => Promise<T>,
  ) {
    const scope = currentTenant()!;
    return this.registry.withWriteAccess(scope, async (tenant) => {
      const actor = await this.auth.verify(request.headers.authorization?.replace(/^Bearer /, ''));
      if (actor.id !== request.user.id) throw new ForbiddenException('La cuenta cambió.');
      requirePermission(actor, 'reportes:consultar');
      const entitlement = await this.entitlements.forTenant(tenant.id);
      if (!entitlement.features.aiReports)
        throw new ForbiddenException({
          code: 'REPORT_AI_PLAN_REQUIRED',
          message: 'La asistencia de reportes está disponible en Profesional y Negocio.',
        });
      return work(entitlement, actor);
    });
  }

  private async releaseStale(tx: Prisma.TransactionClient) {
    const old = await tx.consumo_cuota.findMany({
      where: {
        recurso: resource,
        estado: 'RESERVADO',
        creado_en: { lt: new Date(Date.now() - staleMs) },
      },
      select: { consulta_analitica_id: true },
      take: 100,
    });
    for (const row of old) {
      const id = row.consulta_analitica_id!;
      await lockOperation(tx, namespace, id);
      const consultation = await tx.consulta_analitica.findUniqueOrThrow({ where: { id } });
      if (consultation.estado === 'ACLARACION' && consultation.resultado_resumen === null) {
        await this.quota.release(tx, resource, id);
        await tx.consulta_analitica.update({ where: { id }, data: { estado: 'RECHAZADA' } });
      }
    }
  }

  async interpret(request: AuthRequest, raw: unknown) {
    const actor = request.user;
    const input = requestSchema.parse(raw);
    const id = input.operationId;
    const hash = requestHash(input);
    requirePermission(actor, 'reportes:consultar');
    const pending = await this.authorized(request, async (entitlement, freshActor) => {
      const data = await this.datasets.load(freshActor, input.datasetId);
      return this.db.$transaction(async (tx) => {
        await this.releaseStale(tx);
        await lockOperation(tx, namespace, id);
        const previous = await tx.consulta_analitica.findUnique({ where: { id } });
        if (previous) {
          if (previous.usuario_id !== actor.id || previous.tipo !== 'LENGUAJE')
            throw new NotFoundException('Consulta no disponible.');
          assertRequestHash(
            (previous.interpretacion as { requestHash?: string }).requestHash,
            hash,
          );
          if (previous.resultado_resumen)
            return { replay: responseSchema.parse(previous.resultado_resumen) };
          return { conflict: previous.estado === 'RECHAZADA' };
        }
        const { model } = this.provider.model('text');
        await tx.consulta_analitica.create({
          data: {
            id,
            usuario_id: actor.id,
            tipo: 'LENGUAJE',
            estado: 'ACLARACION',
            canal_entrada: input.channel,
            proveedor_ia: 'openai',
            modelo_ia: model,
            interpretacion: { requestHash: hash },
            filtros: [],
            creada_en: new Date(),
          },
        });
        await this.quota.reserve(tx, resource, id, {
          actorId: actor.id,
          operationId: id,
          planCode: entitlement.planCode,
          periodFrom: entitlement.periodFrom,
          periodTo: entitlement.periodTo,
          subscriptionVersion: currentTenant()!.subscription?.version ?? 1,
        });
        return { data };
      });
    });
    if (pending.replay) return pending.replay;
    if (!pending.data)
      throw new ConflictException({
        code: pending.conflict ? 'REPORT_AI_INTENT_FAILED' : 'REPORT_AI_IN_PROGRESS',
        message: pending.conflict
          ? 'La solicitud anterior terminó sin propuesta. Inicia una nueva.'
          : 'La consulta sigue en proceso. Reintenta con el mismo identificador.',
      });
    try {
      const result = proposal(
        await this.provider.interpret(input.text, allowedCatalog(pending.data)),
        pending.data,
        id,
      );
      return await this.authorized(request, async (_, freshActor) => {
        await this.datasets.manifest(freshActor, input.datasetId);
        return this.db.$transaction(async (tx) => {
          await lockOperation(tx, namespace, id);
          const current = await tx.consulta_analitica.findUniqueOrThrow({ where: { id } });
          if (current.estado !== 'ACLARACION' || current.resultado_resumen !== null)
            throw new ConflictException('La consulta dejó de estar vigente.');
          if (result.definition) await this.quota.commit(tx, resource, id);
          else await this.quota.release(tx, resource, id);
          await tx.consulta_analitica.update({
            where: { id },
            data: {
              estado: result.definition ? 'COMPLETADA' : 'ACLARACION',
              resultado_resumen: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonObject,
              filtros: JSON.parse(
                JSON.stringify(result.definition?.filters ?? []),
              ) as Prisma.InputJsonArray,
            },
          });
          return result;
        });
      });
    } catch (error) {
      await this.db.$transaction(async (tx) => {
        await lockOperation(tx, namespace, id);
        const row = await tx.consulta_analitica.findUniqueOrThrow({ where: { id } });
        if (row.estado === 'ACLARACION' && row.resultado_resumen === null) {
          await this.quota.release(tx, resource, id);
          await tx.consulta_analitica.update({ where: { id }, data: { estado: 'RECHAZADA' } });
        }
      });
      throw error;
    }
  }

  async transcribe(request: AuthRequest, audio?: Express.Multer.File) {
    const mime = audio?.mimetype.split(';')[0].toLowerCase() ?? '';
    const format = audioTypes[mime];
    if (!audio || audio.size < 16 || !format?.valid(audio.buffer))
      throw new BadRequestException('Adjunta audio WebM, Ogg, WAV o M4A válido.');
    await this.authorized(request, async (entitlement) => {
      if (
        entitlement.usage.aiCommitted + entitlement.usage.aiReserved >=
        entitlement.limits.aiPerPeriod
      )
        throw new ConflictException({
          code: 'CAPACITY_EXCEEDED',
          message: 'Se alcanzó la cuota de interpretación del período.',
        });
      this.provider.model('voice');
    });
    const result = await this.provider.transcribe(audio.buffer, mime, format.extension);
    return this.authorized(request, async () => result);
  }
}
