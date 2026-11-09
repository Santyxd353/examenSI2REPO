type SavedPaymentOrder = { pago: { proveedor: string; referencia?: string | null }[] };
const paidStates = new Set(['CONFIRMADO', 'PREPARANDO', 'DESPACHADO', 'ENTREGADO', 'CERRADO']);
export function stripePaymentFeedback(result: { pagado: boolean; estado: string }) {
  const state = result.estado.replaceAll('_', ' ').toLocaleLowerCase('es-BO');
  if (!result.pagado)
    return { done: false, message: 'El pago aún no aparece confirmado en Stripe.' };
  if (result.estado === 'CANCELADO')
    return {
      done: true,
      message:
        'Stripe registra el pago de prueba, pero el pedido está cancelado. Solicita su revisión en la tienda.',
    };
  return {
    done: paidStates.has(result.estado),
    message: 'Stripe confirmó el pago de prueba. Pedido ' + state + '.',
  };
}
export function qrPaymentFeedback(order: { numero: string; estado: string }) {
  const state = order.estado.replaceAll('_', ' ').toLocaleLowerCase('es-BO');
  if (order.estado === 'CANCELADO')
    return {
      done: true,
      message: 'El pedido ' + order.numero + ' está cancelado. El escaneo no realiza otro cobro.',
    };
  if (!paidStates.has(order.estado))
    return {
      done: false,
      message:
        'El pedido ' +
        order.numero +
        ' sigue ' +
        state +
        '. Comprueba su estado antes de continuar.',
    };
  return { done: true, message: 'Pago registrado: ' + order.numero + ' · pedido ' + state };
}
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
