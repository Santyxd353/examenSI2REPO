const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const directory = resolve(__dirname, '..');
const tests = readdirSync(resolve(directory, 'test'))
  .filter((name) => name.endsWith('.test.ts'))
  .sort()
  .map((name) => resolve(directory, 'test', name));
const child = spawnSync(
  process.execPath,
  [require.resolve('tsx/cli'), '--test', '--test-concurrency=1', ...tests],
  { cwd: directory, env: process.env, stdio: 'inherit', windowsHide: true },
);
if (child.error) {
  console.error(child.error.message);
  process.exitCode = 1;
} else process.exitCode = child.status ?? 1;
