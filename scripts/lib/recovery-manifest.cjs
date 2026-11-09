const { readdirSync, lstatSync, readFileSync } = require('node:fs');
const { resolve, relative, join, sep } = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function inventoryFiles(root) {
  root = resolve(root);
  const result = [];
  function visit(folder) {
    if (lstatSync(folder).isSymbolicLink()) throw new Error('No se respaldan enlaces simbólicos.');
    for (const name of readdirSync(folder).sort()) {
      const file = join(folder, name),
        stat = lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('No se respaldan enlaces simbólicos.');
      if (stat.isDirectory()) visit(file);
      else {
        if (!stat.isFile())
          throw new Error('El respaldo contiene un tipo de archivo no permitido.');
        result.push({
          path: relative(root, file).split(sep).join('/'),
          size: stat.size,
          sha256: sha256(readFileSync(file)),
        });
      }
    }
  }
  visit(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}
function verifyFiles(root, manifest) {
  assert.ok(Array.isArray(manifest), 'Manifiesto de archivos inválido.');
  const seen = new Set();
  for (const file of manifest) {
    assert.ok(
      typeof file.path === 'string' &&
        file.path.length &&
        !file.path.includes('\\') &&
        !file.path.includes(':') &&
        !file.path.startsWith('/') &&
        file.path.split('/').every((part) => part && part !== '.' && part !== '..'),
      'La ruta del respaldo no es relativa y segura.',
    );
    assert.ok(!seen.has(file.path), 'Ruta duplicada en el respaldo.');
    seen.add(file.path);
    assert.match(file.sha256 || '', /^[a-f0-9]{64}$/, 'El hash del respaldo no es válido.');
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0, 'Tamaño de archivo inválido.');
  }
  const actual = inventoryFiles(root),
    expected = [...manifest].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(
    actual.map((file) => file.path),
    expected.map((file) => file.path),
    'El conjunto de archivos no coincide.',
  );
  actual.forEach((file, index) => {
    assert.equal(file.size, expected[index].size, 'El tamaño no coincide: ' + file.path);
    assert.equal(file.sha256, expected[index].sha256, 'El hash no coincide: ' + file.path);
  });
  return true;
}
module.exports = { inventoryFiles, verifyFiles, sha256 };
