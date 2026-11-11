// Use a separate, short checkout on the same Windows volume without duplicating dependency bytes.
// Generated native build directories are excluded so the source checkout is not modified by a build.
const fs = require('node:fs');
const path = require('node:path');
const [source, destination] = process.argv.slice(2).map((value) => path.resolve(value));
if (!source || !destination || source === destination)
  throw new Error('Provide distinct source and destination checkouts.');
if (!fs.existsSync(path.join(destination, '.git')))
  throw new Error('Destination must already be a Git checkout.');
let links = 0;
function mirror(from, to, relative = '') {
  const stat = fs.lstatSync(from);
  if (stat.isSymbolicLink()) {
    const target = fs.realpathSync(from);
    const relocated = target.toLowerCase().startsWith(source.toLowerCase() + path.sep)
      ? path.join(destination, path.relative(source, target))
      : target;
    if (!fs.existsSync(to))
      fs.symlinkSync(relocated, to, fs.statSync(from).isDirectory() ? 'junction' : 'file');
    return;
  }
  if (stat.isDirectory()) {
    const name = path.basename(from);
    if (['.gradle', '.cxx', '.cache', '.externalNativeBuild'].includes(name)) return;
    if (
      name === 'build' &&
      ['build.gradle', 'build.gradle.kts'].some((file) =>
        fs.existsSync(path.join(path.dirname(from), file)),
      )
    )
      return;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from))
      mirror(path.join(from, entry), path.join(to, entry), path.join(relative, entry));
  } else if (stat.isFile() && !fs.existsSync(to)) {
    fs.linkSync(from, to);
    links++;
  }
}
for (const relative of [
  'node_modules',
  'apps/mobile/node_modules',
  'packages/contracts/dist',
  'packages/reporting/dist',
]) {
  const from = path.join(source, relative);
  if (!fs.existsSync(from)) throw new Error('Missing prepared dependencies: ' + relative);
  mirror(from, path.join(destination, relative));
}
console.log(
  `Prepared ${links} dependency hard links in ${destination}; native build caches were excluded.`,
);
