// Integración local. No publica artefactos, no ejecuta APK y no accede a una VM.
require('dotenv/config');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { mkdirSync, createWriteStream, writeFileSync, readdirSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..');
const output = resolve(process.env.SAAS_QA_OUTPUT_DIR || join(root, '.local', 'saas-integration'));
const full = process.argv.includes('--full');
const url = new URL(process.env.SAAS_QA_DATABASE_URL || process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
  throw new Error('Usa un PostgreSQL local de QA para esta verificación.');
url.pathname = '/vestidor18_test';
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  PLATFORM_DATABASE_URL: url.toString(),
  TENANT_DATABASE_URL: url.toString(),
  NODE_OPTIONS: '--max-old-space-size=768',
};
mkdirSync(output, { recursive: true });
const tests = full
  ? readdirSync(join(root, 'apps/api/test'))
      .filter((name) => name.endsWith('.test.ts'))
      .sort()
  : [
      'saas-acceptance.test.ts',
      'offline-sync.test.ts',
      'report-datasets.test.ts',
      'analytics-isolation.test.ts',
    ];
const results = [];
function run(name, args, cwd = root) {
  return new Promise((resolveRun) => {
    const log = join(output, name + '.log'),
      stream = createWriteStream(log),
      started = Date.now();
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.once('error', (error) => {
      stream.write(error.message);
    });
    child.once('close', (code) => {
      stream.end();
      const result = { name, code, elapsedMs: Date.now() - started, log };
      results.push(result);
      console.log((code === 0 ? 'PASS ' : 'FAIL ') + name);
      resolveRun(result);
    });
  });
}
(async () => {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  );
  for (const file of tests)
    await run(file, [
      'node_modules/jest/bin/jest.js',
      '--runInBand',
      '--runTestsByPath',
      'apps/api/test/' + file,
    ]);
  if (!process.argv.includes('--api-only')) {
    await run('mobile-unit', ['scripts/test-unit.cjs'], join(root, 'apps/mobile'));
    await run(
      'mobile-typecheck',
      ['node_modules/typescript/bin/tsc', '--noEmit'],
      join(root, 'apps/mobile'),
    );
  }
  const passed = results.every((result) => result.code === 0);
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        sha,
        dirty,
        full,
        createdAt: new Date().toISOString(),
        passed,
        apkExecuted: false,
        vmAccessed: false,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    passed ? 'Integración local aprobada.' : 'Hay fallos; revisa los logs de cada bloque.',
  );
  process.exitCode = passed ? 0 : 1;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
