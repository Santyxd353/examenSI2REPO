import type { SQLiteDatabase } from 'expo-sqlite';
import type { OfflineIntent } from './intentRepository';
import type { LocalProjection } from './projection';
import { offlineScopeKey, type OfflineScope } from './scope';
import { prepareWireIntent } from './protocol';
import type { RecordCipher } from './recordCipher';
import type { ValidatedResult } from './protocol';
import { blockDependents } from './dependencyGraph';
import { canonicalIntentJson, OfflineIntentSchema } from '@lumina/contracts';

type IntentRow = {
  operation_id: string;
  kind: string;
  payload: string;
  base_version: number | null;
  depends_on: string;
  state: OfflineIntent['state'];
  created_at: string;
};

/** Negocio cifrado; intención y proyección se confirman en la misma transacción nativa. */
export class SQLiteIntentRepository {
  constructor(
    private readonly database: SQLiteDatabase,
    private readonly cipher: RecordCipher,
    private readonly digest: (text: string) => Promise<string>,
  ) {}

  async enqueue(intent: OfflineIntent, projection: LocalProjection) {
    const check = this.cipher.guard(intent.scope);
    if (offlineScopeKey(intent.scope) !== offlineScopeKey(projection.scope))
      throw new Error('La intención y su proyección pertenecen a ámbitos distintos.');
    const wire = await prepareWireIntent(intent, this.digest);
    check();
    if (projection.entityId !== wire.entityId)
      throw new Error('La proyección no corresponde a la entidad de la intención.');
    const payload = await this.cipher.seal(intent.scope, 'intent', intent.operationId, wire);
    check();
    const projected = await this.cipher.seal(
      projection.scope,
      'projection',
      projection.entityId,
      JSON.parse(projection.payload),
    );
    check();
    await this.database.withExclusiveTransactionAsync(async (tx) => {
      check();
      await tx.runAsync(
        `INSERT INTO offline_intent
        (operation_id,tenant_id,actor_id,device_id,kind,payload,base_version,depends_on,state,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
        wire.operationId,
        wire.tenantId,
        wire.actorId,
        wire.deviceId,
        wire.kind,
        payload,
        wire.baseVersion,
        JSON.stringify(wire.dependsOn),
        'PENDING',
        wire.createdAt,
      );
      check();
      await tx.runAsync(
        `INSERT INTO offline_projection
        (tenant_id,actor_id,device_id,entity_id,version,payload,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(tenant_id,actor_id,device_id,entity_id) DO UPDATE SET
        version=excluded.version,payload=excluded.payload,updated_at=excluded.updated_at`,
        wire.tenantId,
        wire.actorId,
        wire.deviceId,
        projection.entityId,
        projection.version,
        projected,
        new Date().toISOString(),
      );
      check();
    });
    check();
  }

  async listIntents(scope: OfflineScope): Promise<OfflineIntent[]> {
    const check = this.cipher.guard(scope);
    const rows = await this.database.getAllAsync<IntentRow>(
      `SELECT operation_id,kind,payload,base_version,
      depends_on,state,created_at FROM offline_intent WHERE tenant_id=? AND actor_id=? AND device_id=?
      ORDER BY created_at ASC,operation_id ASC`,
      scope.tenantId,
      scope.actorId,
      scope.deviceId,
    );
    check();
    const result: OfflineIntent[] = [];
    for (const row of rows) {
      const decoded = await this.cipher.open(scope, 'intent', row.operation_id, row.payload, true);
      check();
      let item: OfflineIntent = {
        operationId: row.operation_id,
        scope,
        kind: row.kind,
        payload: JSON.stringify(decoded.value),
        baseVersion: row.base_version,
        dependsOn: JSON.parse(row.depends_on),
        state: row.state === 'SENDING' ? 'PENDING' : row.state,
        createdAt: row.created_at,
      };
      const saved = await this.database.getFirstAsync<{ payload: string }>(
        `SELECT payload FROM offline_private_record
        WHERE tenant_id=? AND actor_id=? AND device_id=? AND namespace='sync-result' AND record_id=?`,
        scope.tenantId,
        scope.actorId,
        scope.deviceId,
        row.operation_id,
      );
      check();
      if (saved) {
        const { value } = await this.cipher.open<ValidatedResult>(
          scope,
          'sync-result',
          row.operation_id,
          saved.payload,
        );
        check();
        item = {
          ...item,
          message: value.message,
          confirmedAt: value.source?.receipt?.committedAt,
          confirmedVersion: value.serverVersion,
        };
      }
      try {
        if (decoded.legacy)
          throw new Error(
            'La operación anterior no tiene un comprobante local cifrado. Revisa sus datos antes de crear otra intención.',
          );
        const wire = await prepareWireIntent(item, this.digest);
        check();
        item = {
          ...item,
          entityId: wire.entityId,
          createdAt: wire.createdAt,
          payload: JSON.stringify(wire),
        };
        if (item.state === 'BLOCKED' && !item.message)
          item = {
            ...item,
            message: 'Esta intención requiere revisión antes de crear su reemplazo.',
          };
      } catch (error) {
        check();
        item = {
          ...item,
          state: item.state === 'DISCARDED' ? 'DISCARDED' : 'BLOCKED',
          message: (error as Error).message,
        };
      }
      if (decoded.migrated || item.state !== row.state) {
        const encoded = await this.cipher.seal(
          scope,
          'intent',
          row.operation_id,
          JSON.parse(item.payload),
        );
        check();
        await this.database.withExclusiveTransactionAsync(async (tx) => {
          check();
          await tx.runAsync(
            `UPDATE offline_intent SET payload=?,state=? WHERE operation_id=?
            AND tenant_id=? AND actor_id=? AND device_id=?`,
            encoded,
            item.state,
            row.operation_id,
            scope.tenantId,
            scope.actorId,
            scope.deviceId,
          );
          check();
        });
      }
      result.push(item);
    }
    check();
    return result;
  }

  async listProjections(scope: OfflineScope): Promise<LocalProjection[]> {
    const check = this.cipher.guard(scope);
    const rows = await this.database.getAllAsync<{
      entity_id: string;
      version: number | null;
      payload: string;
    }>(
      `SELECT entity_id,version,payload FROM offline_projection WHERE tenant_id=? AND actor_id=? AND device_id=?`,
      scope.tenantId,
      scope.actorId,
      scope.deviceId,
    );
    check();
    const projections: LocalProjection[] = [];
    for (const row of rows) {
      const { value, migrated } = await this.cipher.open(
        scope,
        'projection',
        row.entity_id,
        row.payload,
        true,
      );
      check();
      if (migrated) {
        const encoded = await this.cipher.seal(scope, 'projection', row.entity_id, value);
        check();
        await this.database.withExclusiveTransactionAsync(async (tx) => {
          check();
          await tx.runAsync(
            'UPDATE offline_projection SET payload=? WHERE tenant_id=? AND actor_id=? AND device_id=? AND entity_id=?',
            encoded,
            scope.tenantId,
            scope.actorId,
            scope.deviceId,
            row.entity_id,
          );
          check();
        });
      }
      projections.push({
        scope,
        entityId: row.entity_id,
        version: row.version,
        payload: JSON.stringify(value),
      });
    }
    check();
    return projections;
  }

  async replaceStates(scope: OfflineScope, intents: readonly OfflineIntent[]) {
    return this.reconcile(scope, intents, []);
  }

  async discard(scope: OfflineScope, operationId: string) {
    const rows = await this.listIntents(scope),
      item = rows.find((row) => row.operationId === operationId);
    if (!item) throw new Error('La operación no pertenece a esta cola.');
    if (!['CONFLICT', 'BLOCKED', 'DISCARDED'].includes(item.state))
      throw new Error('Solo se descartan conflictos o bloqueos ya revisados.');
    await this.replaceStates(
      scope,
      blockDependents(rows, operationId).map((row) =>
        row.operationId === operationId ? { ...row, state: 'DISCARDED' } : row,
      ),
    );
  }

  /** Revisión explícita: no cambia la intención rechazada ni reutiliza su comprobante. */
  async rebaseStockCount(scope: OfflineScope, oldId: string, nextId: string, baseVersion: number) {
    const check = this.cipher.guard(scope);
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 1)
      throw new Error('Versión de inventario inválida.');
    const rows = await this.listIntents(scope);
    check();
    const old = rows.find((row) => row.operationId === oldId);
    if (!old || old.kind !== 'STOCK_COUNT' || old.state !== 'CONFLICT')
      throw new Error('El conteo ya no está disponible para revisión.');
    if (
      rows.some(
        (row) => row.dependsOn.includes(oldId) && !['APPLIED', 'DISCARDED'].includes(row.state),
      )
    )
      throw new Error('El conteo tiene operaciones dependientes. Revísalas antes de reintentarlo.');
    if (rows.some((row) => row.operationId === nextId))
      throw new Error('El UUID del nuevo intento ya existe.');
    const original = await prepareWireIntent(old, this.digest);
    check();
    const { payloadHash: _oldHash, ...prior } = original;
    const unsigned = {
      ...prior,
      operationId: nextId,
      baseVersion,
      createdAt: new Date().toISOString(),
    };
    const wire = OfflineIntentSchema.parse({
      ...unsigned,
      payloadHash: await this.digest(canonicalIntentJson(unsigned)),
    });
    check();
    const payload = await this.cipher.seal(scope, 'intent', nextId, wire);
    check();
    await this.database.withExclusiveTransactionAsync(async (tx) => {
      check();
      const changed = await tx.runAsync(
        `UPDATE offline_intent SET state='DISCARDED'
         WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=? AND state='CONFLICT'`,
        oldId,
        scope.tenantId,
        scope.actorId,
        scope.deviceId,
      );
      check();
      if (changed.changes !== 1) throw new Error('El conflicto cambió durante la revisión.');
      await tx.runAsync(
        `INSERT INTO offline_intent
         (operation_id,tenant_id,actor_id,device_id,kind,payload,base_version,depends_on,state,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        wire.operationId,
        scope.tenantId,
        scope.actorId,
        scope.deviceId,
        wire.kind,
        payload,
        wire.baseVersion,
        JSON.stringify(wire.dependsOn),
        'PENDING',
        wire.createdAt,
      );
      check();
    });
    check();
  }

  async reconcile(
    scope: OfflineScope,
    intents: readonly OfflineIntent[],
    results: readonly ValidatedResult[],
  ) {
    const check = this.cipher.guard(scope);
    if (intents.some((item) => offlineScopeKey(item.scope) !== offlineScopeKey(scope)))
      throw new Error('La cola pertenece a otro ámbito.');
    const encoded: { id: string; payload: string }[] = [];
    for (const result of results) {
      encoded.push({
        id: result.operationId,
        payload: await this.cipher.seal(scope, 'sync-result', result.operationId, result),
      });
      check();
    }
    await this.database.withExclusiveTransactionAsync(async (tx) => {
      for (const result of encoded) {
        check();
        await tx.runAsync(
          `INSERT INTO offline_private_record
        (tenant_id,actor_id,device_id,namespace,record_id,payload,saved_at) VALUES (?,?,?,'sync-result',?,?,?)
        ON CONFLICT(tenant_id,actor_id,device_id,namespace,record_id) DO UPDATE SET
        payload=excluded.payload,saved_at=excluded.saved_at`,
          scope.tenantId,
          scope.actorId,
          scope.deviceId,
          result.id,
          result.payload,
          new Date().toISOString(),
        );
        check();
      }
      for (const item of intents) {
        check();
        await tx.runAsync(
          `UPDATE offline_intent SET state=?
        WHERE operation_id=? AND tenant_id=? AND actor_id=? AND device_id=?
          AND state NOT IN ('APPLIED','DISCARDED')`,
          item.state,
          item.operationId,
          scope.tenantId,
          scope.actorId,
          scope.deviceId,
        );
        check();
      }
    });
    check();
  }
}
