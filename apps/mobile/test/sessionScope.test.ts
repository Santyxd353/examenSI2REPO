import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionScope } from '../src/auth/sessionScope';

test('una respuesta de una tienda o época anterior no puede aplicarse', () => {
  const scope = createSessionScope('lumina');
  const request = scope.capture();
  scope.switchTenant('otra-tienda');

  assert.equal(scope.isCurrent(request), false);
  assert.throws(() => scope.assertCurrent(request), /cambió/);
  assert.equal(scope.isCurrent(scope.capture()), true);
});

test('revocar una sesión invalida incluso peticiones de la misma tienda', () => {
  const scope = createSessionScope('lumina');
  const request = scope.capture();
  scope.invalidate();
  assert.equal(scope.isCurrent(request), false);
});
