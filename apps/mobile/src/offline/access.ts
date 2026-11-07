import { sameOfflineScope, type OfflineScope } from './scope';

/** La autorización local caduca inmediatamente al salir o cambiar de cuenta. */
export function createOfflineAccess() {
  let current: OfflineScope | null = null;
  let revision = 0;
  let stateVersion = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    stateVersion++;
    for (const listener of listeners) listener();
  };
  return {
    notify,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    stateVersion: () => stateVersion,
    bind(scope: OfflineScope) {
      if (!current || !sameOfflineScope(current, scope)) revision += 1;
      current = { ...scope };
      notify();
    },
    lock() {
      const previous = current;
      current = null;
      revision += 1;
      notify();
      return previous;
    },
    current: () => current,
    guard(scope: OfflineScope) {
      const captured = revision;
      const check = () => {
        if (captured !== revision || !current || !sameOfflineScope(current, scope))
          throw new Error('El almacén offline está bloqueado o cambió la sesión.');
      };
      check();
      return check;
    },
  };
}
export const offlineAccess = createOfflineAccess();
