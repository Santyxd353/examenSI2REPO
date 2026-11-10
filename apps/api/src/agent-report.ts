import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Db } from './db';
import type { ReportChart } from './report-dashboard';

const metrics = [
  'sales',
  'orders',
  'units',
  'average_ticket',
  'stock',
  'reserved',
  'low_stock',
] as const;
const groups = [
  'day',
  'week',
  'month',
  'location',
  'product',
  'category',
  'color',
  'size',
  'seller',
  'total',
] as const;
const representations = ['bar', 'line', 'pie', 'donut', 'table', 'kpi'] as const;
export const reportPlanSchema = z
  .object({
    clarification: z.string().max(400).nullable(),
    charts: z
      .array(
        z
          .object({
            title: z.string().min(3).max(100),
            metric: z.enum(metrics),
            groupBy: z.enum(groups),
            representation: z.enum(representations),
            from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            limit: z.number().int().min(1).max(30),
            order: z.enum(['asc', 'desc', 'chronological']),
            productSearch: z.string().max(100).nullable(),
            categorySearch: z.string().max(100).nullable(),
            color: z.string().max(60).nullable(),
            size: z.string().max(30).nullable(),
            locationSearch: z.string().max(100).nullable(),
            maximumStock: z.number().int().min(0).max(100000).nullable(),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();
export type ReportPlan = z.infer<typeof reportPlanSchema>;

export const reportTool = {
  type: 'function',
  name: 'generar_reporte',
  description:
    'Consulta datos comerciales autorizados y genera de 1 a 4 gráficos adaptados a la pregunta. Para preguntas ambiguas devuelve clarification y charts vacío. stock/reserved/low_stock son existencias actuales. sales es importe vendido de prendas confirmadas. Elige dimensiones, fechas y filtros según la consulta.',
  strict: true,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['clarification', 'charts'],
    properties: {
      clarification: { type: ['string', 'null'] },
      charts: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'metric',
            'groupBy',
            'representation',
            'from',
            'to',
            'limit',
            'order',
            'productSearch',
            'categorySearch',
            'color',
            'size',
            'locationSearch',
            'maximumStock',
          ],
          properties: {
            title: { type: 'string' },
            metric: { type: 'string', enum: metrics },
            groupBy: { type: 'string', enum: groups },
            representation: { type: 'string', enum: representations },
            from: { type: 'string', description: 'YYYY-MM-DD, primer día incluido' },
            to: { type: 'string', description: 'YYYY-MM-DD, último día incluido' },
            limit: { type: 'integer', minimum: 1, maximum: 30 },
            order: { type: 'string', enum: ['asc', 'desc', 'chronological'] },
            productSearch: { type: ['string', 'null'] },
            categorySearch: { type: ['string', 'null'] },
            color: { type: ['string', 'null'] },
            size: { type: ['string', 'null'] },
            locationSearch: { type: ['string', 'null'] },
            maximumStock: {
              type: ['integer', 'null'],
              description: 'Solo para existencias actuales; null si no se pide un umbral',
            },
          },
        },
      },
    },
  },
};

export async function executeReportPlan(
  db: Db,
  plan: ReportPlan,
  scope: string[] | null,
  location?: string,
): Promise<ReportChart[]> {
  const charts: ReportChart[] = [];
  for (const spec of plan.charts) {
    const from = new Date(spec.from + 'T00:00:00Z');
    const to = new Date(spec.to + 'T00:00:00Z');
    const days = (to.getTime() - from.getTime()) / 86400000;
    if (
      !Number.isFinite(days) ||
      days < 0 ||
      days > 730 ||
      from.toISOString().slice(0, 10) !== spec.from ||
      to.toISOString().slice(0, 10) !== spec.to
    )
      throw new BadRequestException(
        'El período del reporte debe ser válido y abarcar como máximo dos años.',
      );
    const stock = ['stock', 'reserved', 'low_stock'].includes(spec.metric);
    if (stock && ['day', 'week', 'month', 'seller'].includes(spec.groupBy))
      throw new BadRequestException(
        'El inventario disponible es una fotografía actual. Agrúpalo por prenda, categoría, talla, color o ubicación.',
      );
    if (!stock && spec.maximumStock !== null)
      throw new BadRequestException(
        'El umbral de stock solo puede aplicarse al inventario actual.',
      );
    if (spec.metric === 'average_ticket' && ['pie', 'donut'].includes(spec.representation))
      throw new BadRequestException(
        'El ticket promedio debe representarse con barras, líneas, tabla o indicador.',
      );
    const group = {
      day: Prisma.sql`to_char(o.creado_en AT TIME ZONE 'UTC','YYYY-MM-DD')`,
      week: Prisma.sql`to_char(date_trunc('week',o.creado_en AT TIME ZONE 'UTC'),'YYYY-MM-DD')`,
      month: Prisma.sql`to_char(o.creado_en AT TIME ZONE 'UTC','YYYY-MM')`,
      location: Prisma.sql`COALESCE(u.nombre,'Sin ubicación')`,
      product: Prisma.sql`p.nombre`,
      category: Prisma.sql`c.nombre`,
      color: Prisma.sql`v.color`,
      size: Prisma.sql`v.talla`,
      seller: Prisma.sql`COALESCE(concat_ws(' ',ve.nombres,ve.apellidos),'Sin vendedor')`,
      total: Prisma.sql`'Total'`,
    }[spec.groupBy];
    const metric = {
      sales: Prisma.sql`SUM(dp.total_linea)`,
      orders: Prisma.sql`COUNT(DISTINCT o.id)`,
      units: Prisma.sql`SUM(dp.cantidad)`,
      average_ticket: Prisma.sql`SUM(dp.total_linea)/NULLIF(COUNT(DISTINCT o.id),0)`,
      stock: Prisma.sql`SUM(i.disponible)`,
      reserved: Prisma.sql`SUM(i.reservado)`,
      low_stock: Prisma.sql`COUNT(DISTINCT v.id)`,
    }[spec.metric];
    const locationColumn = stock ? Prisma.sql`i.ubicacion_id` : Prisma.sql`o.ubicacion_id`;
    const clauses = [
      scope ? Prisma.sql`${locationColumn}=ANY(${scope}::uuid[])` : Prisma.sql`true`,
      location ? Prisma.sql`${locationColumn}=${location}::uuid` : Prisma.sql`true`,
      spec.productSearch
        ? Prisma.sql`p.nombre ILIKE ${'%' + spec.productSearch + '%'}`
        : Prisma.sql`true`,
      spec.categorySearch
        ? Prisma.sql`c.nombre ILIKE ${'%' + spec.categorySearch + '%'}`
        : Prisma.sql`true`,
      spec.locationSearch
        ? Prisma.sql`u.nombre ILIKE ${'%' + spec.locationSearch + '%'}`
        : Prisma.sql`true`,
      spec.color ? Prisma.sql`lower(v.color)=lower(${spec.color})` : Prisma.sql`true`,
      spec.size ? Prisma.sql`lower(v.talla)=lower(${spec.size})` : Prisma.sql`true`,
    ];
    if (stock) {
      clauses.push(Prisma.sql`u.activa`);
      if (spec.metric === 'low_stock')
        clauses.push(Prisma.sql`i.disponible<=COALESCE(d.stock_seguridad,0)`);
    } else {
      clauses.push(Prisma.sql`o.creado_en>=${from} AND o.creado_en<${new Date(to.getTime() + 86400000)}
        AND o.estado NOT IN ('CANCELADO','PENDIENTE_PAGO')
        AND EXISTS(SELECT 1 FROM pago pg WHERE pg.pedido_id=o.id AND pg.estado='CONFIRMADO')`);
    }
    const source = stock
      ? Prisma.sql`inventario i JOIN variante v ON v.id=i.variante_id
      JOIN ubicacion u ON u.id=i.ubicacion_id LEFT JOIN disponibilidad_canal d ON
      d.variante_id=i.variante_id AND d.ubicacion_id=i.ubicacion_id AND d.canal='WEB'`
      : Prisma.sql`pedido o JOIN detalle_pedido dp ON dp.pedido_id=o.id JOIN variante v ON v.id=dp.variante_id
        LEFT JOIN ubicacion u ON u.id=o.ubicacion_id LEFT JOIN usuario ve ON ve.id=o.vendedor_id`;
    const order =
      spec.order === 'chronological'
        ? Prisma.sql`label ASC`
        : spec.order === 'asc'
          ? Prisma.sql`value ASC,label ASC`
          : Prisma.sql`value DESC,label ASC`;
    const threshold =
      stock && spec.maximumStock !== null
        ? Prisma.sql`HAVING SUM(i.disponible)<=${spec.maximumStock}`
        : Prisma.empty;
    const rows = await db.$queryRaw<
      { label: string; value: unknown; groups: bigint; total: unknown }[]
    >(Prisma.sql`
      WITH grouped AS (SELECT ${group} AS label,${metric} AS value FROM ${source}
        JOIN producto p ON p.id=v.producto_id JOIN categoria c ON c.id=p.categoria_id
        WHERE ${Prisma.join(clauses, ' AND ')} GROUP BY 1 ${threshold})
      SELECT label,value,COUNT(*) OVER() AS groups,SUM(value) OVER() AS total FROM grouped
      ORDER BY ${order} LIMIT ${spec.limit}`);
    const points = rows.map((row) => ({
      label: row.label || 'Sin especificar',
      value: Number(row.value || 0),
    }));
    const total = Number(rows[0]?.total || 0);
    const groups = Number(rows[0]?.groups || 0);
    if (
      ['pie', 'donut'].includes(spec.representation) &&
      groups > points.length &&
      !['orders', 'low_stock'].includes(spec.metric)
    ) {
      const other = total - points.reduce((sum, p) => sum + p.value, 0);
      if (other > 0) points.push({ label: 'Otros', value: other });
    }
    const unit = ['sales', 'average_ticket'].includes(spec.metric)
      ? 'Bs'
      : spec.metric === 'orders'
        ? 'pedidos'
        : spec.metric === 'low_stock'
          ? 'variantes'
          : 'unidades';
    charts.push({
      id: 'query-' + charts.length,
      title: spec.title,
      unit,
      defaultType:
        points.some((p) => p.value < 0) && ['pie', 'donut'].includes(spec.representation)
          ? 'bar'
          : spec.representation,
      points,
      period: { from: spec.from, to: spec.to },
      metric: spec.metric,
      groupBy: spec.groupBy,
      totalGroups: groups,
      total:
        spec.metric === 'average_ticket' ||
        (['orders', 'low_stock'].includes(spec.metric) && spec.groupBy !== 'total')
          ? undefined
          : total,
      description: [
        stock ? 'Inventario actual' : spec.from + ' — ' + spec.to,
        spec.productSearch,
        spec.categorySearch,
        spec.locationSearch,
        spec.color,
        spec.size,
        spec.maximumStock !== null ? 'Stock disponible ≤ ' + spec.maximumStock : null,
        groups > spec.limit ? 'Se muestran ' + spec.limit + ' de ' + groups + ' grupos' : null,
        ['orders', 'low_stock'].includes(spec.metric) &&
        ['product', 'category', 'color', 'size', 'location'].includes(spec.groupBy)
          ? 'Los grupos pueden compartir pedidos o prendas.'
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    });
  }
  return charts;
}
