import type { SQLiteDatabase } from 'expo-sqlite';

export async function migrateOfflineDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS offline_intent (
      operation_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      kind TEXT NOT NULL, payload TEXT NOT NULL, base_version INTEGER,
      depends_on TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_intent_scope_state
      ON offline_intent(tenant_id, actor_id, device_id, state);
    CREATE TABLE IF NOT EXISTS offline_projection (
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      entity_id TEXT NOT NULL, version INTEGER, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id, actor_id, device_id, entity_id)
    );
    PRAGMA user_version = 1;
  `);
}
