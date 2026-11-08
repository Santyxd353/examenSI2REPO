import assert from 'node:assert/strict';
import test from 'node:test';
import { combineBase64, decodeBase64 } from '../src/offline/base64';

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
