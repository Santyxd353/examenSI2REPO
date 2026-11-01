import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { openOfflineDatabase } from './db';
import { SQLiteIntentRepository } from './sqliteIntentRepository';
import type { OfflineScope } from './scope';
import { readActiveDek } from './vault';

type OfflineContextValue = Readonly<{
  scope: OfflineScope;
  locked: boolean;
  repository: Promise<SQLiteIntentRepository>;
}>;

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({ scope, children }: { scope: OfflineScope; children: ReactNode }) {
  const repository = useMemo(() => openOfflineDatabase().then((database) => new SQLiteIntentRepository(database)), []);
  const value = useMemo<OfflineContextValue>(
    () => ({ scope, locked: false, repository }),
    [scope, repository],
  );
  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOfflineStore() {
  const value = useContext(OfflineContext);
  if (!value) throw new Error('OfflineProvider es obligatorio.');
  return value;
}

export async function isOfflineScopeUnlocked(scope: OfflineScope) {
  return !!(await readActiveDek(scope));
}
