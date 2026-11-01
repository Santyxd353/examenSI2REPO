import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiProblem } from '../src/errors/ApiProblem';

test('conserva status, code, correlación y política de reintento', () => {
  const problem = ApiProblem.fromHttp(409, {
    code: 'STOCK_VERSION_CONFLICT',
    message: 'El inventario cambió.',
    correlationId: 'corr-123',
  });
  assert.equal(problem.status, 409);
  assert.equal(problem.code, 'STOCK_VERSION_CONFLICT');
  assert.equal(problem.correlationId, 'corr-123');
  assert.equal(problem.retryable, false);
});

test('un error de red no se presenta como una respuesta correcta', () => {
  const problem = ApiProblem.network(new TypeError('Network request failed'));
  assert.equal(problem.code, 'NETWORK_UNAVAILABLE');
  assert.equal(problem.retryable, true);
  assert.equal(problem.status, 0);
});
