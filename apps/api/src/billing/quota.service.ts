import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, consumo_cuota } from '@prisma/client';
import { PLAN_CATALOG, type PlanCode } from '@lumina/contracts';
import { currentTenant } from '../tenancy/context';

export type QuotaResource = 'AVATAR_GENERACION' | 'IA_INTERPRETACION';
export type QuotaPeriod = {
  actorId: string;
  operationId: string;
  periodFrom: string;
  periodTo: string;
  planCode: PlanCode;
  subscriptionVersion: number;
};
const lock = (tx: Prisma.TransactionClient, key: string) =>
  tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
@Injectable()
export class QuotaService {
  async reserve(
    tx: Prisma.TransactionClient,
    resource: QuotaResource,
    referenceId: string,
    period: QuotaPeriod,
  ): Promise<consumo_cuota> {
    const scope = currentTenant();
    if (!scope?.subscription)
      throw new ForbiddenException('Falta el contexto autorizado del negocio.');
    if (!['AVATAR_GENERACION', 'IA_INTERPRETACION'].includes(resource))
      throw new BadRequestException('Recurso de cuota inválido.');
    const reference: { usuario_id: string; idempotencia?: string; tipo?: string } | null =
      resource === 'AVATAR_GENERACION'
        ? await tx.trabajo_avatar.findUnique({
            where: { id: referenceId },
            select: { usuario_id: true, idempotencia: true, tipo: true },
          })
        : await tx.consulta_analitica.findUnique({
            where: { id: referenceId },
            select: { usuario_id: true },
          });
    if (!reference || reference.usuario_id !== period.actorId)
      throw new ForbiddenException('La referencia de cuota no pertenece a esta persona.');
    if (
      resource === 'AVATAR_GENERACION' &&
      (reference.idempotencia !== period.operationId ||
        !reference.tipo ||
        !['GENERAR', 'CORREGIR'].includes(reference.tipo))
    )
      throw new ConflictException('La intención no corresponde al trabajo de generación.');
    await lock(tx, `quota:operation:${resource}:${period.operationId}`);
    const existing = await tx.consumo_cuota.findUnique({
      where: { recurso_idempotencia: { recurso: resource, idempotencia: period.operationId } },
    });
    if (existing) {
      if (
        existing.actor_id !== period.actorId ||
        (resource === 'AVATAR_GENERACION'
          ? existing.trabajo_avatar_id
          : existing.consulta_analitica_id) !== referenceId
      )
        throw new ConflictException('La intención ya corresponde a otra referencia.');
      return existing;
    }
    const plan = PLAN_CATALOG[period.planCode];
    const effective =
      scope.subscription.plan === 'piloto' && scope.slug === 'lumina'
        ? 'negocio'
        : scope.subscription.plan;
    if (
      !plan ||
      effective !== period.planCode ||
      period.subscriptionVersion !== (scope.subscription.version ?? 1)
    )
      throw new ConflictException({
        code: 'SUBSCRIPTION_CHANGED',
        message: 'El plan cambió. Actualiza el estado y reintenta.',
      });
    if (scope.readOnly) throw new ForbiddenException('La suscripción no permite nuevas reservas.');
    const from = new Date(period.periodFrom),
      to = new Date(period.periodTo),
      now = new Date();
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to ||
      now < from ||
      now >= to
    )
      throw new ConflictException('La cuota requiere el período vigente exacto.');
    const limit =
      resource === 'AVATAR_GENERACION' ? plan.limits.avatarsPerPeriod : plan.limits.aiPerPeriod;
    await lock(tx, `quota:period:${resource}:${from.toISOString()}:${to.toISOString()}`);
    const usage = await tx.consumo_cuota.aggregate({
      where: {
        recurso: resource,
        periodo_desde: from,
        periodo_hasta: to,
        estado: { in: ['RESERVADO', 'CONFIRMADO'] },
      },
      _sum: { cantidad: true },
    });
    if ((usage._sum.cantidad ?? 0) >= limit)
      throw new ConflictException({
        code: 'CAPACITY_EXCEEDED',
        message: 'Se alcanzó la cuota del período. Revisa el plan o espera su renovación.',
      });
    return tx.consumo_cuota.create({
      data: {
        recurso: resource,
        periodo_desde: from,
        periodo_hasta: to,
        idempotencia: period.operationId,
        actor_id: period.actorId,
        trabajo_avatar_id: resource === 'AVATAR_GENERACION' ? referenceId : null,
        consulta_analitica_id: resource === 'IA_INTERPRETACION' ? referenceId : null,
        cantidad: 1,
        estado: 'RESERVADO',
        plan_codigo_snapshot: period.planCode,
        suscripcion_version_snapshot: period.subscriptionVersion,
        limite_snapshot: limit,
        creado_en: now,
        actualizado_en: now,
      },
    });
  }
  private async transition(
    tx: Prisma.TransactionClient,
    resource: QuotaResource,
    referenceId: string,
    target: 'CONFIRMADO' | 'LIBERADO',
  ) {
    if (!currentTenant()) throw new ForbiddenException('Falta el ámbito del negocio.');
    const field = resource === 'AVATAR_GENERACION' ? 'trabajo_avatar_id' : 'consulta_analitica_id';
    const row = await tx.consumo_cuota.findFirst({
      where: { recurso: resource, [field]: referenceId },
    });
    if (!row) throw new BadRequestException('No existe reserva de cuota para esta referencia.');
    await lock(tx, `quota:operation:${resource}:${row.idempotencia}`);
    const current = await tx.consumo_cuota.findUniqueOrThrow({ where: { id: row.id } });
    if (current.estado === 'RESERVADO')
      return tx.consumo_cuota.update({
        where: { id: row.id },
        data: { estado: target, actualizado_en: new Date() },
      });
    if (target === 'CONFIRMADO' && current.estado === 'LIBERADO')
      throw new ConflictException('La reserva ya fue liberada; requiere una nueva intención.');
    return current;
  }
  commit(tx: Prisma.TransactionClient, resource: QuotaResource, referenceId: string) {
    return this.transition(tx, resource, referenceId, 'CONFIRMADO');
  }
  release(tx: Prisma.TransactionClient, resource: QuotaResource, referenceId: string) {
    return this.transition(tx, resource, referenceId, 'LIBERADO');
  }
}
