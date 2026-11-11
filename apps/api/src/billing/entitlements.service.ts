import {
  Controller,
  Get,
  Inject,
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  EntitlementsSchema,
  PLAN_CATALOG,
  type Entitlements,
  type PlanCode,
} from '@lumina/contracts';
import { AuthGuard, AuthRequest, requirePermission } from '../auth';
import { Db } from '../db';
import { currentTenant } from '../tenancy/context';
import { monthlyPeriodAt } from './periods';

@Injectable()
export class EntitlementsService {
  constructor(@Inject(Db) private readonly db: Db) {}
  async forTenant(tenantId: string): Promise<Entitlements> {
    const scope = currentTenant();
    if (!scope || scope.id !== tenantId)
      throw new ForbiddenException('No puedes consultar otra tienda.');
    const subscription = scope.subscription;
    if (!subscription)
      throw new ServiceUnavailableException('La suscripción requiere revisión de configuración.');
    const legacy = subscription.plan === 'piloto' && scope.slug === 'lumina';
    const code = legacy ? 'negocio' : (subscription.plan as PlanCode);
    const plan = PLAN_CATALOG[code];
    if (!plan) throw new ServiceUnavailableException('El plan requiere revisión de configuración.');
    const now = new Date(),
      paidThrough = subscription.periodEnd ? new Date(subscription.periodEnd) : null;
    const trial =
      subscription.status === 'TRIALING' ||
      Boolean(
        subscription.trialEnd && !subscription.periodStart && subscription.status === 'EXPIRED',
      );
    let from: Date, to: Date;
    if (trial && subscription.trialEnd) {
      to = new Date(subscription.trialEnd);
      from = new Date(to.getTime() - 14 * 86400000);
    } else {
      const anchor = new Date(
        subscription.periodStart || subscription.activatedAt || now.toISOString(),
      );
      const clock = paidThrough && now >= paidThrough ? new Date(paidThrough.getTime() - 1) : now;
      if (anchor > clock)
        throw new ServiceUnavailableException('El período de suscripción requiere revisión.');
      const period = monthlyPeriodAt(anchor, clock);
      from = period.from;
      to = paidThrough && period.to > paidThrough ? paidThrough : period.to;
    }
    const rows = await Promise.all([
      this.db.ubicacion.count({ where: { activa: true } }),
      this.db.usuario.count({
        where: {
          estado: 'ACTIVO',
          usuario_rol: {
            some: { rol: { nombre: { in: ['Administrador', 'Vendedor', 'Analista'] } } },
          },
        },
      }),
      this.db.producto.count(),
      this.db.definicion_reporte.count({ where: { estado: 'ACTIVA' } }),
      this.db.consumo_cuota.groupBy({
        by: ['recurso', 'estado'],
        where: {
          periodo_desde: from,
          periodo_hasta: to,
          estado: { in: ['RESERVADO', 'CONFIRMADO'] },
        },
        _sum: { cantidad: true },
      }),
    ]);
    const consumed = (resource: string, state: string) =>
      rows[4].find((r) => r.recurso === resource && r.estado === state)?._sum.cantidad ?? 0;
    return EntitlementsSchema.parse({
      schemaVersion: '1.0',
      tenantId,
      planCode: code,
      status:
        scope.state === 'SUSPENDED'
          ? 'SUSPENDED'
          : scope.readOnly
            ? 'EXPIRED'
            : trial
              ? 'TRIAL'
              : 'ACTIVE',
      periodFrom: from.toISOString(),
      periodTo: to.toISOString(),
      readOnly: Boolean(scope.readOnly),
      cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
      currency: 'USD',
      priceMinor: legacy ? 0 : plan.priceMinor,
      billingMode:
        subscription.provider === 'STRIPE'
          ? 'STRIPE_TEST'
          : subscription.provider === 'QR_SIMULATED'
            ? 'QR_SIMULATED'
            : null,
      legacyPilot: legacy,
      paidThrough: paidThrough?.toISOString() || null,
      limits: legacy
        ? {
            ...plan.limits,
            locations: Number.MAX_SAFE_INTEGER,
            staff: Number.MAX_SAFE_INTEGER,
            products: Number.MAX_SAFE_INTEGER,
          }
        : plan.limits,
      features: plan.features,
      usage: {
        locations: rows[0],
        staff: rows[1],
        products: rows[2],
        savedReports: rows[3],
        avatarsCommitted: consumed('AVATAR_GENERACION', 'CONFIRMADO'),
        avatarsReserved: consumed('AVATAR_GENERACION', 'RESERVADO'),
        aiCommitted: consumed('IA_INTERPRETACION', 'CONFIRMADO'),
        aiReserved: consumed('IA_INTERPRETACION', 'RESERVADO'),
      },
    });
  }
}
@Controller('tenant')
export class EntitlementsController {
  constructor(@Inject(EntitlementsService) private readonly entitlements: EntitlementsService) {}
  @Get('plans') plans() {
    return { schemaVersion: '1.0', currency: 'USD', plans: Object.values(PLAN_CATALOG) };
  }
  @Get('subscription')
  @UseGuards(AuthGuard)
  subscription(@Req() request: AuthRequest) {
    requirePermission(request.user, 'suscripcion:gestionar');
    return this.entitlements.forTenant(currentTenant()!.id);
  }
}
