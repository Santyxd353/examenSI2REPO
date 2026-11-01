import type { SQLiteDatabase } from 'expo-sqlite';
import type { OfflineIntent } from './intentRepository';
import type { LocalProjection } from './projection';
import { offlineScopeKey } from './scope';

/** Persistencia nativa: una intención nunca se confirma sin su proyección local. */
export class SQLiteIntentRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async enqueue(intent: OfflineIntent, projection: LocalProjection) {
    if (offlineScopeKey(intent.scope) !== offlineScopeKey(projection.scope))
      throw new Error('La intención y su proyección pertenecen a ámbitos distintos.');
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO offline_intent
          (operation_id, tenant_id, actor_id, device_id, kind, payload, base_version, depends_on, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        intent.operationId,
        intent.scope.tenantId,
        intent.scope.actorId,
        intent.scope.deviceId,
        intent.kind,
        intent.payload,
        intent.baseVersion,
        JSON.stringify(intent.dependsOn),
        intent.state,
        new Date().toISOString(),
      );
      await transaction.runAsync(
        `INSERT INTO offline_projection
          (tenant_id, actor_id, device_id, entity_id, version, payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, actor_id, device_id, entity_id)
         DO UPDATE SET version=excluded.version, payload=excluded.payload, updated_at=excluded.updated_at`,
        projection.scope.tenantId,
        projection.scope.actorId,
        projection.scope.deviceId,
        projection.entityId,
        projection.version,
        projection.payload,
        new Date().toISOString(),
      );
    });
  }

  async listIntents(scope: OfflineIntent['scope']): Promise<OfflineIntent[]> {
    const rows = await this.database.getAllAsync<{
      operation_id: string;
      kind: string;
      payload: string;
      base_version: number | null;
      depends_on: string;
      state: OfflineIntent['state'];
    }>(
      `SELECT operation_id,kind,payload,base_version,depends_on,state FROM offline_intent
       WHERE tenant_id=? AND actor_id=? AND device_id=? ORDER BY created_at ASC`,
      scope.tenantId,
      scope.actorId,
      scope.deviceId,
    );
    return rows.map((row) => ({
      operationId: row.operation_id,
      scope,
      kind: row.kind,
      payload: row.payload,
      baseVersion: row.base_version,
      dependsOn: JSON.parse(row.depends_on) as string[],
      state: row.state,
    }));
  }

  async replaceStates(scope: OfflineIntent['scope'], intents: readonly OfflineIntent[]) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const intent of intents) {
        await transaction.runAsync(
          `UPDATE offline_intent SET state=?
           WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=?`,
          intent.state,
          intent.operationId,
          scope.tenantId,
          scope.actorId,
          scope.deviceId,
        );
      }
    });
  }
}
