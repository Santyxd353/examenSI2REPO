import {
  canonicalJson,
  ReportDatasetManifestSchema,
  ReportDatasetPageSchema,
  ReportDatasetSchema,
  type ReportDataset,
} from '@lumina/contracts';
import type { OfflineScope } from '../../offline/scope';

export async function readReportDataset(
  scope: OfflineScope,
  raw: unknown,
  deps: {
    get(datasetId: string, offset: number): Promise<unknown>;
    digest(text: string): Promise<string>;
    guard(): void;
    progress?: (loaded: number, total: number) => void;
  },
) {
  deps.guard();
  const manifest = ReportDatasetManifestSchema.parse(raw);
  if (manifest.tenantId !== scope.tenantId || manifest.ownerId !== scope.actorId)
    throw new Error('El conjunto pertenece a otra cuenta.');
  const { expiresAt: _expires, ...metadata } = manifest;
  const rows: Pick<
    ReportDataset,
    'sales' | 'orders' | 'payments' | 'returns' | 'refunds' | 'stock'
  > = { sales: [], orders: [], payments: [], returns: [], refunds: [], stock: [] };
  let offset = 0;
  deps.progress?.(0, manifest.rowCount);
  while (offset < manifest.rowCount) {
    const page = ReportDatasetPageSchema.parse(await deps.get(manifest.datasetId, offset));
    deps.guard();
    if (
      page.datasetId !== manifest.datasetId ||
      page.asOf !== manifest.asOf ||
      page.sha256 !== manifest.sha256 ||
      page.offset !== offset ||
      !page.rows.length
    )
      throw new Error('La página no pertenece al mismo corte de datos.');
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
    if (
      offset > manifest.rowCount ||
      page.nextOffset !== (offset < manifest.rowCount ? offset : null)
    )
      throw new Error('Paginación incompleta del conjunto.');
    deps.progress?.(offset, manifest.rowCount);
  }
  const data = ReportDatasetSchema.parse({ ...metadata, ...rows });
  const { sha256, ...unsigned } = data;
  if ((await deps.digest(canonicalJson(unsigned))) !== sha256)
    throw new Error('Falló la verificación SHA-256 del conjunto.');
  deps.guard();
  return data;
}
