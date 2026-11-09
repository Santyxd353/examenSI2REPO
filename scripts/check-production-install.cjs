// Ensayo aislado del árbol Node que se conservará en la imagen; no conecta a una BD.
const { spawnSync } = require('node:child_process');
const {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { resolve, join, sep } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const parent = resolve(process.env.TEMP || tmpdir());
mkdirSync(parent, { recursive: true });
const target = mkdtempSync(join(parent, 'lumina-production-'));
const output = resolve(root, '.local', 'production-install');
mkdirSync(output, { recursive: true });
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const name of ['prisma', 'tsx'])
  assert.ok(
    manifest.dependencies[name],
    name + ' debe conservarse para las migraciones de arranque.',
  );
for (const name of ['package.json', 'package-lock.json', 'tsconfig.json'])
  copyFileSync(join(root, name), join(target, name));
for (const name of ['packages', 'prisma'])
  cpSync(join(root, name), join(target, name), {
    recursive: true,
    filter: (source) =>
      !source.split(sep).includes('node_modules') && !source.split(sep).includes('.local'),
  });
const env = {
  ...process.env,
  DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:1/no_connection',
  PLATFORM_DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:1/no_connection',
  TENANT_DATABASE_URL: 'postgresql://qa:qa@127.0.0.1:1/no_connection',
  PRISMA_HIDE_UPDATE_MESSAGE: 'true',
};
const run = (binary, args, name, shell = false) => {
  const result = spawnSync(binary, args, {
    cwd: target,
    env,
    shell,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 8 * 1024 * 1024,
  });
  writeFileSync(join(output, name + '.log'), (result.stdout || '') + (result.stderr || ''));
  if (result.error || result.status !== 0)
    throw new Error(
      name + ' falló; revisa el log local. ' + (result.error?.message || 'exit ' + result.status),
    );
  return result.stdout;
};
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const shell = process.platform === 'win32';
  run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], 'install', shell);
  for (const name of ['jest', 'ts-jest', 'vite', '@vitejs/plugin-react'])
    assert.equal(
      existsSync(join(target, 'node_modules', name)),
      false,
      name + ' quedó en producción.',
    );
  for (const name of ['prisma', 'tsx', '@prisma/client', '@lumina/contracts', '@lumina/reporting'])
    assert.ok(existsSync(join(target, 'node_modules', name)), 'Falta ' + name);
  const audit = JSON.parse(run(npm, ['audit', '--omit=dev', '--json'], 'audit', shell));
  assert.equal(audit.metadata?.vulnerabilities?.total, 0);
  run(process.execPath, ['node_modules/prisma/build/index.js', '--version'], 'prisma');
  run(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--version'], 'tsx');
  run(
    process.execPath,
    [
      '-e',
      "require('@lumina/contracts'); require('@lumina/reporting'); console.log('Paquetes compartidos disponibles.');",
    ],
    'shared',
  );
  writeFileSync(
    join(output, 'summary.json'),
    JSON.stringify(
      {
        target,
        node: process.version,
        date: new Date().toISOString(),
        audit: audit.metadata.vulnerabilities,
        tools: ['prisma', 'tsx'],
        shared: ['contracts', 'reporting'],
        devToolsAbsent: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Instalación de producción verificada: CLI y paquetes compartidos disponibles, herramientas de desarrollo ausentes, auditoría cero.',
  );
  console.log('Copia aislada: ' + target);
} catch (error) {
  console.error(error.message);
  console.error('Copia de diagnóstico conservada: ' + target);
  process.exitCode = 1;
}
