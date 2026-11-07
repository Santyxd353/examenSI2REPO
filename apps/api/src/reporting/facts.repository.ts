import { Prisma } from '@prisma/client';
import {
  REPORT_FILTER_FIELDS,
  REPORT_METRICS,
  moneyToMinor,
  type ReportDataset,
} from '@lumina/contracts';
import { boliviaDate } from '@lumina/reporting';

const LIMIT = 50000;
const settled = ['CONFIRMADO', 'REEMBOLSADO'];
const orderStates = [
  'PAGADO',
  'CONFIRMADO',
  'PREPARANDO',
  'DESPACHADO',
  'ENTREGADO',
  'CERRADO',
  'REEMBOLSADO',
];
const orderColumns = Prisma.sql`
  o.id AS "orderId", o.ubicacion_id AS "locationId", o.vendedor_id AS "sellerId",
  o.canal AS channel, o.estado AS "orderStatus"
`;
const productColumns = Prisma.sql`
  v.id AS "variantId", p.id AS "productId", p.marca AS brand, c.nombre AS category
`;
const productJoins = Prisma.sql`
  JOIN variante v ON v.id=dp.variante_id
  JOIN producto p ON p.id=v.producto_id JOIN categoria c ON c.id=p.categoria_id
`;
type OrderContext = {
  orderId: string;
  locationId: string;
  sellerId: string | null;
  channel: string;
  orderStatus: string;
};
type ProductContext = {
  variantId: string | null;
  productId: string | null;
  brand: string | null;
  category: string | null;
  size: string | null;
  color: string | null;
};
type FactBase = OrderContext & { id: string; occurredAt: Date };
type Period = { from: string; to: string };
const orderDimensions = (r: OrderContext) => ({
  ubicacion: r.locationId,
  vendedor: r.sellerId,
  canal: r.channel,
  estado_pedido: r.orderStatus,
});
const productDimensions = (r: ProductContext) => ({
  variante: r.variantId,
  producto: r.productId,
  categoria: r.category,
  marca: r.brand,
  talla: r.size,
  color: r.color,
});
const minor = (value: Prisma.Decimal) => moneyToMinor(value.toFixed(2));

