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
}
