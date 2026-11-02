import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Injectable,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthGuard, AuthRequest, Identity, requirePermission } from './auth';
import { Db } from './db';
import { AnalyticsJobs } from './analytics-jobs';
import { can, requireLocationScope } from './locations';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filterSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    location: z.string().uuid().optional(),
  })
  .refine((value) => value.from <= value.to, 'La fecha inicial debe ser anterior a la final.');

type Filters = z.infer<typeof filterSchema>;
type SaleRow = {
  semana: Date;
  variante_id: string;
  ubicacion_id: string;
  canal: string;
  cantidad: number;
};

const number = (value: unknown) => Number(value ?? 0);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);

@Injectable()
export class CommercialAnalytics {
  constructor(@Inject(Db) private db: Db) {}

  private async scope(user: Identity, requested?: string) {
    if (requested) {
      await requireLocationScope(this.db, user, requested);
      return [requested];
    }
    if (can(user, 'ubicaciones:gestionar') || user.roles.includes('Administrador')) return null;
    return (
      await this.db.usuario_ubicacion.findMany({
        where: { usuario_id: user.id },
        select: { ubicacion_id: true },
      })
    ).map((item) => item.ubicacion_id);
  }

  private dates(filters: Filters) {
    const from = new Date(`${filters.from}T00:00:00.000Z`);
    const to = new Date(`${filters.to}T00:00:00.000Z`);
    if ((to.getTime() - from.getTime()) / 86400000 > 730)
      throw new z.ZodError([
        { code: 'custom', path: ['to'], message: 'El período máximo es de dos años.' },
      ]);
    return { from, to, end: addDays(to, 1) };
  }

