import type { VaultEnvelope } from './crypto';
import type { createOfflineAccess } from './access';
import { offlineScopeKey, type OfflineScope } from './scope';

export interface RecordCipher {
  guard(scope: OfflineScope): () => void;
  seal(scope: OfflineScope, kind: string, id: string, value: unknown): Promise<string>;
  open<T = unknown>(
    scope: OfflineScope,
    kind: string,
    id: string,
    encoded: string,
  ): Promise<{ value: T; migrated: boolean }>;
}
type Dependencies = {
  access: ReturnType<typeof createOfflineAccess>;
  digest(text: string): Promise<string>;
  keys(scope: OfflineScope): Promise<{ active: string; previous: string[] }>;
  crypto: {
    seal(value: unknown, key: string, aad: string): Promise<VaultEnvelope>;
    open<T>(value: VaultEnvelope, key: string, aad: string): Promise<T>;
  };
};
type StoredRecord = { schemaVersion: '1.0'; keyId: string; sealed: VaultEnvelope };

export function createRecordCipher(deps: Dependencies): RecordCipher {
  const aadFor = (scope: OfflineScope, kind: string, id: string) =>
    JSON.stringify(['lumina-mobile', '1.0', offlineScopeKey(scope), kind, id]);
  return {
    guard: (scope) => deps.access.guard(scope),
    async seal(scope, kind, id, value) {
      const check = deps.access.guard(scope);
      const { active } = await deps.keys(scope);
      check();
      const keyId = await deps.digest(active);
      check();
      const sealed = await deps.crypto.seal(value, active, aadFor(scope, kind, id));
      check();
      return JSON.stringify({ schemaVersion: '1.0', keyId, sealed } satisfies StoredRecord);
    },
    async open<T>(scope: OfflineScope, kind: string, id: string, encoded: string) {
      const check = deps.access.guard(scope);
      const record = JSON.parse(encoded) as StoredRecord;
      if (!record?.sealed) return { value: record as T, migrated: true };
      if (record.schemaVersion !== '1.0' || typeof record.keyId !== 'string')
        throw new Error('Formato de almacén offline no compatible.');
      const keys = await deps.keys(scope);
      check();
      for (const key of [keys.active, ...keys.previous]) {
        const idHash = await deps.digest(key);
        check();
        if (idHash !== record.keyId) continue;
        const aad = aadFor(scope, kind, id);
        if (record.sealed.aad !== aad) throw new Error('El registro pertenece a otro ámbito.');
        const value = await deps.crypto.open<T>(record.sealed, key, aad);
        check();
        return { value, migrated: key !== keys.active };
      }
      throw new Error('Falta la clave de este registro. Los datos se conservan para recuperación.');
    },
  };
}
