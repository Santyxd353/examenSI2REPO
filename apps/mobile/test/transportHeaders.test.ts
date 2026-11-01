import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiHeaders } from '../src/transport/headers';

const scope = { tenantSlug: 'lumina', epoch: 1 } as const;

test('FormData no recibe Content-Type JSON ni boundary manual', () => {
  const data = new FormData();
  data.append('photo', new Blob(['avatar']), 'avatar.jpg');
  const headers = createApiHeaders({ 'Content-Type': 'application/json' }, scope, 'token', data);
  assert.equal(headers.has('Content-Type'), false);
  assert.equal(headers.get('X-Client-Channel'), 'APP');
});

test('un cuerpo JSON conserva Content-Type', () => {
  const headers = createApiHeaders(undefined, scope, '', JSON.stringify({ ok: true }));
  assert.equal(headers.get('Content-Type'), 'application/json');
});