  async report(user: Identity, raw: unknown) {
    requirePermission(user, 'reportes:consultar');
    const filters = filterSchema.parse(raw);
    const { from, to, end } = this.dates(filters);
    const scope = await this.scope(user, filters.location);
    const orderScope = scope
      ? Prisma.sql`AND o.ubicacion_id = ANY(${scope}::uuid[])`
      : Prisma.empty;
    const inventoryScope = scope
      ? Prisma.sql`AND i.ubicacion_id = ANY(${scope}::uuid[])`
      : Prisma.empty;
    const [metricsRows, byProductRows, byLocationRows, bySellerRows, inventoryRows] =
      await Promise.all([
        this.db.$queryRaw<
          { pedidos: number; ventas: unknown; unidades: number; ticket_promedio: unknown }[]
        >`SELECT COUNT(DISTINCT o.id)::int AS pedidos,
            COALESCE(SUM(dp.total_linea),0) AS ventas,
            COALESCE(SUM(dp.cantidad),0)::int AS unidades,
            COALESCE(SUM(dp.total_linea)/NULLIF(COUNT(DISTINCT o.id),0),0) AS ticket_promedio
          FROM pedido o JOIN detalle_pedido dp ON dp.pedido_id=o.id
          WHERE o.creado_en>=${from} AND o.creado_en<${end}
            AND o.estado NOT IN ('CANCELADO','PENDIENTE_PAGO')
            AND EXISTS (SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND pg.estado='CONFIRMADO')
            ${orderScope}`,
        this.db.$queryRaw<
          {
            producto: string;
            variante_id: string;
            sku: string;
            unidades: number;
            ventas: unknown;
          }[]
        >`SELECT p.nombre AS producto,v.id AS variante_id,v.sku,
            SUM(dp.cantidad)::int AS unidades,SUM(dp.total_linea) AS ventas
          FROM pedido o JOIN detalle_pedido dp ON dp.pedido_id=o.id
          JOIN variante v ON v.id=dp.variante_id JOIN producto p ON p.id=v.producto_id
          WHERE o.creado_en>=${from} AND o.creado_en<${end}
            AND o.estado NOT IN ('CANCELADO','PENDIENTE_PAGO')
            AND EXISTS (SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND pg.estado='CONFIRMADO')
            ${orderScope}
          GROUP BY p.nombre,v.id,v.sku ORDER BY ventas DESC LIMIT 20`,
        this.db.$queryRaw<
          { ubicacion_id: string; ubicacion: string; pedidos: number; ventas: unknown }[]
        >`SELECT u.id AS ubicacion_id,u.nombre AS ubicacion,COUNT(DISTINCT o.id)::int AS pedidos,
            SUM(dp.total_linea) AS ventas
          FROM pedido o JOIN detalle_pedido dp ON dp.pedido_id=o.id
          LEFT JOIN ubicacion u ON u.id=o.ubicacion_id
          WHERE o.creado_en>=${from} AND o.creado_en<${end}
            AND o.estado NOT IN ('CANCELADO','PENDIENTE_PAGO')
            AND EXISTS (SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND pg.estado='CONFIRMADO')
            ${orderScope}
          GROUP BY u.id,u.nombre ORDER BY ventas DESC`,
        this.db.$queryRaw<
          { vendedor_id: string; vendedor: string; pedidos: number; ventas: unknown }[]
        >`SELECT ve.id AS vendedor_id,CONCAT(ve.nombres,' ',ve.apellidos) AS vendedor,
            COUNT(DISTINCT o.id)::int AS pedidos,SUM(dp.total_linea) AS ventas
          FROM pedido o JOIN detalle_pedido dp ON dp.pedido_id=o.id
          LEFT JOIN usuario ve ON ve.id=o.vendedor_id
          WHERE o.creado_en>=${from} AND o.creado_en<${end}
            AND o.estado NOT IN ('CANCELADO','PENDIENTE_PAGO')
            AND EXISTS (SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND pg.estado='CONFIRMADO')
            ${orderScope}
          GROUP BY ve.id,ve.nombres,ve.apellidos ORDER BY ventas DESC`,
        this.db.$queryRaw<
          {
            ubicacion_id: string;
            ubicacion: string;
            fisico: number;
            reservado: number;
            comprometido: number;
            disponible: number;
            alertas: number;
          }[]
        >`SELECT u.id AS ubicacion_id,u.nombre AS ubicacion,SUM(i.fisico)::int AS fisico,
            SUM(i.reservado)::int AS reservado,SUM(i.comprometido)::int AS comprometido,
            SUM(i.disponible)::int AS disponible,
            COUNT(*) FILTER (WHERE i.disponible<=COALESCE(d.stock_seguridad,0))::int AS alertas
          FROM inventario i JOIN ubicacion u ON u.id=i.ubicacion_id
          LEFT JOIN disponibilidad_canal d ON d.ubicacion_id=i.ubicacion_id
            AND d.variante_id=i.variante_id AND d.canal='WEB'
          WHERE u.activa ${inventoryScope}
          GROUP BY u.id,u.nombre ORDER BY u.nombre`,
      ]);
    const metrics = metricsRows[0];
    const products = byProductRows.map((row) => ({ ...row, ventas: number(row.ventas) }));
    const locations = byLocationRows.map((row) => ({ ...row, ventas: number(row.ventas) }));
    const sellers = bySellerRows.map((row) => ({ ...row, ventas: number(row.ventas) }));
    const kpis = {
      pedidos: number(metrics?.pedidos),
      ventas: number(metrics?.ventas),
      unidades: number(metrics?.unidades),
      ticketPromedio: number(metrics?.ticket_promedio),
    };
    const summary = kpis.pedidos
      ? `Se confirmaron ${kpis.pedidos} pedidos por Bs ${kpis.ventas.toFixed(2)}. ${products[0] ? `${products[0].producto} lideró con ${products[0].unidades} unidades.` : ''}`
      : 'No hay ventas confirmadas en el período seleccionado; no se estiman resultados inexistentes.';
    return {
      filters: { ...filters, scope: scope ?? 'TODAS' },
      kpis,
      products,
      locations,
      sellers,
      inventory: inventoryRows,
      summary,
      generatedBy: 'Analítica comercial explicable v1.0',
      cutOff: new Date(),
      period: { from, to },
    };
  }

