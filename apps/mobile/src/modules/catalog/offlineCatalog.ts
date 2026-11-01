import type { OfflineIntent } from '../../offline/intentRepository';
import type { OfflineScope } from '../../offline/scope';

export type OfflineVariant = Readonly<{ id: string; talla: string; color: string; priceCents: number }>;
export type OfflineProduct = Readonly<{
  id: string; nombre: string; categoriaId: string; descripcion: string; material: string;
  marca?: string; version: number | null; archived: boolean; variants: readonly OfflineVariant[];
}>;

function validProduct(product: OfflineProduct) {
  if (!product.nombre.trim() || !product.categoriaId || !product.material.trim()) throw new Error('El producto femenino requiere nombre, categoría y material.');
  if (!product.variants.length) throw new Error('El producto requiere al menos una variante.');
  for (const variant of product.variants) {
    if (!variant.id || !variant.talla || !variant.color || !Number.isSafeInteger(variant.priceCents) || variant.priceCents < 0)
      throw new Error('Cada variante requiere UUID estable, talla, color y precio en centavos.');
  }
}

export function catalogIntent(
  scope: OfflineScope,
  operationId: string,
  kind: 'CATALOG_CREATE' | 'CATALOG_UPDATE' | 'CATALOG_ARCHIVE',
  product: OfflineProduct,
  dependsOn: readonly string[] = [],
): OfflineIntent {
  validProduct(product);
  if (kind === 'CATALOG_CREATE' && product.version !== null) throw new Error('Una alta offline no tiene versión de servidor.');
  if (kind !== 'CATALOG_CREATE' && product.version === null && !dependsOn.length)
    throw new Error('Una edición sin versión debe depender de su alta offline.');
  return {
    operationId, scope, kind, baseVersion: kind === 'CATALOG_CREATE' || dependsOn.length ? null : product.version,
    dependsOn, state: 'PENDING', payload: JSON.stringify({ product, archived: kind === 'CATALOG_ARCHIVE' }),
  };
}

export function archiveProduct(product: OfflineProduct): OfflineProduct {
  return { ...product, archived: true };
}
