import { randomUUID } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { secureStoreKey } from '../auth/secureStoreKey';

const DEVICE_ID_KEY = secureStoreKey('lumina', 'offline', 'device');

export async function getOfflineDeviceId() {
  const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (existing) return existing;
  const deviceId = randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, deviceId, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return deviceId;
}
