import type { SQLiteDatabase } from 'expo-sqlite';
import type { OfflineScope } from '../../offline/scope';

export type OfflineDashboardReport = Readonly<{
  kpis: { pedidos: number; ventas: number; unidades: number; ticketPromedio: number };
  summary: string;
  generatedBy: string;
  products: readonly { variante_id: string; producto: string; sku: string; unidades: number; ventas: number }[];
  locations: readonly { ubicacion_id: string; ubicacion: string | null; pedidos: number; ventas: number }[];
}>;

type SnapshotRow = { payload: string; generated_at: string };

export function reportSnapshotKey(from: string, to: string, location?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw new Error('El período del reporte offline no es válido.');
  return `${from}:${to}:${location || 'TODAS'}`;
}

export function verifyOfflineDashboard(value: OfflineDashboardReport): OfflineDashboardReport {
  const kpis = value?.kpis;
  if (!kpis || ![kpis.pedidos, kpis.ventas, kpis.unidades, kpis.ticketPromedio].every(Number.isFinite))
    throw new Error('El dashboard offline no contiene indicadores numéricos válidos.');
  if (!Array.isArray(value.products) || !Array.isArray(value.locations) || typeof value.summary !== 'string')
    throw new Error('El dashboard offline está incompleto.');
  return value;
}

export async function saveOfflineDashboard(
  database: SQLiteDatabase,
  scope: OfflineScope,
  key: string,
  report: OfflineDashboardReport,
) {
  verifyOfflineDashboard(report);
  await database.runAsync(
    `INSERT INTO offline_report_snapshot
      (tenant_id, actor_id, device_id, report_key, payload, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, actor_id, device_id, report_key)
     DO UPDATE SET payload=excluded.payload, generated_at=excluded.generated_at`,
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
    key,
    JSON.stringify(report),
    new Date().toISOString(),
  );
}

export async function loadOfflineDashboard(
  database: SQLiteDatabase,
  scope: OfflineScope,
  key: string,
): Promise<{ report: OfflineDashboardReport; generatedAt: string } | null> {
  const row = await database.getFirstAsync<SnapshotRow>(
    `SELECT payload, generated_at FROM offline_report_snapshot
      WHERE tenant_id=? AND actor_id=? AND device_id=? AND report_key=?`,
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
    key,
  );
  if (!row) return null;
  try {
    return { report: verifyOfflineDashboard(JSON.parse(row.payload) as OfflineDashboardReport), generatedAt: row.generated_at };
  } catch {
    return null;
  }
}
