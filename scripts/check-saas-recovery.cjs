// Ensayo QA aislado: nunca respalda ni restaura una instalación comercial.
require('dotenv/config');
require('reflect-metadata');
require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { TenantRegistry } = require('../apps/api/src/tenancy/platform.ts');
const { DeviceKeysService } = require('../apps/api/src/offline/device-keys.service.ts');
const { runForTenant } = require('../apps/api/src/tenancy/context.ts');
const { inventoryFiles, verifyFiles, sha256 } = require('./lib/recovery-manifest.cjs');
const execute = promisify(execFile);

async function main() {
  const qa = new URL(process.env.SAAS_QA_DATABASE_URL || process.env.DATABASE_URL);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(qa.hostname) ||
    qa.pathname !== '/vestidor18_test'
  )
    throw new Error('El ensayo requiere PostgreSQL local y vestidor18_test.');
  const started = Date.now(),
    prefix = 'lumina_recovery_' + randomUUID().replaceAll('-', '').slice(0, 12);
  const output = path.resolve('.local', 'saas-recovery', prefix);
  const sourceFiles = path.join(output, 'source-storage'),
    archive = path.join(output, 'backup');
  const restoredFiles = path.join(output, 'restored-storage');
  fs.mkdirSync(sourceFiles, { recursive: true });
  fs.mkdirSync(archive);
  const names = ['src_control', 'src_a', 'src_b', 'dst_control', 'dst_a', 'dst_b'].map(
    (suffix) => prefix + '_' + suffix,
  );
  const created = [],
    clients = [],
    registries = [];
  const connection = (name) => {
    const url = new URL(qa);
    url.pathname = '/' + name;
    return url.toString();
  };
  const admin = new Client({ connectionString: qa.toString() });
  const pgFolder =
    process.env.PG_BIN ||
    (process.platform === 'win32' ? 'C:/Program Files/PostgreSQL/18/bin' : '');
  const binary = (name) =>
    pgFolder ? path.join(pgFolder, name + (process.platform === 'win32' ? '.exe' : '')) : name;
  const pgEnv = {
    ...process.env,
    PGHOST: qa.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: qa.port || '5432',
    PGUSER: decodeURIComponent(qa.username),
    PGPASSWORD: decodeURIComponent(qa.password),
    PGSSLMODE: 'disable',
  };
  async function command(program, args, env, label) {
    try {
      const result = await execute(program, args, {
        cwd: path.resolve('.'),
        env,
        windowsHide: true,
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      });
      fs.writeFileSync(
        path.join(output, label + '.log'),
        (result.stdout || '') + (result.stderr || ''),
      );
    } catch (error) {
      fs.writeFileSync(
        path.join(output, label + '.log'),
        String(error.stdout || '') + String(error.stderr || ''),
      );
      throw new Error('Falló ' + label + '; revisa el log QA local.');
    }
  }
  async function migrate(name, label) {
    await command(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
      { ...process.env, DATABASE_URL: connection(name), NODE_OPTIONS: '--max-old-space-size=768' },
      label,
    );
  }
  function configure(control, business, storage) {
    process.env.PLATFORM_DATABASE_URL = connection(control);
    process.env.DATABASE_URL = process.env.TENANT_DATABASE_URL = connection(business);
    process.env.STORAGE_ROOT = storage;
  }
  const prisma = (name) => {
    const client = new PrismaClient({ datasources: { db: { url: connection(name) } } });
    clients.push(client);
    return client;
  };
  let summary;
  await admin.connect();
  try {
    for (const name of names) {
      assert.match(name, /^lumina_recovery_[a-f0-9]{12}_(src|dst)_(control|a|b)$/);
      await admin.query('CREATE DATABASE "' + name + '"');
      created.push(name);
    }
    for (let index = 1; index <= 2; index++) await migrate(names[index], 'source-migrate-' + index);
    configure(names[0], names[1], sourceFiles);
    const sourceRegistry = new TenantRegistry();
    registries.push(sourceRegistry);
    await sourceRegistry.initialize();
    await sourceRegistry.pool.query(
      "UPDATE platform.subscription SET plan_code='esencial',status='ACTIVE',current_period_start=now(),current_period_end=now()+interval '1 month' WHERE tenant_id=(SELECT id FROM platform.tenant WHERE slug='lumina')",
    );
    const secondId = randomUUID();
    await sourceRegistry.pool.query(
      "INSERT INTO platform.tenant(id,slug,name,database_name,state) VALUES($1,'qa-recovery-b','QA Recuperación B',$2,'ACTIVE')",
      [secondId, names[2]],
    );
    await sourceRegistry.pool.query(
      "INSERT INTO platform.subscription(tenant_id,plan_code,status,provider,current_period_start,current_period_end) VALUES($1,'negocio','ACTIVE','QR_SIMULATED',now(),now()+interval '1 month')",
      [secondId],
    );
    const slugs = ['lumina', 'qa-recovery-b'];
    const scopes = await Promise.all(slugs.map((slug) => sourceRegistry.resolve(slug)));
    const actor = randomUUID(),
      device = randomUUID(),
      category = randomUUID(),
      product = randomUUID();
    const variant = randomUUID(),
      location = randomUUID(),
      inventory = randomUUID();
    // Solo material efímero de QA; nunca se copian secretos reales de .env.
    const recovery = {
      synthetic: true,
      activeVersion: 2,
      keys: { 1: randomBytes(32).toString('base64'), 2: randomBytes(32).toString('base64') },
    };
    process.env.OFFLINE_WRAP_KEYS = JSON.stringify(recovery.keys);
    const expected = [];
    for (let index = 0; index < 2; index++) {
      const db = prisma(names[index + 1]),
        scope = scopes[index],
        physical = index ? 9 : 4;
      await db.usuario.create({
        data: {
          id: actor,
          nombres: 'QA',
          apellidos: 'Recuperación',
          correo: 'recovery@qa.invalid',
          clave_hash: 'QA_NO_LOGIN',
          estado: 'ACTIVO',
          preferencias: {},
          creado_en: new Date(),
        },
      });
      await db.categoria.create({ data: { id: category, nombre: 'Vestidos QA', activa: true } });
      await db.producto.create({
        data: {
          id: product,
          categoria_id: category,
          nombre: 'Vestido QA ' + index,
          descripcion: 'DATOS SINTÉTICOS DE RECUPERACIÓN',
          material: 'QA',
          estado: 'PUBLICADO',
          creado_en: new Date(),
        },
      });
      await db.variante.create({
        data: {
          id: variant,
          producto_id: product,
          sku: 'MISMO-SKU-QA',
          talla: 'M',
          color: 'Rosa',
          activa: true,
        },
      });
      await db.ubicacion.create({
        data: { id: location, nombre: 'QA', tipo: 'TIENDA', activa: true },
      });
      await db.inventario.create({
        data: {
          id: inventory,
          variante_id: variant,
          ubicacion_id: location,
          fisico: physical,
          reservado: 0,
          comprometido: 0,
          version: index + 2,
        },
      });
      const keys = new DeviceKeysService(db);
      process.env.OFFLINE_WRAP_KEY_VERSION = '1';
      const first = await runForTenant(scope, () => keys.recover(actor, device));
      process.env.OFFLINE_WRAP_KEY_VERSION = '2';
      const rotated = await runForTenant(scope, () => keys.recover(actor, device));
      assert.equal(first.keyBase64, rotated.keyBase64);
      const folder = path.join(scope.storageDirectory, 'private');
      fs.mkdirSync(folder, { recursive: true });
      const aad = 'QA_RECOVERY:' + scope.id,
        nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(first.keyBase64, 'base64'), nonce);
      cipher.setAAD(Buffer.from(aad));
      const plaintext = 'PENDIENTE_SINTETICO_QA_' + index;
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      fs.writeFileSync(
        path.join(folder, 'pending.fixture.enc'),
        JSON.stringify({
          nonce: nonce.toString('base64'),
          ciphertext: encrypted.toString('base64'),
          tag: cipher.getAuthTag().toString('base64'),
          aad,
        }),
      );
      fs.writeFileSync(path.join(folder, 'model.fixture.bin'), randomBytes(4096));
      expected.push({
        scope,
        physical,
        dek: first.keyBase64,
        plaintext,
        database: names[index + 1],
      });
    }
    assert.notEqual(expected[0].dek, expected[1].dek);
    const files = inventoryFiles(sourceFiles);
    fs.cpSync(sourceFiles, path.join(archive, 'storage'), { recursive: true });
    fs.writeFileSync(path.join(archive, 'recovery-secrets.qa.json'), JSON.stringify(recovery), {
      mode: 0o600,
    });
    for (let index = 0; index < 3; index++)
      await command(
        binary('pg_dump'),
        [
          '--format=custom',
          '--no-owner',
          '--no-acl',
          '--file',
          path.join(archive, index + '.dump'),
        ],
        { ...pgEnv, PGDATABASE: names[index] },
        'dump-' + index,
      );
    const manifest = {
      schemaVersion: '1.0',
      synthetic: true,
      sourceSha: require('node:child_process')
        .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })
        .trim(),
      files,
      dumps: [0, 1, 2].map((index) => ({
        file: index + '.dump',
        sha256: sha256(fs.readFileSync(path.join(archive, index + '.dump'))),
      })),
      recoverySecretsSha256: sha256(
        fs.readFileSync(path.join(archive, 'recovery-secrets.qa.json')),
      ),
    };
    fs.writeFileSync(path.join(archive, 'manifest.json'), JSON.stringify(manifest, null, 2));
    verifyFiles(path.join(archive, 'storage'), manifest.files);
    for (let index = 0; index < 3; index++) {
      assert.equal(
        sha256(fs.readFileSync(path.join(archive, index + '.dump'))),
        manifest.dumps[index].sha256,
      );
      await command(
        binary('pg_restore'),
        [
          '--exit-on-error',
          '--no-owner',
          '--no-privileges',
          '--dbname',
          names[index + 3],
          path.join(archive, index + '.dump'),
        ],
        pgEnv,
        'restore-' + index,
      );
    }
    fs.cpSync(path.join(archive, 'storage'), restoredFiles, { recursive: true });
    verifyFiles(restoredFiles, manifest.files);
    const secretBytes = fs.readFileSync(path.join(archive, 'recovery-secrets.qa.json'));
    assert.equal(sha256(secretBytes), manifest.recoverySecretsSha256);
    const recoveredSecrets = JSON.parse(secretBytes);
    configure(names[3], names[4], restoredFiles);
    const restoredRegistry = new TenantRegistry();
    registries.push(restoredRegistry);
    // IDs de tienda se conservan; solo cambia el destino físico de cada conexión.
    for (let index = 0; index < 2; index++)
      await restoredRegistry.pool.query('UPDATE platform.tenant SET database_name=$2 WHERE id=$1', [
        scopes[index].id,
        names[index + 4],
      ]);
    await restoredRegistry.initialize();
    const checks = [];
    for (let index = 0; index < 2; index++) {
      await migrate(names[index + 4], 'restored-migrate-' + index);
      const restoredScope = await restoredRegistry.resolve(slugs[index]),
        db = prisma(names[index + 4]);
      assert.equal(new URL(restoredScope.databaseUrl).pathname, '/' + names[index + 4]);
      assert.equal(restoredScope.id, scopes[index].id);
      assert.equal(restoredScope.subscription.plan, index ? 'negocio' : 'esencial');
      const stock = await db.inventario.findUniqueOrThrow({ where: { id: inventory } });
      assert.equal(stock.fisico, expected[index].physical);
      assert.equal(stock.version, index + 2);
      assert.equal(await db.producto.count(), 1);
      const keys = new DeviceKeysService(db),
        before = await db.configuracion.count();
      process.env.OFFLINE_WRAP_KEYS = JSON.stringify({
        ...recoveredSecrets.keys,
        2: randomBytes(32).toString('base64'),
      });
      await assert.rejects(runForTenant(restoredScope, () => keys.recover(actor, device)));
      assert.equal(await db.configuracion.count(), before);
      process.env.OFFLINE_WRAP_KEYS = JSON.stringify(recoveredSecrets.keys);
      process.env.OFFLINE_WRAP_KEY_VERSION = String(recoveredSecrets.activeVersion);
      const dek = await runForTenant(restoredScope, () => keys.recover(actor, device));
      assert.equal(dek.keyBase64, expected[index].dek);
      const pending = JSON.parse(
        fs.readFileSync(
          path.join(restoredScope.storageDirectory, 'private', 'pending.fixture.enc'),
        ),
      );
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(dek.keyBase64, 'base64'),
        Buffer.from(pending.nonce, 'base64'),
      );
      decipher.setAAD(Buffer.from(pending.aad));
      decipher.setAuthTag(Buffer.from(pending.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(pending.ciphertext, 'base64')),
        decipher.final(),
      ]).toString();
      assert.equal(plaintext, expected[index].plaintext);
      checks.push({
        tenantId: restoredScope.id,
        plan: restoredScope.subscription.plan,
        physical: stock.fisico,
        keysRecovered: true,
        wrongKeyRejectedWithoutReplacement: true,
        pendingDecrypted: true,
      });
    }
    summary = {
      passed: true,
      synthetic: true,
      date: new Date().toISOString(),
      sourceSha: manifest.sourceSha,
      elapsedMs: Date.now() - started,
      databasesRestored: 3,
      filesVerified: files.length,
      checks,
      productionBackupCreated: false,
      vmAccessed: false,
    };
  } finally {
    for (const client of clients) await client.$disconnect();
    for (const registry of registries) await registry.onModuleDestroy();
    for (const name of [...created].reverse()) {
      assert.match(name, /^lumina_recovery_[a-f0-9]{12}_(src|dst)_(control|a|b)$/);
      await admin.query('DROP DATABASE "' + name + '"');
    }
    await admin.end();
  }
  summary.elapsedMs = Date.now() - started;
  summary.cleanupCompleted = true;
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(
    'PASS: control y dos tiendas restaurados; archivos íntegros, claves recuperadas y clave incorrecta rechazada sin reemplazo.',
  );
  console.log('Evidencia QA: ' + path.join(output, 'summary.json'));
}
main().catch((error) => {
  console.error(
    String(error.message || 'Falló recuperación QA').replace(
      /postgres(?:ql)?:\/\/[^\s]+/g,
      '[conexión]',
    ),
  );
  process.exitCode = 1;
});
