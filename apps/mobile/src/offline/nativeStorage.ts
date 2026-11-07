import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { offlineAccess } from './access';
import { sealJson, openJson } from './crypto';
import { createRecordCipher } from './recordCipher';
import { readOfflineKeys } from './vault';
import { SQLiteIntentRepository } from './sqliteIntentRepository';
import { PrivateRecords } from './privateRecords';

export const sha256 = (text: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, text);
export const nativeRecordCipher = createRecordCipher({
  access: offlineAccess,
  digest: sha256,
  keys: readOfflineKeys,
  crypto: { seal: sealJson, open: openJson },
});
export const createIntentRepository = (database: SQLiteDatabase) =>
  new SQLiteIntentRepository(database, nativeRecordCipher, sha256);
export const createPrivateRecords = (database: SQLiteDatabase) =>
  new PrivateRecords(database, nativeRecordCipher);
