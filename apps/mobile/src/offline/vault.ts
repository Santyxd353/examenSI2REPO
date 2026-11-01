import * as SecureStore from 'expo-secure-store';
import { offlineScopeKey, type OfflineScope } from './scope';

const keyName = (scope: OfflineScope) => `lumina.offline.dek.${offlineScopeKey(scope)}`;

/** Guarda únicamente el DEK activo de un ámbito; la cola SQLite se conserva. */
export async function storeActiveDek(scope: OfflineScope, dekBase64: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dekBase64)) throw new Error('El DEK no tiene formato base64.');
  await SecureStore.setItemAsync(keyName(scope), dekBase64, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export const readActiveDek = (scope: OfflineScope) => SecureStore.getItemAsync(keyName(scope));

/** Logout conservando pendientes: borra la clave activa, no la base ni la cola. */
export const lockOfflineScope = (scope: OfflineScope) => SecureStore.deleteItemAsync(keyName(scope));