export async function captureFacts(
  tx: Prisma.TransactionClient,
  locations: string[],
  period: Period,
) {
  const [{ at, start, end }] = await tx.$queryRaw<{ at: Date; start: Date; end: Date }[]>`
    SELECT transaction_timestamp() AS at,
      (${period.from}::date::timestamp AT TIME ZONE 'America/La_Paz') AS start,
      ((${period.to}::date+1)::timestamp AT TIME ZONE 'America/La_Paz') AS "end"`;
  const scopedOrder = Prisma.sql`o.ubicacion_id=ANY(${locations}::uuid[]) AND o.moneda='BOB'`;
  const within = (instant: Prisma.Sql) =>
    Prisma.sql`${instant} >= ${start} AND ${instant} < ${end} AND ${instant} <= ${at}`;
  let remaining = LIMIT;
  const omittedCoverage: string[] = [];
  const columns = new Set<string>([...REPORT_FILTER_FIELDS, ...REPORT_METRICS]);
  function keep<T>(rows: T[], label: string, disabled: string[] = []) {
    if (rows.length > remaining) {
      omittedCoverage.push(`Límite de 50 000 filas. Cobertura parcial de ${label}.`);
      for (const field of disabled) columns.delete(field);
    }
    const kept = rows.slice(0, remaining);
    remaining -= kept.length;
    return kept;
  }

  // Group payments before joining a line so split payments cannot repeat its amount or quantity.
  const saleRows = keep(
    await tx.$queryRaw<
      (FactBase &
        ProductContext & {
          quantity: number;
          amount: Prisma.Decimal;
          unitPrice: Prisma.Decimal;
        })[]
    >`
    SELECT dp.id, ${orderColumns}, ${productColumns}, dp.talla_snapshot AS size,
      dp.color_snapshot AS color, dp.cantidad AS quantity, dp.total_linea AS amount,
      dp.precio_unitario AS "unitPrice", confirmation.at AS "occurredAt"
    FROM pedido o JOIN LATERAL (
      SELECT min(coalesce(pg.confirmado_en,pg.creado_en)) AS at FROM pago pg
      WHERE pg.pedido_id=o.id AND pg.moneda='BOB' AND pg.estado=ANY(${settled}::text[])
    ) confirmation ON ${within(Prisma.sql`confirmation.at`)}
    JOIN detalle_pedido dp ON dp.pedido_id=o.id ${productJoins}
    WHERE ${scopedOrder} AND o.estado=ANY(${orderStates}::text[])
    ORDER BY confirmation.at, dp.id LIMIT ${remaining + 1}`,
    'ventas',
  );
  const returnRows = keep(
    await tx.$queryRaw<
      (FactBase &
        ProductContext & {
          lineId: string;
          quantity: number;
        })[]
    >`
    SELECT dd.id, ${orderColumns}, ${productColumns}, dp.talla_snapshot AS size,
      dp.color_snapshot AS color, dp.id AS "lineId", dd.cantidad_apta AS quantity,
      coalesce(dd.reintegrada_en,d.resuelta_en) AS "occurredAt"
    FROM devolucion d JOIN pedido o ON o.id=d.pedido_id
    JOIN detalle_devolucion dd ON dd.devolucion_id=d.id
    JOIN detalle_pedido dp ON dp.id=dd.detalle_pedido_id AND dp.pedido_id=o.id ${productJoins}
    WHERE ${scopedOrder} AND d.tipo='DEVOLUCION' AND d.estado='RESUELTA' AND dd.cantidad_apta>0
      AND ${within(Prisma.sql`coalesce(dd.reintegrada_en,d.resuelta_en)`)}
    ORDER BY "occurredAt", dd.id LIMIT ${remaining + 1}`,
    'devoluciones',
    ['con_devolucion'],
  );
  const refundRows = keep(
    await tx.$queryRaw<
      (FactBase &
        ProductContext & {
          returnId: string | null;
          amount: Prisma.Decimal;
        })[]
    >`
    SELECT r.id, ${orderColumns}, ${productColumns}, dp.talla_snapshot AS size,
      dp.color_snapshot AS color, r.devolucion_id AS "returnId", r.monto AS amount,
      coalesce(r.confirmado_en,r.creado_en) AS "occurredAt"
    FROM reembolso r JOIN pago pg ON pg.id=r.pago_id JOIN pedido o ON o.id=pg.pedido_id
    LEFT JOIN devolucion d ON d.id=r.devolucion_id AND d.pedido_id=o.id
    LEFT JOIN LATERAL (
      SELECT CASE WHEN count(*)=1 THEN min(dd.detalle_pedido_id::text)::uuid END AS detail_id
      FROM detalle_devolucion dd WHERE dd.devolucion_id=d.id AND dd.cantidad_apta>0
    ) ref ON true
    LEFT JOIN detalle_pedido dp ON dp.id=ref.detail_id AND dp.pedido_id=o.id
    LEFT JOIN variante v ON v.id=dp.variante_id
    LEFT JOIN producto p ON p.id=v.producto_id LEFT JOIN categoria c ON c.id=p.categoria_id
    WHERE ${scopedOrder} AND pg.moneda='BOB' AND r.estado='CONFIRMADO'
      AND ${within(Prisma.sql`coalesce(r.confirmado_en,r.creado_en)`)}
    ORDER BY "occurredAt", r.id LIMIT ${remaining + 1}`,
    'reembolsos',
  );
  const scope = new Map<string, ReportDataset['orders'][number]>();
  for (const row of [...saleRows, ...returnRows, ...refundRows])
    if (!scope.has(row.orderId))
      scope.set(row.orderId, {
        id: row.orderId,
        status: row.orderStatus,
        confirmedAt: 'unitPrice' in row ? row.occurredAt.toISOString() : null,
        dimensions: orderDimensions(row),
      });
  const stockDay = boliviaDate(at.toISOString());
  const stockRows =
    period.from <= stockDay && period.to >= stockDay
      ? keep(
          await tx.$queryRaw<
            (ProductContext & {
              id: string;
              locationId: string;
              physical: number;
              reserved: number;
              committed: number;
              version: number;
              variantId: string;
            })[]
          >`
        SELECT i.id, ${productColumns}, i.ubicacion_id AS "locationId", v.talla AS size, v.color,
          i.fisico AS physical, i.reservado AS reserved, i.comprometido AS committed, i.version
        FROM inventario i JOIN variante v ON v.id=i.variante_id
        JOIN producto p ON p.id=v.producto_id JOIN categoria c ON c.id=p.categoria_id
        WHERE i.ubicacion_id=ANY(${locations}::uuid[])
        ORDER BY i.id LIMIT ${remaining + 1}`,
          'inventario',
        )
      : [];
  const payments = keep(
    await tx.$queryRaw<
      {
        id: string;
        orderId: string;
        status: string;
        provider: string;
        amount: Prisma.Decimal;
        occurredAt: Date;
      }[]
    >`
    SELECT pg.id, pg.pedido_id AS "orderId", pg.estado AS status, pg.proveedor AS provider,
      pg.monto AS amount, coalesce(pg.confirmado_en,pg.creado_en) AS "occurredAt"
    FROM pago pg WHERE pg.pedido_id=ANY(${[...scope.keys()]}::uuid[])
      AND pg.moneda='BOB' AND pg.estado=ANY(${settled}::text[])
      AND coalesce(pg.confirmado_en,pg.creado_en)<=${at}
    ORDER BY pg.pedido_id, pg.id LIMIT ${remaining + 1}`,
    'pagos',
    ['metodo_pago', 'estado_pago'],
  );
  const orders = keep(
    [...scope.values()].sort((a, b) => a.id.localeCompare(b.id)),
    'contexto de pedidos',
  );
  const productIds = [
    ...new Set(
      [...saleRows, ...returnRows, ...refundRows, ...stockRows]
        .map((row) => row.productId)
        .filter((id): id is string => !!id),
    ),
  ];
  const variantIds = [
    ...new Set(
      [...saleRows, ...returnRows, ...refundRows, ...stockRows]
        .map((row) => row.variantId)
        .filter((id): id is string => !!id),
    ),
  ];
  const sellerIds = [
    ...new Set(
      [...saleRows, ...returnRows, ...refundRows]
        .map((row) => row.sellerId)
        .filter((id): id is string => !!id),
    ),
  ];
  type Label = { id: string; name: string };
  const locationNames = await tx.$queryRaw<
    Label[]
  >`SELECT id, nombre AS name FROM ubicacion WHERE id=ANY(${locations}::uuid[])`;
  const productNames = await tx.$queryRaw<
    Label[]
  >`SELECT id, nombre AS name FROM producto WHERE id=ANY(${productIds}::uuid[])`;
  const variantNames = await tx.$queryRaw<
    Label[]
  >`SELECT id, sku AS name FROM variante WHERE id=ANY(${variantIds}::uuid[])`;
  const sellerNames = await tx.$queryRaw<Label[]>`
    SELECT id, trim(concat(nombres,' ',apellidos)) AS name FROM usuario WHERE id=ANY(${sellerIds}::uuid[])`;
  const names = (rows: Label[]) =>
    Object.fromEntries(rows.map((row) => [row.id, row.name.trim().slice(0, 220) || row.id]));
  return {
    asOf: at.toISOString(),
    periodFrom: period.from,
    periodTo: period.to,
    availableColumns: [...columns],
    labels: {
      ubicacion: names(locationNames),
      producto: names(productNames),
      variante: names(variantNames),
      vendedor: names(sellerNames),
    },
    rowCount: LIMIT - remaining,
    rowLimit: LIMIT as 50000,
    complete: omittedCoverage.length === 0,
    omittedCoverage,
    sales: saleRows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      occurredAt: r.occurredAt.toISOString(),
      quantity: r.quantity,
      amountMinor: minor(r.amount),
      unitPriceMinor: minor(r.unitPrice),
      orderStatus: r.orderStatus,
      dimensions: { ...orderDimensions(r), ...productDimensions(r) },
    })),
    orders,
    payments: payments.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      status: r.status,
      method: r.provider.replace(/^POS_/, ''),
      amountMinor: minor(r.amount),
      occurredAt: r.occurredAt.toISOString(),
    })),
    returns: returnRows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      lineId: r.lineId,
      quantity: r.quantity,
      status: 'RESUELTA',
      occurredAt: r.occurredAt.toISOString(),
      dimensions: { ...orderDimensions(r), ...productDimensions(r) },
    })),
    refunds: refundRows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      returnId: r.returnId,
      amountMinor: minor(r.amount),
      status: 'CONFIRMADO',
      occurredAt: r.occurredAt.toISOString(),
      dimensions: { ...orderDimensions(r), ...productDimensions(r) },
    })),
    stock: stockRows.map((r) => ({
      id: r.id,
      variantId: r.variantId,
      locationId: r.locationId,
      physical: r.physical,
      reserved: r.reserved,
      committed: r.committed,
      version: r.version,
      dimensions: { ...productDimensions(r), ubicacion: r.locationId },
    })),
  };
}
