import type { SnapshotDocument, SnapshotEntity } from '@lumina/contracts';
import type { OfflineIntent } from './intentRepository';

/** El corte confirmado permanece intacto; se proyectan pendientes y recibos posteriores al corte. */
export function projectAdminEntities(
  snapshot: SnapshotDocument,
  intents: readonly OfflineIntent[],
): SnapshotEntity[] {
  const rows = new Map(snapshot.entities.map((row) => [row.kind + ':' + row.id, row]));
  for (const item of intents) {
    if (!['PENDING', 'SENDING', 'APPLIED'].includes(item.state)) continue;
    if (item.state === 'APPLIED' && (!item.confirmedAt || item.confirmedAt <= snapshot.asOf))
      continue;
    const wire = JSON.parse(item.payload),
      key = (kind: string) => kind + ':' + wire.entityId;
    if (wire.kind === 'STOCK_DELTA' || wire.kind === 'STOCK_COUNT') {
      const previous = rows.get(key('STOCK'));
      const stock =
        previous?.kind === 'STOCK'
          ? previous
          : {
              kind: 'STOCK' as const,
              id: wire.entityId,
              version: 1,
              variantId: wire.payload.variantId,
              locationId: wire.payload.locationId,
              physical: 0,
              reserved: 0,
              committed: 0,
              available: 0,
            };
      const physical =
        wire.kind === 'STOCK_DELTA'
          ? stock.physical + wire.payload.deltaFisico
          : wire.payload.observedPhysical;
      rows.set(key('STOCK'), {
        ...stock,
        physical,
        available: physical - stock.reserved - stock.committed,
        version: item.confirmedVersion ?? stock.version,
      });
    } else if (wire.kind === 'CATALOG_ARCHIVE') {
      const previous = rows.get(key('PRODUCT'));
      if (previous?.kind === 'PRODUCT')
        rows.set(key('PRODUCT'), { ...previous, state: 'RETIRADO' });
    } else if (wire.kind === 'CATALOG_CREATE' || wire.kind === 'CATALOG_UPDATE') {
      const fields = wire.kind === 'CATALOG_CREATE' ? wire.payload.product : wire.payload.patch;
      const prior = rows.get(key('PRODUCT'));
      if (wire.kind === 'CATALOG_UPDATE' && prior?.kind !== 'PRODUCT') continue;
      const product =
        prior?.kind === 'PRODUCT'
          ? prior
          : {
              kind: 'PRODUCT' as const,
              id: wire.entityId,
              version: 1,
              name: '',
              description: '',
              material: '',
              brand: null,
              collection: null,
              categoryId: '',
              state: 'BORRADOR' as const,
            };
      rows.set(key('PRODUCT'), {
        ...product,
        name: fields.nombre ?? product.name,
        description: fields.descripcion ?? product.description,
        material: fields.material ?? product.material,
        brand: fields.marca ?? product.brand,
        collection: fields.coleccion ?? product.collection,
        categoryId: fields.categoriaId ?? product.categoryId,
        state: fields.estado ?? product.state,
        version: item.confirmedVersion ?? product.version,
      });
      for (const variant of fields.variants ?? []) {
        rows.set('VARIANT:' + variant.id, {
          kind: 'VARIANT',
          id: variant.id,
          version: variant.baseVersion ?? 1,
          productId: wire.entityId,
          sku: variant.sku,
          barcode: variant.barcode ?? null,
          size: variant.talla,
          color: variant.color,
          colorHex: variant.colorHex ?? null,
          active: variant.active,
          prices: (['WEB', 'APP', 'TIENDA'] as const).map((channel) => ({
            channel,
            baseMinor: variant.prices[channel],
            discountBasisPoints: variant.discounts?.[channel]?.basisPoints ?? 0,
            startsAt: variant.discounts?.[channel]?.startsAt ?? wire.createdAt,
            endsAt: variant.discounts?.[channel]?.endsAt ?? null,
          })),
        });
      }
    }
  }
  return [...rows.values()];
}
