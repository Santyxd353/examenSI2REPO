import type { OfflineDashboardReport } from './offlineReport';

export type OfflineReportAnswer = Readonly<{ answer: string; intent: 'SALES' | 'ORDERS' | 'TOP_PRODUCT' | 'UNSUPPORTED' }>;

function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es-BO')
    .trim();
}

/** Consulta explicable, sin enviar la copia offline del usuario a un servicio externo. */
export function askOfflineReport(report: OfflineDashboardReport, question: string): OfflineReportAnswer {
  const text = normalize(question);
  if (!text) return { intent: 'UNSUPPORTED', answer: 'Escribe o dicta una pregunta sobre ventas, pedidos o el producto más vendido.' };
  if (/mas vendido|producto.*vende|top.*producto/.test(text)) {
    const top = [...report.products].sort((left, right) => right.ventas - left.ventas || right.unidades - left.unidades)[0];
    return top
      ? { intent: 'TOP_PRODUCT', answer: `${top.producto} (${top.sku}) lidera con ${top.unidades} unidades y Bs ${top.ventas.toFixed(2)}.` }
      : { intent: 'TOP_PRODUCT', answer: 'No hay productos vendidos en el último dashboard offline.' };
  }
  if (/pedido|orden/.test(text))
    return { intent: 'ORDERS', answer: `El último dashboard offline registra ${report.kpis.pedidos} pedidos y ${report.kpis.unidades} unidades.` };
  if (/venta|vend|factura|ingreso|recaud/.test(text))
    return { intent: 'SALES', answer: `Las ventas registradas en el último dashboard offline son Bs ${report.kpis.ventas.toFixed(2)}; ticket promedio Bs ${report.kpis.ticketPromedio.toFixed(2)}.` };
  return { intent: 'UNSUPPORTED', answer: 'Puedo responder sobre ventas, pedidos o el producto más vendido del último dashboard offline.' };
}
