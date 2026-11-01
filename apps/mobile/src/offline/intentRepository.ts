import type { LocalProjection } from './projection';
import { offlineScopeKey, type OfflineScope } from './scope';

export type OfflineIntent = Readonly<{
  operationId: string;
  scope: OfflineScope;
  kind: string;
  payload: string;
  baseVersion: number | null;
  dependsOn: readonly string[];
  state: 'PENDING' | 'SENDING' | 'APPLIED' | 'CONFLICT' | 'BLOCKED';
}>;

export interface OfflineTransaction {
  insertIntent(intent: OfflineIntent): Promise<void>;
  upsertProjection(projection: LocalProjection): Promise<void>;
}

export interface OfflineStore extends OfflineTransaction {
  exclusive<T>(work: (transaction: OfflineTransaction) => Promise<T>): Promise<T>;
  intents(scope: OfflineScope): readonly OfflineIntent[];
  projections(scope: OfflineScope): readonly LocalProjection[];
}

export class IntentRepository {
  constructor(private readonly store: OfflineStore) {}

  async enqueue(intent: OfflineIntent, projection: LocalProjection) {
    if (offlineScopeKey(intent.scope) !== offlineScopeKey(projection.scope))
      throw new Error('La intención y su proyección pertenecen a ámbitos distintos.');
    await this.store.exclusive(async (transaction) => {
      await transaction.insertIntent(intent);
      await transaction.upsertProjection(projection);
    });
  }
}

/** Implementación de prueba: copia el estado antes de una transacción exclusiva. */
export class MemoryOfflineStore implements OfflineStore {
  private intentRows: OfflineIntent[] = [];
  private projectionRows: LocalProjection[] = [];

  async exclusive<T>(work: (transaction: OfflineTransaction) => Promise<T>): Promise<T> {
    const intents = [...this.intentRows];
    const projections = [...this.projectionRows];
    try {
      return await work(this);
    } catch (error) {
      this.intentRows = intents;
      this.projectionRows = projections;
      throw error;
    }
  }

  async insertIntent(intent: OfflineIntent) {
    if (this.intentRows.some((row) => row.operationId === intent.operationId)) throw new Error('operationId duplicado');
    this.intentRows.push(intent);
  }

  async upsertProjection(projection: LocalProjection) {
    const key = `${offlineScopeKey(projection.scope)}:${projection.entityId}`;
    this.projectionRows = [...this.projectionRows.filter((row) => `${offlineScopeKey(row.scope)}:${row.entityId}` !== key), projection];
  }

  intents(scope: OfflineScope) { return this.intentRows.filter((row) => offlineScopeKey(row.scope) === offlineScopeKey(scope)); }
  projections(scope: OfflineScope) { return this.projectionRows.filter((row) => offlineScopeKey(row.scope) === offlineScopeKey(scope)); }
}
