import type { createOfflineAccess } from './access';
import { offlineScopeKey, type OfflineScope } from './scope';
import { secureStoreKey } from '../auth/secureStoreKey';

type SecureRecords = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
export function createKeyVault(
  access: ReturnType<typeof createOfflineAccess>,
  records: SecureRecords,
) {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => {});
    return result;
  };
  const keyName = (scope: OfflineScope) =>
    secureStoreKey('lumina', 'offline', 'dek', offlineScopeKey(scope));
  const ringName = (scope: OfflineScope) =>
    secureStoreKey('lumina', 'offline', 'keyring', offlineScopeKey(scope));
  const valid = (key: string) => /^[A-Za-z0-9+/]{43}=$/.test(key);
  return {
    store(scope: OfflineScope, key: string) {
      const check = access.guard(scope);
      if (!valid(key))
        return Promise.reject(new Error('La clave offline requiere 256 bits en base64.'));
      return serial(async () => {
        check();
        const old = await records.get(keyName(scope));
        check();
        const raw = await records.get(ringName(scope));
        check();
        const previous: string[] = raw ? JSON.parse(raw) : [];
        if (
          !Array.isArray(previous) ||
          previous.some((item) => typeof item !== 'string' || !valid(item))
        )
          throw new Error('El llavero offline está dañado.');
        const all = [...new Set([...previous, ...(old ? [old] : []), key])];
        // No borrar una clave histórica: los pendientes pueden seguir cifrados con ella.
        await records.set(ringName(scope), JSON.stringify(all));
        check();
        await records.set(keyName(scope), key);
        check();
      });
    },
    read(scope: OfflineScope) {
      const check = access.guard(scope);
      return serial(async () => {
        check();
        const active = await records.get(keyName(scope));
        check();
        if (!active || !valid(active))
          throw new Error('El almacén offline está bloqueado. Conéctate e inicia sesión.');
        const raw = await records.get(ringName(scope));
        check();
        const previous: string[] = raw ? JSON.parse(raw) : [];
        if (
          !Array.isArray(previous) ||
          previous.some((key) => typeof key !== 'string' || !valid(key))
        )
          throw new Error('El llavero offline está dañado.');
        return { active, previous: previous.filter((key) => key !== active) };
      });
    },
    lock() {
      const previous = access.lock();
      return serial(async () => {
        if (previous) await records.remove(keyName(previous));
      });
    },
  };
}
