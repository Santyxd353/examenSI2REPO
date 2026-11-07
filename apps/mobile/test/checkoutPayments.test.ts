import assert from 'node:assert/strict';
import test from 'node:test';
import { demoWalletIntent, stripeSessionForOrder } from '../src/checkoutPayments';

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
