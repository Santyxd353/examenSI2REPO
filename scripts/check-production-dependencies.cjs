// Auditoría reproducible de dependencias de producción; no despliega ni modifica paquetes.
const { spawnSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');
const root = resolve(__dirname, '..'),
  output = resolve(root, '.local', 'dependency-audit');
mkdirSync(output, { recursive: true });
let failed = false;
for (const [name, cwd] of [
  ['api-web', root],
  ['android', join(root, 'apps', 'mobile')],
]) {
  const run = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--omit=dev', '--json'],
    {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  try {
    if (run.error) throw run.error;
    const report = JSON.parse(run.stdout);
    if (!report.metadata?.vulnerabilities || report.error)
      throw new Error('La auditoría no devolvió un resultado válido.');
    writeFileSync(join(output, name + '.json'), JSON.stringify(report, null, 2));
    const counts = report.metadata.vulnerabilities;
    const total =
      counts.total ??
      ['info', 'low', 'moderate', 'high', 'critical'].reduce(
        (sum, key) => sum + (counts[key] || 0),
        0,
      );
    console.log(
      name +
        ': ' +
        total +
        ' vulnerabilidades (' +
        (counts.high || 0) +
        ' altas, ' +
        (counts.critical || 0) +
        ' críticas).',
    );
    if (run.status !== 0 || total !== 0) failed = true;
  } catch (error) {
    console.error(name + ': no se pudo completar la auditoría: ' + error.message);
    failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
