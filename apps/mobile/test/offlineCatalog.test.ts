import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveProduct, catalogIntent, type OfflineProduct } from '../src/modules/catalog/offlineCatalog';

const scope = { tenantId: 'tenant-1', actorId: 'actor-1', deviceId: 'device-1' } as const;
const product: OfflineProduct = { id: 'product-1', nombre: 'Vestido Aurora', categoriaId: 'vestidos', descripcion: 'Demo', material: 'Seda', version: null, archived: false, variants: [{ id: 'variant-1', talla: 'M', color: 'AZUL', priceCents: 21900 }] };

test('alta seguida de edición conserva dependencia y no inventa versión', () => {
  const create = catalogIntent(scope, 'create-1', 'CATALOG_CREATE', product);
  const edit = catalogIntent(scope, 'edit-1', 'CATALOG_UPDATE', { ...product, nombre: 'Vestido Aurora Editado' }, [create.operationId]);
  assert.deepEqual(edit.dependsOn, ['create-1']);
  assert.equal(edit.baseVersion, null);
});

test('archivar es lógico y no duplica una eliminación física', () => {
  const archived = archiveProduct(product);
  const intent = catalogIntent(scope, 'archive-1', 'CATALOG_ARCHIVE', archived, ['create-1']);
  assert.equal(archived.archived, true);
  assert.equal(intent.kind, 'CATALOG_ARCHIVE');
});
