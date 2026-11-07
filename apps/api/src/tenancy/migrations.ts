import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { Client } from 'pg';

/** Caller owns the control transaction and platform advisory lock. No tenant connection. */
export async function applyControlMigrations(connection: Pick<Client, 'query'>): Promise<void> {
  await connection.query(`CREATE TABLE IF NOT EXISTS platform.schema_migration (
    name varchar(100) PRIMARY KEY, sha256 char(64) NOT NULL,
    applied_at timestamptz(6) NOT NULL DEFAULT now())`);
  const folder = resolve('prisma/platform/migrations');
  const files = readdirSync(folder)
    .filter((name) => /^\d{12,14}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  for (const name of files) {
    const sql = readFileSync(resolve(folder, name), 'utf8').replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(sql, 'utf8').digest('hex');
    const prior = await connection.query<{ sha256: string }>(
      'SELECT sha256 FROM platform.schema_migration WHERE name=$1',
      [name],
    );
    if (prior.rows[0]) {
      if (prior.rows[0].sha256 !== hash) throw new Error(`MIGRATION_CHECKSUM_MISMATCH: ${name}`);
      continue;
    }
    await connection.query(sql);
    await connection.query('INSERT INTO platform.schema_migration(name,sha256) VALUES($1,$2)', [
      name,
      hash,
    ]);
  }
}
