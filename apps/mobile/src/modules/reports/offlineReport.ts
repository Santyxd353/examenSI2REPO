import type { SQLiteDatabase } from 'expo-sqlite';
import type { OfflineScope } from '../../offline/scope';
import type { RecordCipher } from '../../offline/recordCipher';

export type OfflineDashboardReport = Readonly<{
  kpis: { pedidos: number; ventas: number; unidades: number; ticketPromedio: number };
  summary: string;
  generatedBy: string;
  products: readonly {
    variante_id: string;
    producto: string;
    sku: string;
    unidades: number;
    ventas: number;
  }[];
  locations: readonly {
    ubicacion_id: string;
    ubicacion: string | null;
    pedidos: number;
    ventas: number;
  }[];
}>;

type SnapshotRow = { payload: string; generated_at: string };

export function reportSnapshotKey(from: string, to: string, location?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw new Error('El período del reporte offline no es válido.');
  return `${from}:${to}:${location || 'TODAS'}`;
}

export function verifyOfflineDashboard(value: OfflineDashboardReport): OfflineDashboardReport {
  const kpis = value?.kpis;
  if (
    !kpis ||
    ![kpis.pedidos, kpis.ventas, kpis.unidades, kpis.ticketPromedio].every(Number.isFinite)
  )
    throw new Error('El dashboard offline no contiene indicadores numéricos válidos.');
  if (
    !Array.isArray(value.products) ||
    !Array.isArray(value.locations) ||
    typeof value.summary !== 'string'
  )
    throw new Error('El dashboard offline está incompleto.');
  return value;
}

export async function saveOfflineDashboard(
  database: SQLiteDatabase,
  scope: OfflineScope,
  key: string,
  report: OfflineDashboardReport,
  injectedCipher?: RecordCipher,
) {
  verifyOfflineDashboard(report);
  const cipher = injectedCipher ?? (await import('../../offline/nativeStorage')).nativeRecordCipher;
  const check = cipher.guard(scope);
  const payload = await cipher.seal(scope, 'dashboard', key, report);
  check();
  await database.withExclusiveTransactionAsync(async (tx) => {
    check();
    await tx.runAsync(
      `INSERT INTO offline_report_snapshot
      (tenant_id, actor_id, device_id, report_key, payload, generated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, actor_id, device_id, report_key)
     DO UPDATE SET payload=excluded.payload, generated_at=excluded.generated_at`,
      scope.tenantId,
      scope.actorId,
      scope.deviceId,
      key,
      payload,
      new Date().toISOString(),
    );
    check();
  });
  check();
}

export async function loadOfflineDashboard(
  database: SQLiteDatabase,
  scope: OfflineScope,
  key: string,
  injectedCipher?: RecordCipher,
): Promise<{ report: OfflineDashboardReport; generatedAt: string } | null> {
  const cipher = injectedCipher ?? (await import('../../offline/nativeStorage')).nativeRecordCipher;
  const check = cipher.guard(scope);
  const row = await database.getFirstAsync<SnapshotRow>(
    `SELECT payload, generated_at FROM offline_report_snapshot
      WHERE tenant_id=? AND actor_id=? AND device_id=? AND report_key=?`,
    scope.tenantId,
    scope.actorId,
    scope.deviceId,
    key,
  );
  check();
  if (!row) return null;
  const { value, migrated } = await cipher.open<OfflineDashboardReport>(
    scope,
    'dashboard',
    key,
    row.payload,
  );
  check();
  const report = verifyOfflineDashboard(value);
  if (migrated) {
    const encoded = await cipher.seal(scope, 'dashboard', key, report);
    check();
    await database.withExclusiveTransactionAsync(async (tx) => {
      check();
      await tx.runAsync(
        'UPDATE offline_report_snapshot SET payload=? WHERE tenant_id=? AND actor_id=? AND device_id=? AND report_key=?',
        encoded,
        scope.tenantId,
        scope.actorId,
        scope.deviceId,
        key,
      );
      check();
    });
  }
  check();
  return { report, generatedAt: row.generated_at };
}
