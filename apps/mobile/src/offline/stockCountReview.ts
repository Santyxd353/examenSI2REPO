import type { OfflineIntent } from './intentRepository';

export type StockCountPayload = Readonly<{
  locationId: string;
  variantId: string;
  observedPhysical: number;
  reason: string;
}>;

export function parseStockCount(payload: string): StockCountPayload | null {
  try {
    const value = JSON.parse(payload) as Partial<StockCountPayload>;
    return typeof value.locationId === 'string' && typeof value.variantId === 'string' &&
      typeof value.reason === 'string' && Number.isSafeInteger(value.observedPhysical) &&
      (value.observedPhysical ?? -1) >= 0
      ? value as StockCountPayload : null;
  } catch { return null; }
}

export function hasUnresolvedCount(intents: readonly OfflineIntent[], locationId: string, variantId: string) {
  return intents.some((item) => {
    if (item.kind !== 'STOCK_COUNT' || !['PENDING', 'SENDING', 'CONFLICT', 'BLOCKED'].includes(item.state)) return false;
    const count = parseStockCount(item.payload);
    return count?.locationId === locationId && count.variantId === variantId;
  });
}

export function countFitsReserved(observedPhysical: number, reserved: number, committed: number) {
  return Number.isSafeInteger(observedPhysical) && observedPhysical >= 0 &&
    Number.isSafeInteger(reserved) && Number.isSafeInteger(committed) &&
    observedPhysical >= reserved + committed;
}
