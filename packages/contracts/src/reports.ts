import { z } from 'zod';
import {
  ChannelSchema,
  HashSchema,
  MinorSchema,
  SafeIntegerSchema,
  SourceSchema,
  TimestampSchema,
  UuidSchema,
} from './common';
import type { ApiProblem } from './problems';

export const REPORT_METRICS = [
  'ventas_confirmadas_bob',
  'unidades_vendidas',
  'pedidos_distintos',
  'ticket_promedio_bob',
  'unidades_devueltas',
  'reembolsos_confirmados_bob',
  'fisico_al_corte',
  'reservado_al_corte',
  'comprometido_al_corte',
  'disponible_al_corte',
] as const;
export const REPORT_DIMENSIONS = [
  'dia',
  'semana',
  'mes',
  'ubicacion',
  'canal',
  'vendedor',
  'categoria',
  'marca',
  'producto',
  'variante',
  'talla',
  'color',
  'estado_pedido',
  'estado_pago',
  'metodo_pago',
] as const;
export const REPORT_FILTER_FIELDS = [
  ...REPORT_DIMENSIONS,
  'periodo',
  'periodo_comparacion',
  'con_devolucion',
  'precio_unitario',
  'disponible_al_corte',
] as const;
export const ReportMetricSchema = z.enum(REPORT_METRICS);
export const ReportDimensionSchema = z.enum(REPORT_DIMENSIONS);
export type ReportMetric = z.infer<typeof ReportMetricSchema>;
export type ReportDimension = z.infer<typeof ReportDimensionSchema>;
export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const stamp = Date.parse(`${v}T00:00:00Z`);
    return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === v;
  }, 'Fecha inválida.');
export const PeriodSchema = z
  .strictObject({ from: DateSchema, to: DateSchema, inclusive: z.literal(true).default(true) })
  .refine((v) => v.from <= v.to, 'Rango de fechas invertido.');
const scalar = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);
export const ReportFilterSchema = z
  .strictObject({
    field: z.enum(REPORT_FILTER_FIELDS),
    operator: z.enum(['eq', 'neq', 'in', 'not_in', 'gte', 'lte', 'between', 'is_null']),
    value: z.union([scalar, z.array(scalar).max(100)]).optional(),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (v.operator === 'is_null') {
      if (v.value !== undefined && typeof v.value !== 'boolean')
        fail('is_null admite boolean o valor omitido.');
      return;
    }
    if (v.value === undefined) {
      fail('Filtro requiere valor.');
      return;
    }
    if (v.operator === 'in' || v.operator === 'not_in') {
      if (!Array.isArray(v.value) || !v.value.length) fail('Lista de filtro vacía o inválida.');
    } else if (v.operator === 'between') {
      if (!Array.isArray(v.value) || v.value.length !== 2) fail('between requiere dos valores.');
    } else if (Array.isArray(v.value)) fail('Operador escalar no acepta lista.');
    const values = Array.isArray(v.value) ? v.value : [v.value];
    if (['precio_unitario', 'disponible_al_corte'].includes(v.field)) {
      if (values.some((x) => typeof x !== 'number' || !Number.isSafeInteger(x)))
        fail('Filtro numérico requiere enteros seguros; precio en centavos.');
    } else if (v.field === 'con_devolucion') {
      if (!['eq', 'neq'].includes(v.operator) || values.some((x) => typeof x !== 'boolean'))
        fail('con_devolucion requiere comparación booleana.');
    } else if (values.some((x) => typeof x !== 'string'))
      fail('Dimensión requiere valores de texto.');
  });
