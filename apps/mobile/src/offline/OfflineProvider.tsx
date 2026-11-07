import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { openOfflineDatabase } from './db';
import { SQLiteIntentRepository } from './sqliteIntentRepository';
import { createIntentRepository } from './nativeStorage';
import type { OfflineScope } from './scope';
import { readActiveDek } from './vault';
import { offlineAccess } from './access';

type OfflineContextValue = Readonly<{
  scope: OfflineScope;
  locked: boolean;
  repository: Promise<SQLiteIntentRepository>;
}>;

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ scope, children }: { scope: OfflineScope; children: ReactNode }) {
  const repository = useMemo(() => openOfflineDatabase().then(createIntentRepository), []);
  const version = useSyncExternalStore(offlineAccess.subscribe, offlineAccess.stateVersion);
  const [locked, setLocked] = useState(true);
  useEffect(() => {
    let active = true;
    setLocked(true);
    void isOfflineScopeUnlocked(scope).then((unlocked) => {
      if (active) setLocked(!unlocked);
    });
    return () => {
      active = false;
    };
  }, [scope, version]);
  const value = useMemo<OfflineContextValue>(
    () => ({ scope, locked, repository }),
    [scope, locked, repository],
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOfflineStore() {
  const value = useContext(OfflineContext);
  if (!value) throw new Error('OfflineProvider es obligatorio.');
  return value;
}

export async function isOfflineScopeUnlocked(scope: OfflineScope) {
  try {
    return !!(await readActiveDek(scope));
  } catch {
    return false;
  }
}
