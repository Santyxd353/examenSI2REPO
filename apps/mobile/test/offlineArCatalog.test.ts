import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_OFFLINE_AR_GARMENTS, planOfflineArDownloads } from '../src/modules/catalog/offlineArCatalog';

const checksum = 'a'.repeat(64);
const resource = (id: string, variantId = id) => ({
  id,
  variantId,
  estado: 'PUBLICADO' as const,
  imagePath: `/stores/lumina/assets/catalog-ar/${id}.png`,
  checksum,
});

test('prepara como máximo diez prendas AR publicadas, sin repetir variante ni caché', () => {
  const resources = Array.from({ length: 12 }, (_, index) => resource(String(index + 1)));
  const plan = planOfflineArDownloads('https://api.example.test/api', resources, new Set(['1']));
  assert.equal(plan.length, MAX_OFFLINE_AR_GARMENTS);
  assert.equal(plan[0]?.resourceId, '2');
  assert.equal(plan[0]?.sourceUrl, 'https://api.example.test/stores/lumina/assets/catalog-ar/2.png');
  assert.equal(
    planOfflineArDownloads('https://api.example.test/api', [{ ...resource('default'), imagePath: '/assets/catalog-ar/default.png' }], new Set()).length,
    1,
  );
  assert.equal(planOfflineArDownloads('https://api.example.test/api', [resource('new', 'v'), resource('old', 'v')], new Set()).length, 1);
});

test('no permite descargar recursos fuera del origen y la ruta pública de la tienda', () => {
  assert.throws(
    () => planOfflineArDownloads('https://api.example.test/api', [{ ...resource('bad'), imagePath: 'https://otro.example/asset.png' }], new Set()),
    /pertenecer/,
  );
});
