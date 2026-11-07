import type { SQLiteDatabase } from 'expo-sqlite';
import type { RecordCipher } from './recordCipher';
import type { OfflineScope } from './scope';

export class PrivateRecords {
  constructor(
    private readonly db: SQLiteDatabase,
    private readonly cipher: RecordCipher,
  ) {}
  async put(scope: OfflineScope, namespace: string, id: string, value: unknown) {
    const check = this.cipher.guard(scope);
    const payload = await this.cipher.seal(scope, namespace, id, value);
    check();
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      check();
      await tx.runAsync(
        `INSERT INTO offline_private_record
      (tenant_id,actor_id,device_id,namespace,record_id,payload,saved_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(tenant_id,actor_id,device_id,namespace,record_id) DO UPDATE SET
      payload=excluded.payload,saved_at=excluded.saved_at`,
        scope.tenantId,
        scope.actorId,
        scope.deviceId,
        namespace,
        id,
        payload,
        new Date().toISOString(),
      );
      check();
    });
    check();
  }
  async get<T>(
    scope: OfflineScope,
    namespace: string,
    id: string,
  ): Promise<{ value: T; savedAt: string } | null> {
    const check = this.cipher.guard(scope);
    const row = await this.db.getFirstAsync<{ payload: string; saved_at: string }>(
      `SELECT payload,saved_at FROM offline_private_record
      WHERE tenant_id=? AND actor_id=? AND device_id=? AND namespace=? AND record_id=?`,
      scope.tenantId,
      scope.actorId,
      scope.deviceId,
      namespace,
      id,
    );
    check();
    if (!row) return null;
    const { value, migrated } = await this.cipher.open<T>(scope, namespace, id, row.payload);
    check();
    if (migrated) await this.put(scope, namespace, id, value);
    check();
    return { value, savedAt: row.saved_at };
  }
  async remove(scope: OfflineScope, namespace: string, ids: readonly string[]) {
    const check = this.cipher.guard(scope);
    if (ids.length > 100) throw new Error('El lote de limpieza local es demasiado grande.');
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      for (const id of new Set(ids)) {
        check();
        await tx.runAsync(
          `DELETE FROM offline_private_record
        WHERE tenant_id=? AND actor_id=? AND device_id=? AND namespace=? AND record_id=?`,
          scope.tenantId,
          scope.actorId,
          scope.deviceId,
          namespace,
          id,
        );
        check();
      }
    });
    check();
  }
}
