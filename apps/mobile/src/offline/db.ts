import * as SQLite from 'expo-sqlite';
import { migrateOfflineDatabase } from './migrations';

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function openOfflineDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('lumina-offline.db').then(async (database) => {
      await migrateOfflineDatabase(database);
      return database;
    });
  }
  return databasePromise;
}
