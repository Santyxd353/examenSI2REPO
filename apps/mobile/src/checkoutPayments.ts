type SavedPaymentOrder = { pago: { proveedor: string; referencia?: string | null }[] };
export function stripeSessionForOrder(order: SavedPaymentOrder | null) {
  const payment = order?.pago.find((row) => row.proveedor === 'STRIPE_TEST');
  return /^cs_test_[A-Za-z0-9_]{1,120}$/.test(payment?.referencia ?? '')
    ? payment!.referencia!
    : null;
}
/** El UUID del pedido identifica el escaneo incluso tras cerrar la aplicación. */
export function demoWalletIntent(raw: string) {
  const qr = raw.trim(),
    [kind, order, amount, currency, ...extra] = qr.split(':');
  if (
    kind !== 'LUMINA-PAY-DEMO' ||
    currency !== 'BOB' ||
    extra.length ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      order ?? '',
    ) ||
    !/^\d+(?:\.\d{2})?$/.test(amount ?? '')
  )
    throw new Error('Escanea un QR de pago de demostración de Lúmina.');
  return { qr, idempotency: order!.toLowerCase() };
}
