import type { ReportDataset, ReportDefinition, ReportFilter, ReportGroup } from '@lumina/contracts';
import { boliviaDate, isoWeek } from './calendar';
import { matchFilter, type Scalar } from './filters';

const PAID_ORDERS = new Set([
  'PAGADO',
  'CONFIRMADO',
  'PREPARANDO',
  'DESPACHADO',
  'ENTREGADO',
  'CERRADO',
  'REEMBOLSADO',
]);
const ACCEPTED_RETURNS = new Set(['ACEPTADA', 'RESUELTA']);
export const PAYMENT_FIELDS = new Set(['metodo_pago', 'estado_pago']);
type Dimensions = ReportGroup['dimensions'];
type Payment = ReportDataset['payments'][number];
type Timed = { id: string; day: string; dimensions: Dimensions };
export type Fact = Timed &
  (
    | { kind: 'sale'; orderId: string; units: number; amount: number; price: number }
    | { kind: 'return'; orderId: string; units: number; price?: number }
    | { kind: 'refund'; orderId: string; amount: number }
    | { kind: 'stock'; physical: number; reserved: number; committed: number }
  );
function timed(day: string, dimensions: Dimensions): Dimensions {
  return { ...dimensions, dia: day, semana: isoWeek(day), mes: day.slice(0, 7) };
}
export function factsFor(definition: ReportDefinition, dataset: ReportDataset): Fact[] {
  if (definition.fact === 'stock_al_corte') {
    const day = boliviaDate(dataset.asOf);
    return dataset.stock.map((row) => ({
      kind: 'stock',
      id: row.id,
      day,
      dimensions: { ...row.dimensions, ubicacion: row.locationId, variante: row.variantId },
      physical: row.physical,
      reserved: row.reserved,
      committed: row.committed,
    }));
  }
  const facts: Fact[] = [];
  const orders = new Map(dataset.orders.map((order) => [order.id, order]));
  const sales = new Map(dataset.sales.map((line) => [line.id, line]));
  for (const line of dataset.sales) {
    const order = orders.get(line.orderId);
    if (!PAID_ORDERS.has(line.orderStatus) || (order && !PAID_ORDERS.has(order.status))) continue;
    const day = boliviaDate(order?.confirmedAt ?? line.occurredAt);
    facts.push({
      kind: 'sale',
      id: line.id,
      orderId: line.orderId,
      day,
      amount: line.amountMinor,
      units: line.quantity,
      price: line.unitPriceMinor,
      dimensions: timed(day, {
        ...order?.dimensions,
        ...line.dimensions,
        estado_pedido: order?.status ?? line.orderStatus,
      }),
    });
  }
  for (const row of dataset.returns) {
    if (!ACCEPTED_RETURNS.has(row.status)) continue;
    const day = boliviaDate(row.occurredAt),
      order = orders.get(row.orderId),
      sale = sales.get(row.lineId);
    facts.push({
      kind: 'return',
      id: row.id,
      orderId: row.orderId,
      day,
      units: row.quantity,
      price: sale?.unitPriceMinor,
      dimensions: timed(day, {
        ...order?.dimensions,
        ...sale?.dimensions,
        ...row.dimensions,
        estado_pedido: order?.status ?? sale?.orderStatus ?? null,
      }),
    });
  }
  for (const row of dataset.refunds) {
    if (row.status !== 'CONFIRMADO') continue;
    const day = boliviaDate(row.occurredAt),
      order = orders.get(row.orderId);
    facts.push({
      kind: 'refund',
      id: row.id,
      orderId: row.orderId,
      day,
      amount: row.amountMinor,
      dimensions: timed(day, {
        ...order?.dimensions,
        ...row.dimensions,
        estado_pedido: order?.status ?? null,
      }),
    });
  }
  return facts;
}
const paymentValue = (payment: Payment, field: ReportFilter['field']) =>
  field === 'metodo_pago' ? payment.method : payment.status;
const paymentGroup = (payments: Payment[], field: ReportFilter['field']) =>
  [...new Set(payments.map((payment) => paymentValue(payment, field)))].sort().join(' + ') || null;
function filteredPayments(payments: Payment[], filters: ReportFilter[]) {
  if (!filters.length) return payments;
  if (!payments.length) return filters.every((filter) => matchFilter(null, filter)) ? [] : null;
  const composite = filters.filter(
    (filter) =>
      filter.operator === 'eq' && typeof filter.value === 'string' && filter.value.includes(' + '),
  );
  const individual = filters.filter((filter) => !composite.includes(filter));
  if (composite.some((filter) => !matchFilter(paymentGroup(payments, filter.field), filter)))
    return null;
  const exclusion = individual.filter(
    (filter) => filter.operator === 'neq' || filter.operator === 'not_in',
  );
  if (
    exclusion.some((filter) =>
      payments.some((payment) => !matchFilter(paymentValue(payment, filter.field), filter)),
    )
  )
    return null;
  const included = payments.filter((payment) =>
    individual.every((filter) => matchFilter(paymentValue(payment, filter.field), filter)),
  );
  return included.length ? included : null;
}
export function selectedFacts(definition: ReportDefinition, dataset: ReportDataset, facts: Fact[]) {
  const payments = new Map<string, Payment[]>();
  for (const payment of dataset.payments) {
    const existing = payments.get(payment.orderId);
    if (existing) existing.push(payment);
    else payments.set(payment.orderId, [payment]);
  }
  const paymentFilters = definition.filters.filter((filter) => PAYMENT_FIELDS.has(filter.field));
  const otherFilters = definition.filters.filter(
    (filter) => filter.field !== 'periodo_comparacion' && !PAYMENT_FIELDS.has(filter.field),
  );
  const returned = new Set(
    dataset.returns.filter((row) => ACCEPTED_RETURNS.has(row.status)).map((row) => row.orderId),
  );
  const paymentByOrder = new Map<string, Dimensions | null>();
  function tags(orderId: string) {
    if (!paymentByOrder.has(orderId)) {
      const accepted = filteredPayments(payments.get(orderId) ?? [], paymentFilters);
      paymentByOrder.set(
        orderId,
        accepted && {
          metodo_pago: paymentGroup(accepted, 'metodo_pago'),
          estado_pago: paymentGroup(accepted, 'estado_pago'),
        },
      );
    }
    return paymentByOrder.get(orderId);
  }
  return facts.flatMap<Fact>((fact) => {
    const fields: Partial<Record<ReportFilter['field'], Scalar>> = {
      ...fact.dimensions,
      periodo: fact.day,
      precio_unitario: 'price' in fact ? (fact.price ?? null) : null,
      con_devolucion: 'orderId' in fact ? returned.has(fact.orderId) : null,
      disponible_al_corte:
        fact.kind === 'stock' ? fact.physical - fact.reserved - fact.committed : null,
    };
    if (!otherFilters.every((filter) => matchFilter(fields[filter.field] ?? null, filter)))
      return [];
    if (!('orderId' in fact)) return [fact];
    const paymentTags = tags(fact.orderId);
    return paymentTags ? [{ ...fact, dimensions: { ...fact.dimensions, ...paymentTags } }] : [];
  });
}
