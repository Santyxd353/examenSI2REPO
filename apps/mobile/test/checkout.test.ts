import assert from 'node:assert/strict';
import test from 'node:test';
import { checkoutBlocker } from '../src/checkoutBlocker';

const availableLine = { quantity: 1, available: 3, price: 120 };

test('explica por qué confirmar una compra no puede avanzar', () => {
  assert.equal(
    checkoutBlocker({ locationSelected: false, address: 'Calle Central 123', lines: [availableLine] }),
    'Selecciona una sucursal o almacén para continuar.',
  );
  assert.equal(
    checkoutBlocker({ locationSelected: true, address: 'Calle 1', lines: [availableLine] }),
    'Escribe una dirección de entrega o retiro de al menos 10 caracteres.',
  );
  assert.equal(
    checkoutBlocker({
      locationSelected: true,
      address: 'Calle Central 123',
      lines: [{ quantity: 2, available: 1, price: 120 }],
    }),
    'La cantidad supera las existencias de esta ubicación. Ajusta el carrito.',
  );
  assert.equal(
    checkoutBlocker({
      locationSelected: true,
      address: 'Calle Central 123',
      lines: [{ quantity: 1, available: 3, price: 0 }],
    }),
    'Una prenda no tiene precio disponible. Actualiza el carrito o elige otra ubicación.',
  );
});

test('permite confirmar cuando la compra está completa', () => {
  assert.equal(
    checkoutBlocker({ locationSelected: true, address: 'Calle Central 123', lines: [availableLine] }),
    null,
  );
});
