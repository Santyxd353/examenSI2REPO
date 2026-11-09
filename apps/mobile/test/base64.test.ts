import assert from 'node:assert/strict';
import test from 'node:test';
import { combineBase64, decodeBase64, splitAesCombined } from '../src/offline/base64';

test('reconstruye el sobre AES anterior sin perder bytes entre segmentos base64', () => {
  assert.equal(combineBase64(['AQ==', 'Ag==', 'Aw==']), 'AQID');
  assert.equal(combineBase64(['/w==', 'AAE=']), '/wAB');
  assert.equal(combineBase64(['AQID', 'BA==']), 'AQIDBA==');
  assert.deepEqual(Array.from(decodeBase64('/wAB')), [255, 0, 1]);
});

test('rechaza un segmento cifrado con caracteres inválidos', () => {
  assert.throws(() => combineBase64(['AQ$=']), /base64 inválido/);
  assert.throws(() => combineBase64(['AQ==', undefined]), /Falta el segmento AES 2/);
});

test('guardar el sobre combinado conserva el formato anterior de nonce, contenido y tag', () => {
  const bytes = Uint8Array.from({ length: 37 }, (_, i) => i);
  const combined = Buffer.from(bytes).toString('base64');
  const parts = splitAesCombined(combined);
  assert.deepEqual(Array.from(decodeBase64(parts.nonce)), Array.from(bytes.slice(0, 12)));
  assert.deepEqual(Array.from(decodeBase64(parts.ciphertext)), Array.from(bytes.slice(12, -16)));
  assert.deepEqual(Array.from(decodeBase64(parts.tag)), Array.from(bytes.slice(-16)));
  assert.equal(combineBase64([parts.nonce, parts.ciphertext, parts.tag]), combined);
  assert.throws(() => splitAesCombined('AQID'), /AES/);
});
