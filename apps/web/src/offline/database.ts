type Store = 'settings' | 'sessions' | 'vault';
type Stores = Record<Store, IDBObjectStore>;
let opening: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lumina-private-vault', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('sessions', { keyPath: 'slug' });
      db.createObjectStore('vault', { keyPath: 'key' }).createIndex('scope', 'scope');
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        opening = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

export function request<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Only await IDB requests inside work. Compute hashes and encrypt before opening a write transaction.
export async function withTransaction<K extends Store, T>(
  names: K[],
  mode: IDBTransactionMode,
  work: (stores: Pick<Stores, K>) => Promise<T>,
) {
  const db = await openDatabase();
  const transaction = db.transaction(
    names,
    mode,
    mode === 'readwrite' ? { durability: 'strict' } : undefined,
  );
  const committed = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('El almacenamiento local canceló el cambio.'));
  });
  const stores = Object.fromEntries(
    names.map((name) => [name, transaction.objectStore(name)]),
  ) as Pick<Stores, K>;
  try {
    const value = await work(stores);
    await committed;
    return value;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* It may already have aborted. */
    }
    await committed.catch(() => {});
    throw error;
  }
}
