import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { API_URL, apiBytes, captureSessionScope, assertCurrentSessionScope } from '../../api';
import { openAdminWorkspace } from '../../offline/adminWorkspace';
import { NativeOutfitCache } from './nativeOutfits';

export async function openNativeOutfitCache(signal: AbortSignal) {
  const session = captureSessionScope(),
    work = await openAdminWorkspace();
  const check = () => {
    assertCurrentSessionScope(session);
    work.check();
    if (signal.aborted) throw new Error('Descarga cancelada.');
  };
  check();
  const cache = new NativeOutfitCache(API_URL, work.scope, {
    guard: check,
    read: async (key) => {
      check();
      const row = await work.records.get(work.scope, 'outfits', key);
      check();
      return row?.value ?? null;
    },
    write: async (key, value) => {
      check();
      await work.records.put(work.scope, 'outfits', key, value);
      check();
    },
    remove: async (keys) => {
      check();
      await work.records.remove(work.scope, 'outfits', keys);
      check();
    },
    get: (path) => apiBytes(path, { signal }),
    digest: async (bytes) => {
      const result = await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes));
      check();
      return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    },
  });
  return { ...work, check, cache };
}
