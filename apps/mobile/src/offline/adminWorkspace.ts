import {
  BootstrapResponseSchema,
  SnapshotDocumentSchema,
  type SnapshotDocument,
} from '@lumina/contracts';
import { api, captureSessionScope, assertCurrentSessionScope } from '../api';
import { offlineAccess } from './access';
import { openOfflineDatabase } from './db';
import { createPrivateRecords, createIntentRepository, sha256 } from './nativeStorage';
import { readSnapshotPages } from './snapshotDownload';

export async function openAdminWorkspace() {
  const scope = offlineAccess.current();
  if (!scope) throw new Error('Inicia sesión y prepara el modo offline.');
  const check = offlineAccess.guard(scope),
    database = await openOfflineDatabase();
  check();
  const records = createPrivateRecords(database),
    repository = createIntentRepository(database);
  return { scope, check, records, repository };
}
export async function refreshAdminSnapshot() {
  const session = captureSessionScope(),
    workspace = await openAdminWorkspace();
  const check = () => {
    assertCurrentSessionScope(session);
    workspace.check();
  };
  const snapshot = await readSnapshotPages(workspace.scope, {
    digest: sha256,
    guard: check,
    get: (cursor) =>
      api<unknown>(
        '/offline/snapshot?deviceId=' +
          workspace.scope.deviceId +
          (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''),
      ),
  });
  check();
  await workspace.records.put(workspace.scope, 'catalog-snapshot', 'current', snapshot);
  check();
  return snapshot;
}
export async function readAdminSnapshot(): Promise<SnapshotDocument | null> {
  const { scope, records, check } = await openAdminWorkspace();
  const saved = await records.get(scope, 'catalog-snapshot', 'current');
  check();
  return saved ? SnapshotDocumentSchema.parse(saved.value) : null;
}
export async function requireOfflinePermission(permission: string) {
  const workspace = await openAdminWorkspace();
  const saved = await workspace.records.get(workspace.scope, 'bootstrap', 'current');
  workspace.check();
  if (!saved) throw new Error('Conéctate para preparar el almacén offline antes de editar.');
  const bootstrap = BootstrapResponseSchema.parse(saved.value);
  if (!bootstrap.permissions.includes(permission))
    throw new Error('Tu cuenta no tiene permiso para esta operación.');
  if (
    bootstrap.entitlements.readOnly ||
    !['ACTIVE', 'TRIAL'].includes(bootstrap.entitlements.status) ||
    Date.now() >= Date.parse(bootstrap.entitlements.periodTo)
  )
    throw new Error('El plan está en solo lectura. Conéctate para actualizarlo.');
  return workspace;
}
