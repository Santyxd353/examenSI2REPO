import assert from 'node:assert/strict';
import test from 'node:test';
import { createOfflineAccess } from '../src/offline/access';
import { createKeyVault } from '../src/offline/keyVault';

test('logout bloquea inmediatamente, espera escrituras tardías y conserva claves para recuperar pendientes', async () => {
  const access = createOfflineAccess();
  const scope = { tenantId: 'one', actorId: 'two', deviceId: 'three' };
  const records = new Map<string, string>();
  let pause: (() => Promise<void>) | null = null;
  const store = {
    get: async (key: string) => records.get(key) ?? null,
    set: async (key: string, value: string) => {
      if (pause) await pause();
      records.set(key, value);
    },
    remove: async (key: string) => {
      records.delete(key);
    },
  };
  const vault = createKeyVault(access, store);
  access.bind(scope);
  await vault.store(scope, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  await vault.store(scope, 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=');
  assert.equal((await vault.read(scope)).previous.length, 1);
  let release!: () => void;
  pause = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  const storing = vault.store(scope, 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const locking = vault.lock();
  assert.throws(() => access.guard(scope));
  release();
  await assert.rejects(storing, /bloqueado|sesión/);
  await locking;
  pause = null;
  access.bind(scope);
  await assert.rejects(vault.read(scope), /bloqueado/);
  await vault.store(scope, 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=');
  assert.equal((await vault.read(scope)).previous.length, 2);
  access.bind({ ...scope, actorId: 'other' });
  assert.throws(() => vault.read(scope));
});