  async run(user: Identity, raw: unknown) {
    requirePermission(user, 'reportes:consultar');
    const input = filterSchema
      .extend({ horizonWeeks: z.number().int().min(1).max(12).default(4) })
      .parse(raw);
    const { from, to, end } = this.dates(input);
    const scope = await this.scope(user, input.location);
    const orderScope = scope
      ? Prisma.sql`AND o.ubicacion_id = ANY(${scope}::uuid[])`
      : Prisma.empty;
    const inventoryScope = scope ? { ubicacion_id: { in: scope } } : {};
    const sales = await this.db.$queryRaw<SaleRow[]>`
      SELECT date_trunc('week',o.creado_en)::date AS semana,dp.variante_id,o.ubicacion_id,o.canal,
        SUM(dp.cantidad)::int AS cantidad
      FROM pedido o JOIN detalle_pedido dp ON dp.pedido_id=o.id
      WHERE o.creado_en>=${from} AND o.creado_en<${end} AND o.ubicacion_id IS NOT NULL
        AND o.estado NOT IN ('CANCELADO','PENDIENTE_PAGO')
        AND EXISTS (SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND pg.estado='CONFIRMADO')
        ${orderScope}
      GROUP BY semana,dp.variante_id,o.ubicacion_id,o.canal ORDER BY semana`;
    const [demandModel, anomalyModel] = await Promise.all([
      this.db.modelo_analitico.upsert({
        where: {
          tipo_nombre_version: {
            tipo: 'DEMANDA',
            nombre: 'Promedio móvil ponderado',
            version: '1.0',
          },
        },
        update: {},
        create: {
          tipo: 'DEMANDA',
          nombre: 'Promedio móvil ponderado',
          version: '1.0',
          parametros: { ventanas: 4, pesos: 'crecientes', explicable: true },
          estado: 'ACTIVO',
        },
      }),
      this.db.modelo_analitico.upsert({
        where: {
          tipo_nombre_version: {
            tipo: 'ANOMALIA',
            nombre: 'Desviación contra historia semanal',
            version: '1.1',
          },
        },
        update: {},
        create: {
          tipo: 'ANOMALIA',
          nombre: 'Desviación contra historia semanal',
          version: '1.1',
          parametros: { desviaciones: 2, minimo_periodos: 4, ventanas: 4, explicable: true },
          estado: 'ACTIVO',
        },
      }),
    ]);
    const [demandRun, anomalyRun] = await Promise.all([
      this.db.ejecucion_analitica.create({
        data: {
          modelo_id: demandModel.id,
          solicitante_id: user.id,
          desde: from,
          hasta: to,
          filtros: { location: input.location ?? null, horizonWeeks: input.horizonWeeks },
          estado: 'PENDIENTE',
          creada_en: new Date(),
        },
      }),
      this.db.ejecucion_analitica.create({
        data: {
          modelo_id: anomalyModel.id,
          solicitante_id: user.id,
          desde: from,
          hasta: to,
          filtros: { location: input.location ?? null },
          estado: 'PENDIENTE',
          creada_en: new Date(),
        },
      }),
    ]);
    const grouped = new Map<string, SaleRow[]>();
    for (const row of sales) {
      const key = `${row.variante_id}:${row.ubicacion_id}:${row.canal}`;
      grouped.set(key, [...(grouped.get(key) ?? []), { ...row, cantidad: number(row.cantidad) }]);
    }
    const predictions: {
      ejecucion_id: string;
      variante_id: string;
      ubicacion_id: string;
      canal: string;
      fecha: Date;
      cantidad: number;
      limite_inferior: number;
      limite_superior: number;
    }[] = [];
    const anomalies: {
      ejecucion_id: string;
      indicador: string;
      entidad_tipo: string;
      entidad_id: string;
      puntaje: number;
      evidencia: Prisma.InputJsonValue;
      estado: string;
    }[] = [];
    const weeklyDemand = new Map<string, number>();
    const firstForecast = addDays(to, ((8 - to.getUTCDay()) % 7) || 7);
    for (const rows of grouped.values()) {
      const recent = rows.slice(-4);
      const weights = recent.map((_, index) => index + 1);
      const forecast =
        recent.reduce((sum, row, index) => sum + number(row.cantidad) * weights[index], 0) /
        weights.reduce((sum, weight) => sum + weight, 0);
      const mean = recent.reduce((sum, row) => sum + number(row.cantidad), 0) / recent.length;
      const deviation = Math.sqrt(
        recent.reduce((sum, row) => sum + (number(row.cantidad) - mean) ** 2, 0) / recent.length,
      );
      const base = rows[rows.length - 1];
      const demandKey = `${base.variante_id}:${base.ubicacion_id}`;
      weeklyDemand.set(demandKey, (weeklyDemand.get(demandKey) ?? 0) + forecast);
      for (let week = 1; week <= input.horizonWeeks; week++)
        predictions.push({
          ejecucion_id: demandRun.id,
          variante_id: base.variante_id,
          ubicacion_id: base.ubicacion_id,
          canal: base.canal,
          fecha: addDays(firstForecast, (week - 1) * 7),
          cantidad: Math.max(0, Number(forecast.toFixed(3))),
          limite_inferior: Math.max(0, Number((forecast - 1.96 * deviation).toFixed(3))),
          limite_superior: Math.max(0, Number((forecast + 1.96 * deviation).toFixed(3))),
        });
      for (let index = 4; index < rows.length; index++) {
        const history = rows.slice(index - 4, index).map((row) => number(row.cantidad));
        const expected = history.reduce((sum, quantity) => sum + quantity, 0) / history.length;
        const historicDeviation = Math.sqrt(
          history.reduce((sum, quantity) => sum + (quantity - expected) ** 2, 0) /
            history.length,
        );
        const scale = Math.max(1, historicDeviation, Math.sqrt(expected));
        const row = rows[index];
        const score = Math.abs(number(row.cantidad) - expected) / scale;
        if (score >= 2)
          anomalies.push({
            ejecucion_id: anomalyRun.id,
            indicador: 'VENTA_SEMANAL_ATIPICA',
            entidad_tipo: 'VARIANTE',
            entidad_id: row.variante_id,
            puntaje: Number(score.toFixed(4)),
            evidencia: {
              semana: new Date(row.semana).toISOString().slice(0, 10),
              cantidad: number(row.cantidad),
              promedio_historico: Number(expected.toFixed(3)),
              desviacion_historica: Number(historicDeviation.toFixed(3)),
              semanas_referencia: history.length,
            },
            estado: 'PENDIENTE',
          });
      }
    }
    const inventories = await this.db.inventario.findMany({
      where: { ...inventoryScope, ubicacion: { activa: true } },
      include: { ubicacion: true, variante: { include: { producto: true } } },
    });
    const policies = await this.db.disponibilidad_canal.findMany({
      where: {
        canal: 'WEB',
        ...(scope ? { ubicacion_id: { in: scope } } : {}),
      },
    });
    const recommendations: {
      ejecucion_id: string;
      variante_id: string;
      origen_id?: string;
      destino_id: string;
      tipo: string;
      cantidad: number;
      cobertura_dias: number;
      motivo: Prisma.InputJsonValue;
      estado: string;
    }[] = [];
    for (const item of inventories) {
      const policy = policies.find(
        (candidate) =>
          candidate.variante_id === item.variante_id &&
          candidate.ubicacion_id === item.ubicacion_id,
      );
      const safety = policy?.stock_seguridad ?? 0;
      const leadDays = Math.max(7, policy?.plazo_reposicion_dias ?? 7);
      const demand = weeklyDemand.get(`${item.variante_id}:${item.ubicacion_id}`) ?? 0;
      const target = Math.ceil(demand * Math.max(1, leadDays / 7)) + safety;
      const available = item.disponible ?? item.fisico - item.reservado - item.comprometido;
      const needed = target - available;
      if (needed <= 0) continue;
      const origin = inventories.find((candidate) => {
        if (candidate.id === item.id || candidate.variante_id !== item.variante_id) return false;
        const originPolicy = policies.find(
          (rule) =>
            rule.variante_id === candidate.variante_id &&
            rule.ubicacion_id === candidate.ubicacion_id,
        );
        const originAvailable =
          candidate.disponible ?? candidate.fisico - candidate.reservado - candidate.comprometido;
        return originAvailable - (originPolicy?.stock_seguridad ?? 0) >= needed;
      });
      recommendations.push({
        ejecucion_id: demandRun.id,
        variante_id: item.variante_id,
        origen_id: origin?.ubicacion_id,
        destino_id: item.ubicacion_id,
        tipo: origin ? 'TRASLADO' : 'REPOSICION',
        cantidad: needed,
        cobertura_dias: leadDays,
        motivo: {
          producto: item.variante.producto.nombre,
          sku: item.variante.sku,
          disponible: available,
          objetivo: target,
          demanda_semanal: Number(demand.toFixed(3)),
          stock_seguridad: safety,
          explicacion: demand
            ? 'Demanda ponderada, plazo de reposición y stock de seguridad.'
            : 'Stock disponible por debajo del mínimo configurado; sin historial suficiente.',
        },
        estado: 'PROPUESTA',
      });
    }
    await this.db.$transaction(async (tx) => {
      if (predictions.length) await tx.prediccion.createMany({ data: predictions });
      if (anomalies.length) await tx.anomalia.createMany({ data: anomalies });
      if (recommendations.length) await tx.recomendacion.createMany({ data: recommendations });
      await tx.ejecucion_analitica.update({
        where: { id: demandRun.id },
        data: {
          estado: predictions.length ? 'COMPLETADA' : 'SIN_DATOS',
          metricas: {
            series: grouped.size,
            predicciones: predictions.length,
            recomendaciones: recommendations.length,
          },
        },
      });
      await tx.ejecucion_analitica.update({
        where: { id: anomalyRun.id },
        data: {
          estado: sales.length ? 'COMPLETADA' : 'SIN_DATOS',
          metricas: { observaciones: sales.length, anomalias: anomalies.length },
        },
      });
    });
    const variantIds = [
      ...new Set([...predictions, ...recommendations].map((row) => row.variante_id)),
    ];
    const variants = await this.db.variante.findMany({
      where: { id: { in: variantIds } },
      include: { producto: true },
    });
    const locations = await this.db.ubicacion.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              ...predictions.map((row) => row.ubicacion_id),
              ...recommendations.map((row) => row.destino_id),
            ]),
          ],
        },
      },
    });
    return {
      executionIds: { demand: demandRun.id, anomalies: anomalyRun.id },
      model: {
        demand: `${demandModel.nombre} ${demandModel.version}`,
        anomalies: `${anomalyModel.nombre} ${anomalyModel.version}`,
      },
      status: predictions.length ? 'COMPLETADA' : 'SIN_DATOS',
      predictions: predictions.map((row) => ({
        ...row,
        producto: variants.find((item) => item.id === row.variante_id)?.producto.nombre,
        sku: variants.find((item) => item.id === row.variante_id)?.sku,
        ubicacion: locations.find((item) => item.id === row.ubicacion_id)?.nombre,
      })),
      anomalies,
      recommendations: recommendations.map((row) => ({
        ...row,
        producto: variants.find((item) => item.id === row.variante_id)?.producto.nombre,
        sku: variants.find((item) => item.id === row.variante_id)?.sku,
        destino: locations.find((item) => item.id === row.destino_id)?.nombre,
      })),
      note: predictions.length
        ? 'Proyección estadística explicable; no garantiza ventas futuras.'
        : 'No hay historial confirmado suficiente para predecir demanda. Las recomendaciones, si existen, usan mínimos configurados.',
    };
  }

  async query(user: Identity, raw: unknown) {
    requirePermission(user, 'reportes:consultar');
    const data = filterSchema.extend({ question: z.string().trim().min(4).max(300) }).parse(raw);
    const normalized = data.question
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/(elimina|borra|actualiza|modifica|contraseña|clave)/.test(normalized))
      return {
        intent: 'RECHAZADA',
        answer: 'La consulta analítica es de solo lectura y no ejecuta modificaciones.',
      };
    const report = await this.report(user, data);
    if (/(venta|ingreso|pedido|producto)/.test(normalized))
      return { intent: 'VENTAS', answer: report.summary, data: report.products.slice(0, 5) };
    if (/(stock|inventario|existencia|sucursal|almacen)/.test(normalized)) {
      const alerts = report.inventory.reduce((sum, row) => sum + number(row.alertas), 0);
      return {
        intent: 'INVENTARIO',
        answer: `Hay ${number(report.inventory.reduce((sum, row) => sum + number(row.disponible), 0))} unidades disponibles y ${alerts} alertas de stock bajo en el alcance consultado.`,
        data: report.inventory,
      };
    }
    return {
      intent: 'ACLARACION',
      answer:
        'Puedo responder sobre ventas, pedidos, productos, inventario, existencias y sucursales. Reformula la pregunta con uno de esos temas.',
    };
  }
}

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(@Inject(CommercialAnalytics) private analytics: CommercialAnalytics) {}

  @Get('summary')
  summary(
    @Req() req: AuthRequest,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('location') location?: string,
  ) {
    return this.analytics.report(req.user, { from, to, location: location || undefined });
  }
}

@Controller('analytics')
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(
    @Inject(CommercialAnalytics) private analytics: CommercialAnalytics,
    @Inject(AnalyticsJobs) private worker: AnalyticsJobs,
  ) {}

  @Post('run')
  run(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.analytics.run(req.user, body);
  }

  @Post('query')
  query(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.analytics.query(req.user, body);
  }

  @Post('ml/demo/train')
  trainDemo(@Req() req: AuthRequest) {
    return this.worker.scheduleDemoTraining(req.user);
  }

  @Get('ml/executions/:id')
  workerStatus(@Req() req: AuthRequest, @Param('id') id: string) {
    return this.worker.status(req.user, z.string().uuid().parse(id));
  }
}
