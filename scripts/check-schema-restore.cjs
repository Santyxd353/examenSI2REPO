require('dotenv/config');
const { Client } = require('pg');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFileSync, mkdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const assert = require('node:assert/strict');
const execute = promisify(execFile);

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Ensayo permitido solo sobre PostgreSQL local.');
  url.pathname = '/vestidor18_test';
  const admin = new Client({ connectionString: url.toString() });
  const prefix = 'lumina_restore_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const names = [prefix + '_source', prefix + '_old', prefix + '_new'];
  const clients = [];
  const output = resolve('.local/schema-restore', prefix);
  mkdirSync(output, { recursive: true });
  const binaryFolder =
    process.env.PG_BIN ||
    (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  const binary = (name) =>
    binaryFolder ? join(binaryFolder, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  await admin.connect();
  try {
    for (const name of names) {
      assert.match(name, /^lumina_restore_[a-f0-9]{12}_(source|old|new)$/);
      await admin.query(`CREATE DATABASE "${name}"`);
      const connectionUrl = new URL(url);
      connectionUrl.pathname = '/' + name;
      const client = new Client({ connectionString: connectionUrl.toString() });
      await client.connect();
      clients.push(client);
    }
    const source = clients[0];
    await source.query(readFileSync('prisma/documented-schema.sql', 'utf8'));
    await source.query(`INSERT INTO usuario(nombres,apellidos,correo,clave_hash,estado,preferencias,creado_en)
      VALUES('QA','Restore','restore@qa.test','hash-no-usado-para-login','ACTIVO','{}',now())`);
    for (const [stage, migrate] of [
      ['before', false],
      ['after', true],
    ]) {
      if (migrate)
        await source.query(
          readFileSync(
            'prisma/migrations/202611010001_saas_offline_analytics/migration.sql',
            'utf8',
          ),
        );
      const file = join(output, stage + '.dump');
      await execute(
        binary('pg_dump'),
        ['--format=custom', '--no-owner', '--no-acl', '--file', file],
        { env: { ...env, PGDATABASE: names[0] }, windowsHide: true, timeout: 60000 },
      );
      const target = migrate ? 2 : 1;
      await execute(
        binary('pg_restore'),
        ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', names[target], file],
        { env, windowsHide: true, timeout: 60000 },
      );
      assert.equal(
        (await clients[target].query('SELECT count(*) FROM usuario')).rows[0].count,
        '1',
      );
      const table = (
        await clients[target].query("SELECT to_regclass('public.operacion_sincronizacion') AS name")
      ).rows[0].name;
      assert.equal(table !== null, migrate);
      if (migrate) {
        for (const name of [
          'definicion_reporte',
          'conjunto_reporte',
          'conjunto_entrenamiento',
          'metrica_modelo',
          'consumo_cuota',
        ])
          assert.ok(
            (await clients[target].query('SELECT to_regclass($1) AS name', ['public.' + name]))
              .rows[0].name,
          );
      }
    }
    console.log(
      'PASS: respaldo anterior restaurado para reversión y respaldo migrado restaurado con las seis tablas; identidad QA conservada.',
    );
  } finally {
    for (const client of clients) await client.end();
    for (const name of names) {
      assert.match(name, /^lumina_restore_[a-f0-9]{12}_(source|old|new)$/);
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    }
    await admin.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[connection]')
      : 'Falló restore QA',
  );
  process.exitCode = 1;
});
