import * as SecureStore from 'expo-secure-store';
import { offlineAccess } from './access';
import { createKeyVault } from './keyVault';
import type { OfflineScope } from './scope';

const vault = createKeyVault(offlineAccess, {
  get: SecureStore.getItemAsync,
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: SecureStore.deleteItemAsync,
});

/** Guarda únicamente el DEK activo de un ámbito; la cola SQLite se conserva. */
export const storeActiveDek = async (scope: OfflineScope, key: string) => {
  await vault.store(scope, key);
  offlineAccess.notify();
};
export const readOfflineKeys = vault.read;

export const readActiveDek = async (scope: OfflineScope) => (await vault.read(scope)).active;

/** Logout conservando pendientes: borra la clave activa, no la base ni la cola. */
export const lockOfflineScope = () => vault.lock();