const chart = z.enum(['bar', 'line', 'donut', 'table', 'area']);
const widget = z.strictObject({
  id: z.string().min(1).max(80),
  chart,
  dimension: ReportDimensionSchema,
  metric: ReportMetricSchema,
});
export const ReportDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal('1.0'),
    id: z.string().min(1).max(160).optional(),
    title: z.string().min(1).max(200),
    source: SourceSchema,
    datasetId: z.string().min(1).max(160),
    timezone: z.literal('America/La_Paz'),
    currency: z.literal('BOB'),
    fact: z.enum(['ventas_confirmadas', 'stock_al_corte']),
    metrics: z.array(ReportMetricSchema).min(1).max(10),
    dimensions: z.array(ReportDimensionSchema).max(5),
    period: PeriodSchema,
    comparison: z
      .strictObject({
        from: DateSchema,
        to: DateSchema,
        mode: z.enum(['previous_period', 'custom']),
        requiresCoverage: z.literal(true),
      })
      .refine((v) => v.from <= v.to)
      .optional(),
    filters: z.array(ReportFilterSchema).max(20),
    order: z
      .array(
        z.union([
          z.strictObject({ metric: ReportMetricSchema, direction: z.enum(['asc', 'desc']) }),
          z.strictObject({ dimension: ReportDimensionSchema, direction: z.enum(['asc', 'desc']) }),
        ]),
      )
      .max(5),
    limit: SafeIntegerSchema.positive().max(1000),
    chart,
    dashboard: z.strictObject({
      widgets: z.array(widget).max(16),
      crossFilter: z.boolean(),
      detailAvailableColumns: z.array(z.string().min(1).max(80)).max(50),
    }),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (
      new Set(v.metrics).size !== v.metrics.length ||
      new Set(v.dimensions).size !== v.dimensions.length
    )
      fail('Métricas y dimensiones no se repiten.');
    const metrics = [...v.metrics, ...v.dashboard.widgets.map((w) => w.metric)];
    if (metrics.some((m) => m.endsWith('_al_corte') !== (v.fact === 'stock_al_corte')))
      fail('Métricas incompatibles con el grano.');
    if (
      v.fact === 'stock_al_corte' &&
      v.dimensions.some((d) =>
        [
          'dia',
          'semana',
          'mes',
          'vendedor',
          'estado_pedido',
          'estado_pago',
          'metodo_pago',
        ].includes(d),
      )
    )
      fail('Stock al corte no representa historial o pagos.');
    if (
      v.order.some((o) =>
        'metric' in o ? !v.metrics.includes(o.metric) : !v.dimensions.includes(o.dimension),
      )
    )
      fail('Orden fuera de campos seleccionados.');
  });
export type ReportDefinition = z.infer<typeof ReportDefinitionSchema>;
export type ReportFilter = z.infer<typeof ReportFilterSchema>;

const dimensions = z.partialRecord(ReportDimensionSchema, z.string().nullable());
const factId = z.string().min(1).max(160);
export const SaleFactSchema = z.strictObject({
  id: factId,
  orderId: factId,
  occurredAt: TimestampSchema,
  quantity: SafeIntegerSchema.positive(),
  amountMinor: MinorSchema,
  unitPriceMinor: MinorSchema,
  dimensions,
  orderStatus: z.string().min(1).max(40),
});
export const OrderFactSchema = z.strictObject({
  id: factId,
  status: z.string().min(1).max(40),
  confirmedAt: TimestampSchema.nullable(),
  dimensions,
});
export const PaymentFactSchema = z.strictObject({
  id: factId,
  orderId: factId,
  status: z.string().min(1).max(40),
  method: z.string().min(1).max(60),
  amountMinor: MinorSchema,
  occurredAt: TimestampSchema,
});
export const ReturnFactSchema = z.strictObject({
  id: factId,
  orderId: factId,
  lineId: factId,
  quantity: SafeIntegerSchema.positive(),
  status: z.string().min(1).max(40),
  occurredAt: TimestampSchema,
  dimensions,
});
export const RefundFactSchema = z.strictObject({
  id: factId,
  orderId: factId,
  returnId: factId,
  amountMinor: MinorSchema,
  status: z.string().min(1).max(40),
  occurredAt: TimestampSchema,
  dimensions,
});
export const StockFactSchema = z
  .strictObject({
    id: factId,
    variantId: factId,
    locationId: factId,
    physical: MinorSchema,
    reserved: MinorSchema,
    committed: MinorSchema,
    version: SafeIntegerSchema.positive(),
    dimensions,
  })
  .refine(
    (v) => v.physical >= v.reserved + v.committed,
    'Stock físico no cubre reservas y compromisos.',
  );
