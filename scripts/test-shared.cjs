const { spawnSync } = require('node:child_process');
const { readdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
for (const name of ['contracts', 'reporting']) {
  const out = spawnSync(
    process.execPath,
    [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', `packages/${name}/tsconfig.json`],
    { cwd: root, stdio: 'inherit' },
  );
  if (out.error) throw out.error;
  if (out.status !== 0) process.exit(out.status || 1);
}
const tests = ['contracts', 'reporting'].flatMap((name) => {
  const dir = `packages/${name}/test`;
  return existsSync(resolve(root, dir))
    ? readdirSync(resolve(root, dir))
        .filter((f) => f.endsWith('.test.cjs'))
        .map((f) => `${dir}/${f}`)
    : [];
});
if (!tests.length) throw new Error('No se encontraron pruebas compartidas.');
const run = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (run.error) throw run.error;
process.exit(run.status || 0);
