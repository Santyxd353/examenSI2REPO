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
    CREATE TABLE IF NOT EXISTS offline_ar_resource (
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      resource_id TEXT NOT NULL, variant_id TEXT NOT NULL, checksum TEXT NOT NULL,
      local_uri TEXT NOT NULL, downloaded_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id, actor_id, device_id, resource_id)
    );
    CREATE TABLE IF NOT EXISTS offline_report_snapshot (
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      report_key TEXT NOT NULL, payload TEXT NOT NULL, generated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id, actor_id, device_id, report_key)
    );
    CREATE TABLE IF NOT EXISTS offline_inventory_snapshot (
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      location_id TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id, actor_id, device_id, location_id)
    );
    CREATE TABLE IF NOT EXISTS offline_catalog_snapshot (
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      payload TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id, actor_id, device_id)
    );
    CREATE TABLE IF NOT EXISTS offline_catalog_attachment (
      resource_id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, device_id TEXT NOT NULL,
      product_id TEXT NOT NULL, sha256 TEXT NOT NULL, mime_type TEXT NOT NULL,
      local_uri TEXT NOT NULL, state TEXT NOT NULL, message TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_offline_catalog_attachment_scope_product
      ON offline_catalog_attachment(tenant_id, actor_id, device_id, product_id, state);
    PRAGMA user_version = 6;
  `);
}