export const ReportDatasetSchema = z
  .strictObject({
    datasetId: z.string().min(1).max(160),
    tenantId: UuidSchema,
    ownerId: UuidSchema,
    source: SourceSchema,
    schemaVersion: z.literal('1.0'),
    semanticsVersion: z.literal('1.0'),
    asOf: TimestampSchema,
    periodFrom: DateSchema,
    periodTo: DateSchema,
    authorizedLocationIds: z.array(z.string().min(1)).max(100),
    downloadedLocationIds: z.array(z.string().min(1)).max(100),
    availableColumns: z.array(z.string().min(1)).max(100),
    rowCount: MinorSchema.max(50000),
    rowLimit: z.literal(50000),
    complete: z.boolean(),
    omittedCoverage: z.array(z.string().max(1000)).max(100),
    sha256: HashSchema,
    sales: z.array(SaleFactSchema).max(50000),
    orders: z.array(OrderFactSchema).max(50000),
    payments: z.array(PaymentFactSchema).max(50000),
    returns: z.array(ReturnFactSchema).max(50000),
    refunds: z.array(RefundFactSchema).max(50000),
    stock: z.array(StockFactSchema).max(50000),
  })
  .superRefine((v, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    const rows = [...v.sales, ...v.orders, ...v.payments, ...v.returns, ...v.refunds, ...v.stock];
    if (rows.length !== v.rowCount || rows.length > 50000) fail('Recuento de filas inválido.');
    if (v.periodFrom > v.periodTo) fail('Cobertura temporal inválida.');
    if (v.downloadedLocationIds.some((id) => !v.authorizedLocationIds.includes(id)))
      fail('Conjunto fuera de ubicaciones autorizadas.');
    for (const facts of [v.sales, v.orders, v.payments, v.returns, v.refunds, v.stock]) {
      if (new Set(facts.map((f) => f.id)).size !== facts.length)
        fail('Hechos duplicados en el conjunto.');
    }
  });
export type ReportDataset = z.infer<typeof ReportDatasetSchema>;
export type SaleFact = z.infer<typeof SaleFactSchema>;
export type StockFact = z.infer<typeof StockFactSchema>;
export type ValidationResult = { ok: true } | { ok: false; problems: ApiProblem[] };
export type ReportValue = {
  value: number | null;
  unit: 'CENTAVOS' | 'UNIDADES' | 'PEDIDOS';
  numerator?: number;
  denominator?: number;
  reason?: string;
};
export type ReportGroup = {
  key: string;
  dimensions: Partial<Record<ReportDimension, string | null>>;
  metrics: Partial<Record<ReportMetric, ReportValue>>;
};
export type ReportResult = {
  schemaVersion: '1.0';
  semanticsVersion: '1.0';
  source: 'REAL' | 'DEMOSTRACION_SINTETICA';
  datasetId: string;
  asOf: string;
  tenantId?: string;
  definition?: ReportDefinition;
  widgets?: { id: string; groups: ReportGroup[] }[];
  kpis: Partial<Record<ReportMetric, ReportValue>>;
  groups: ReportGroup[];
  detail: { rows: Record<string, unknown>[]; total: number };
  warnings: string[];
  coverage: {
    complete: boolean;
    periodFrom: string;
    periodTo: string;
    locationIds: string[];
    omitted: string[];
  };
  comparison?: { kpis: Partial<Record<ReportMetric, ReportValue>> };
};
export type CrossFilterSelection = { dimension: ReportDimension; value: string } | null;
