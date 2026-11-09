import assert from 'node:assert/strict';
import test from 'node:test';
import {
  demoWalletIntent,
  stripeSessionForOrder,
  stripePaymentFeedback,
  qrPaymentFeedback,
} from '../src/checkoutPayments';

test('un pedido ya preparado o cancelado muestra su estado real al volver a comprobar el pago', () => {
  assert.equal(stripePaymentFeedback({ pagado: true, estado: 'PREPARANDO' }).done, true);
  assert.match(stripePaymentFeedback({ pagado: true, estado: 'PREPARANDO' }).message, /preparando/);
  assert.match(stripePaymentFeedback({ pagado: true, estado: 'CANCELADO' }).message, /cancelado/);
  assert.equal(stripePaymentFeedback({ pagado: false, estado: 'PENDIENTE_PAGO' }).done, false);
  assert.match(qrPaymentFeedback({ numero: 'WEB-QA', estado: 'CANCELADO' }).message, /cancelado/);
  assert.equal(qrPaymentFeedback({ numero: 'WEB-QA', estado: 'PENDIENTE_PAGO' }).done, false);
});

test('reabrir el lector o repetir un QR conserva la intención de pago tras perder la respuesta', () => {
  const qr = 'LUMINA-PAY-DEMO:00000000-0000-4000-8000-000000000001:50.00:BOB';
  assert.deepEqual(demoWalletIntent(qr), demoWalletIntent('  ' + qr + '  '));
  assert.equal(demoWalletIntent(qr).idempotency, '00000000-0000-4000-8000-000000000001');
  assert.throws(() => demoWalletIntent(qr.replace(':50.00:', ':NaN:')));
  assert.throws(() => demoWalletIntent(qr + ':extra'));
});
test('una sesión Stripe se recupera del pedido persistido después de reiniciar, sin mezclar otros métodos', () => {
  assert.equal(
    stripeSessionForOrder({
      pago: [{ proveedor: 'STRIPE_TEST', referencia: 'cs_test_recuperable' }],
    }),
    'cs_test_recuperable',
  );
  assert.equal(
    stripeSessionForOrder({ pago: [{ proveedor: 'SIMULADO_APP', referencia: 'cs_test_ajeno' }] }),
    null,
  );
  assert.equal(
    stripeSessionForOrder({ pago: [{ proveedor: 'STRIPE_TEST', referencia: 'INIT:123' }] }),
    null,
  );
  assert.equal(stripeSessionForOrder(null), null);
});
