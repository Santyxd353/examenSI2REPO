const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { inventoryFiles, verifyFiles } = require('./lib/recovery-manifest.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'lumina-recovery-manifest-'));
  fs.mkdirSync(path.join(root, 'private'));
  fs.writeFileSync(path.join(root, 'private', 'modelo.bin'), Buffer.from([0, 255, 4, 8]));
  return root;
}
test('el manifiesto conserva rutas relativas, tamaño y hash de archivos binarios', () => {
  const root = fixture(),
    manifest = inventoryFiles(root);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].path, 'private/modelo.bin');
  assert.equal(manifest[0].size, 4);
  assert.match(manifest[0].sha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => verifyFiles(root, manifest));
});
test('rechaza bytes modificados aunque el archivo conserve su tamaño', () => {
  const root = fixture(),
    manifest = inventoryFiles(root);
  fs.writeFileSync(path.join(root, 'private', 'modelo.bin'), Buffer.from([0, 255, 4, 9]));
  assert.throws(() => verifyFiles(root, manifest), /hash/);
});
test('rechaza un respaldo incompleto o con archivos adicionales', () => {
  const root = fixture(),
    manifest = inventoryFiles(root);
  assert.throws(() => verifyFiles(root, []), /archivos/);
  assert.throws(
    () => verifyFiles(root, [...manifest, { ...manifest[0], path: 'private/falta.bin' }]),
    /archivos/,
  );
});
test('rechaza rutas externas, duplicadas y hashes inválidos antes de leerlas', () => {
  const root = fixture(),
    [file] = inventoryFiles(root);
  for (const invalid of ['../escape', '..\\escape', '/absolute', 'C:/escape', 'private/../escape'])
    assert.throws(() => verifyFiles(root, [{ ...file, path: invalid }]), /ruta/);
  assert.throws(() => verifyFiles(root, [file, file]), /duplicada/);
  assert.throws(() => verifyFiles(root, [{ ...file, sha256: 'incorrecto' }]), /hash/);
});
