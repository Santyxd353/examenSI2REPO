import type { OfflineIntent } from '../../offline/intentRepository';
import type { OfflineScope } from '../../offline/scope';

export type OfflineVariant = Readonly<{ id: string; talla: string; color: string; priceCents: number }>;
export type OfflineProduct = Readonly<{
  id: string; nombre: string; categoriaId: string; descripcion: string; material: string;
  marca?: string; version: number | null; archived: boolean; variants: readonly OfflineVariant[];
}>;

export type CatalogOperationState = OfflineIntent['state'] | 'CONFIRMED';
export type OfflineCatalogItem = OfflineProduct & Readonly<{ operationState: CatalogOperationState }>;

function validProduct(product: OfflineProduct) {
  if (product.nombre.trim().length < 2 || !product.categoriaId || product.material.trim().length < 2)
    throw new Error('El producto femenino requiere nombre, categoría y material.');
  if (product.descripcion.trim().length < 10)
    throw new Error('La descripción requiere al menos 10 caracteres.');
  if (!product.variants.length) throw new Error('El producto requiere al menos una variante.');
  const ids = new Set<string>();
  const combinations = new Set<string>();
  for (const variant of product.variants) {
    if (!variant.id || !variant.talla || !variant.color || !Number.isSafeInteger(variant.priceCents) || variant.priceCents < 0)
      throw new Error('Cada variante requiere UUID estable, talla, color y precio en centavos.');
    const combination = `${variant.talla.trim().toUpperCase()}\u0000${variant.color.trim().toUpperCase()}`;
    if (ids.has(variant.id) || combinations.has(combination))
      throw new Error('No repitas una variante ni una combinación de talla y color.');
    ids.add(variant.id);
    combinations.add(combination);
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

export function catalogProductFromIntent(intent: OfflineIntent): OfflineProduct | null {
  if (!intent.kind.startsWith('CATALOG_')) return null;
  try {
    const value = JSON.parse(intent.payload) as { product?: OfflineProduct };
    return value.product || null;
  } catch {
    return null;
  }
}

export function latestCatalogDependency(intents: readonly OfflineIntent[], productId: string) {
  return [...intents].reverse().find((intent) => {
    const product = catalogProductFromIntent(intent);
    return product?.id === productId && ['PENDING', 'SENDING', 'BLOCKED', 'CONFLICT'].includes(intent.state);
  });
}

export function projectCatalog(
  confirmed: readonly OfflineProduct[],
  intents: readonly OfflineIntent[],
): OfflineCatalogItem[] {
  const products = new Map<string, OfflineCatalogItem>(confirmed.map((product) => [
    product.id,
    { ...product, operationState: 'CONFIRMED' as const },
  ]));
  for (const intent of intents) {
    if (intent.state === 'REJECTED' || intent.state === 'SUPERSEDED') continue;
    const product = catalogProductFromIntent(intent);
    if (!product) continue;
    products.set(product.id, {
      ...product,
      version: intent.state === 'APPLIED' && intent.baseVersion ? intent.baseVersion : product.version,
      operationState: intent.state,
    });
  }
  return [...products.values()].sort((left, right) => left.nombre.localeCompare(right.nombre, 'es'));
}
