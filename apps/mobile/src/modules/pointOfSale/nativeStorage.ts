import { randomUUID } from 'expo-crypto';
import { api, captureSessionScope, assertCurrentSessionScope } from '../../api';
import { openAdminWorkspace } from '../../offline/adminWorkspace';
import { PointOfSaleWorkflow, type StoredSale } from './workflow';
export async function openPointOfSale(signal: AbortSignal) {
  const session = captureSessionScope(),
    workspace = await openAdminWorkspace();
  const guard = () => {
    assertCurrentSessionScope(session);
    workspace.check();
    if (signal.aborted) throw new Error('Operación cancelada.');
  };
  guard();
  const workflow = new PointOfSaleWorkflow({
    guard,
    uuid: randomUUID,
    read: async () => {
      guard();
      const pointer = await workspace.records.get<{ id: string }>(
        workspace.scope,
        'sales-intents',
        'current',
      );
      guard();
      if (!pointer) return null;
      const record = await workspace.records.get<StoredSale>(
        workspace.scope,
        'sales-intents',
        pointer.value.id,
      );
      guard();
      if (!record)
        throw new Error(
          'No se pudo recuperar la venta pendiente. Conserva los datos para revisión.',
        );
      return record.value;
    },
    save: async (value) => {
      guard();
      await workspace.records.put(workspace.scope, 'sales-intents', value.id, value);
      guard();
      await workspace.records.put(workspace.scope, 'sales-intents', 'current', { id: value.id });
      guard();
    },
    clear: async () => {
      guard();
      await workspace.records.remove(workspace.scope, 'sales-intents', ['current']);
      guard();
    },
    send: (body) => api('/sales', { method: 'POST', body: JSON.stringify(body), signal }),
  });
  return { workflow, guard };
}
