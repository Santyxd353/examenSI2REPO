export type StockSnapshot = Readonly<{ physical: number; reserved: number; committed: number; version: number }>;

export function availableStock(stock: StockSnapshot) {
  return stock.physical - stock.reserved - stock.committed;
}

export function projectDelta(stock: StockSnapshot, delta: number): StockSnapshot {
  if (!Number.isInteger(delta)) throw new Error('El ajuste debe ser un entero.');
  const next = { ...stock, physical: stock.physical + delta };
  if (availableStock(next) < 0) throw new Error('El ajuste dejaría stock disponible negativo.');
  return next;
}

export function stockCountIntent(base: StockSnapshot, observedPhysical: number) {
  if (!Number.isInteger(observedPhysical) || observedPhysical < 0) throw new Error('El conteo físico debe ser entero y no negativo.');
  return { kind: 'STOCK_COUNT' as const, baseVersion: base.version, observedPhysical };
}
