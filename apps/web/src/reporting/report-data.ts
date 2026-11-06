import {
  canonicalJson,
  ReportDatasetManifestSchema,
  ReportDatasetPageSchema,
  ReportDatasetSchema,
  type ReportDataset,
  type ReportDatasetManifest,
  type ReportDefinition,
} from '@lumina/contracts';
import { offlineResponse } from '../api';
import { sha256 } from '../offline/vault';

export type ReportIdentity = { slug: string; actorId: string; tenantId: string };
export type LocalReport = { dataset: ReportDataset; definition: ReportDefinition };
export const reportCopyKey = 'reports:current';

export async function fetchReportDataset(
  identity: ReportIdentity,
  input: unknown,
  signal: AbortSignal,
  progress: (loaded: number, total: number) => void,
) {
  const response = await offlineResponse(identity, '/api/reports/datasets', {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
  const manifest: ReportDatasetManifest = ReportDatasetManifestSchema.parse(await response.json());
  if (manifest.tenantId !== identity.tenantId || manifest.ownerId !== identity.actorId)
    throw new Error('El conjunto no pertenece a esta sesión.');
  const { expiresAt: _, ...metadata } = manifest;
  const rows: Pick<
    ReportDataset,
    'sales' | 'orders' | 'payments' | 'returns' | 'refunds' | 'stock'
  > = {
    sales: [],
    orders: [],
    payments: [],
    returns: [],
    refunds: [],
    stock: [],
  };
  let offset = 0;
  progress(0, manifest.rowCount);
  while (offset < manifest.rowCount) {
    const result = await offlineResponse(
      identity,
      `/api/reports/datasets/${manifest.datasetId}/rows?offset=${offset}&pageSize=500`,
      { signal },
    );
    const page = ReportDatasetPageSchema.parse(await result.json());
    if (
      page.datasetId !== manifest.datasetId ||
      page.asOf !== manifest.asOf ||
      page.sha256 !== manifest.sha256 ||
      page.offset !== offset ||
      !page.rows.length
    )
      throw new Error('El corte de la página no coincide con la descarga.');
    for (const row of page.rows) {
      switch (row.kind) {
        case 'sales':
          rows.sales.push(row.fact);
          break;
        case 'orders':
          rows.orders.push(row.fact);
          break;
        case 'payments':
          rows.payments.push(row.fact);
          break;
        case 'returns':
          rows.returns.push(row.fact);
          break;
        case 'refunds':
          rows.refunds.push(row.fact);
          break;
        case 'stock':
          rows.stock.push(row.fact);
          break;
      }
    }
    offset += page.rows.length;
    if (page.nextOffset !== (offset < manifest.rowCount ? offset : null))
      throw new Error('La paginación del conjunto no está completa.');
    progress(offset, manifest.rowCount);
  }
  const data = ReportDatasetSchema.parse({ ...metadata, ...rows });
  const { sha256: expected, ...unsigned } = data;
  if ((await sha256(new TextEncoder().encode(canonicalJson(unsigned)))) !== expected)
    throw new Error('El hash del conjunto descargado no coincide.');
  signal.throwIfAborted();
  return data;
}

export const fields: Record<string, string> = {
  dia: 'Día',
  semana: 'Semana ISO',
  mes: 'Mes',
  ubicacion: 'Ubicación',
  canal: 'Canal',
  vendedor: 'Vendedor',
  categoria: 'Categoría',
  marca: 'Marca',
  producto: 'Producto',
  variante: 'Variante',
  talla: 'Talla',
  color: 'Color',
  estado_pedido: 'Estado del pedido',
  estado_pago: 'Estado del pago',
  metodo_pago: 'Método de pago',
  periodo: 'Período',
  periodo_comparacion: 'Período de comparación',
  con_devolucion: 'Con devolución',
  precio_unitario: 'Precio unitario',
  disponible_al_corte: 'Disponible',
  importe_bob: 'Importe (Bs)',
  unidades: 'Unidades',
  ventas_confirmadas_bob: 'Ventas confirmadas',
  unidades_vendidas: 'Unidades vendidas',
  pedidos_distintos: 'Pedidos distintos',
  ticket_promedio_bob: 'Ticket promedio',
  unidades_devueltas: 'Unidades devueltas',
  reembolsos_confirmados_bob: 'Reembolsos confirmados',
  fisico_al_corte: 'Stock físico',
  reservado_al_corte: 'Reservado',
  comprometido_al_corte: 'Comprometido',
};
export function label(dataset: ReportDataset, field: string, value: string | null) {
  if (value === null) return 'Sin dato';
  const names = dataset.labels as Record<string, Record<string, string>> | undefined;
  return names?.[field]?.[value] ?? value;
}
