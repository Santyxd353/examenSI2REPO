import type { SQLiteDatabase } from 'expo-sqlite';
import type { OfflineIntent } from './intentRepository';
import type { LocalProjection } from './projection';
import { offlineScopeKey } from './scope';
import { openJson, sealJson, type VaultEnvelope } from './crypto';
import { readActiveDek } from './vault';

const payloadAad = (intent: OfflineIntent) =>
  `intent:${offlineScopeKey(intent.scope)}:${intent.operationId}`;
const projectionAad = (projection: LocalProjection) =>
  `projection:${offlineScopeKey(projection.scope)}:${projection.entityId}`;

/** Persistencia nativa: una intención nunca se confirma sin su proyección local. */
export class SQLiteIntentRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async enqueue(intent: OfflineIntent, projection: LocalProjection) {
    if (offlineScopeKey(intent.scope) !== offlineScopeKey(projection.scope))
      throw new Error('La intención y su proyección pertenecen a ámbitos distintos.');
    const dek = await readActiveDek(intent.scope);
    if (!dek) throw new Error('El almacén offline está bloqueado para esta sesión.');
    const sealedIntent = JSON.stringify(await sealJson(intent.payload, dek, payloadAad(intent)));
    const sealedProjection = JSON.stringify(await sealJson(projection.payload, dek, projectionAad(projection)));
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
        sealedIntent,
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
        sealedProjection,
        new Date().toISOString(),
      );
    });
  }

  async listIntents(scope: OfflineIntent['scope']): Promise<OfflineIntent[]> {
    const dek = await readActiveDek(scope);
    if (!dek) throw new Error('El almacén offline está bloqueado para esta sesión.');
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
    return Promise.all(rows.map(async (row) => {
      const intent = {
        operationId: row.operation_id,
        scope,
        kind: row.kind,
        baseVersion: row.base_version,
        dependsOn: JSON.parse(row.depends_on) as string[],
        state: row.state,
        payload: '',
      };
      let payload = row.payload;
      if (payload.startsWith('{"algorithm":"A256GCM"'))
        payload = await openJson<string>(JSON.parse(payload) as VaultEnvelope, dek, payloadAad(intent));
      return { ...intent, payload };
    }));
  }

  /** Un cierre puede dejar operaciones SENDING. Reenviar el mismo UUID es seguro e idempotente. */
  async recoverSending(scope: OfflineIntent['scope']) {
    await this.database.runAsync(
      `UPDATE offline_intent SET state='PENDING'
       WHERE tenant_id=? AND actor_id=? AND device_id=? AND state='SENDING'`,
      scope.tenantId, scope.actorId, scope.deviceId,
    );
  }

  async releaseRetryableBlocked(scope: OfflineIntent['scope']) {
    const intents = await this.listIntents(scope);
    const byId = new Map(intents.map((intent) => [intent.operationId, intent]));
    const retryable = intents.filter((intent) => intent.state === 'BLOCKED' &&
      intent.dependsOn.every((dependency) => byId.get(dependency)?.state === 'APPLIED'));
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const intent of retryable)
        await transaction.runAsync(
          `UPDATE offline_intent SET state='PENDING'
           WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='BLOCKED'`,
          intent.operationId, scope.tenantId, scope.actorId, scope.deviceId,
        );
    });
  }

  async markSending(scope: OfflineIntent['scope'], operationIds: readonly string[]) {
    if (!operationIds.length) return;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const operationId of operationIds) {
        const changed = await transaction.runAsync(
          `UPDATE offline_intent SET state='SENDING'
           WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='PENDING'`,
          operationId, scope.tenantId, scope.actorId, scope.deviceId,
        );
        if (changed.changes !== 1) throw new Error('La cola cambió antes de iniciar la sincronización.');
      }
    });
  }

  async settleTransportFailure(
    scope: OfflineIntent['scope'],
    operationIds: readonly string[],
    state: 'PENDING' | 'BLOCKED',
  ) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const operationId of operationIds)
        await transaction.runAsync(
          `UPDATE offline_intent SET state=?
           WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='SENDING'`,
          state, operationId, scope.tenantId, scope.actorId, scope.deviceId,
        );
    });
  }

  /** Conserva el conflicto original y crea un nuevo intento con la versión revisada. */
  async rebaseStockCount(scope: OfflineIntent['scope'], oldId: string, nextId: string, baseVersion: number) {
    if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new Error('Versión de inventario inválida.');
    const local = await this.listIntents(scope);
    const old = local.find((item) => item.operationId === oldId);
    if (!old || old.kind !== 'STOCK_COUNT' || old.state !== 'CONFLICT')
      throw new Error('El conteo ya no está disponible para revisión.');
    if (local.some((item) => item.dependsOn.includes(oldId) && item.state !== 'APPLIED'))
      throw new Error('Este conteo tiene operaciones dependientes; revísalas antes de reintentarlo.');
    const dek = await readActiveDek(scope);
    if (!dek) throw new Error('El almacén offline está bloqueado para esta sesión.');
    const next = { ...old, operationId: nextId, baseVersion, state: 'PENDING' as const };
    const sealed = JSON.stringify(await sealJson(next.payload, dek, payloadAad(next)));
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const changed = await transaction.runAsync(
        `UPDATE offline_intent SET state='SUPERSEDED'
         WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='CONFLICT'`,
        oldId, scope.tenantId, scope.actorId, scope.deviceId,
      );
      if (changed.changes !== 1) throw new Error('El conflicto cambió durante la revisión.');
      await transaction.runAsync(
        `INSERT INTO offline_intent
          (operation_id,tenant_id,actor_id,device_id,kind,payload,base_version,depends_on,state,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        nextId, scope.tenantId, scope.actorId, scope.deviceId, next.kind,
        sealed, baseVersion, JSON.stringify(next.dependsOn), next.state, new Date().toISOString(),
      );
    });
  }

  /** Conserva la edición en conflicto y crea un nuevo intento contra la versión revisada. */
  async rebaseCatalog(scope: OfflineIntent['scope'], oldId: string, nextId: string, baseVersion: number) {
    if (!Number.isInteger(baseVersion) || baseVersion < 1) throw new Error('Versión de catálogo inválida.');
    const local = await this.listIntents(scope);
    const old = local.find((item) => item.operationId === oldId);
    if (!old || !['CATALOG_UPDATE', 'CATALOG_ARCHIVE'].includes(old.kind) || old.state !== 'CONFLICT')
      throw new Error('El cambio de catálogo ya no está disponible para revisión.');
    const dek = await readActiveDek(scope);
    if (!dek) throw new Error('El almacén offline está bloqueado para esta sesión.');
    const next = { ...old, operationId: nextId, baseVersion, dependsOn: [], state: 'PENDING' as const };
    const sealed = JSON.stringify(await sealJson(next.payload, dek, payloadAad(next)));
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const changed = await transaction.runAsync(
        `UPDATE offline_intent SET state='SUPERSEDED'
         WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='CONFLICT'`,
        oldId, scope.tenantId, scope.actorId, scope.deviceId,
      );
      if (changed.changes !== 1) throw new Error('El conflicto cambió durante la revisión.');
      await transaction.runAsync(
        `INSERT INTO offline_intent
          (operation_id,tenant_id,actor_id,device_id,kind,payload,base_version,depends_on,state,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        nextId, scope.tenantId, scope.actorId, scope.deviceId, next.kind,
        sealed, baseVersion, '[]', next.state, new Date().toISOString(),
      );
    });
  }

  async replaceStates(scope: OfflineIntent['scope'], intents: readonly OfflineIntent[]) {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      for (const intent of intents) {
        await transaction.runAsync(
          `UPDATE offline_intent SET state=?
           WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=?
             AND state NOT IN ('APPLIED','REJECTED','SUPERSEDED')`,
          intent.state,
          intent.operationId,
          scope.tenantId,
          scope.actorId,
          scope.deviceId,
        );
      }
    });
  }

  async applyParentVersion(
    scope: OfflineIntent['scope'],
    parentOperationId: string,
    serverVersion: number,
  ) {
    if (!Number.isInteger(serverVersion) || serverVersion < 1) return;
    const intents = await this.listIntents(scope);
    const children = intents.filter((intent) =>
      intent.state === 'PENDING' && intent.baseVersion === null && intent.dependsOn.includes(parentOperationId));
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `UPDATE offline_intent SET base_version=?
         WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='APPLIED'`,
        serverVersion,
        parentOperationId,
        scope.tenantId,
        scope.actorId,
        scope.deviceId,
      );
      for (const child of children) {
        await transaction.runAsync(
          `UPDATE offline_intent SET base_version=?
           WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=?
             AND state='PENDING' AND base_version IS NULL`,
          serverVersion,
          child.operationId,
          scope.tenantId,
          scope.actorId,
          scope.deviceId,
        );
      }
    });
  }
}
