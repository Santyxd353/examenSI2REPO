import {
  canonicalIntentJson,
  OfflineIntentSchema,
  UnsignedIntentSchema,
  type ApiProblem,
  type LocalState,
  type OfflineIntent,
  type OperationReceipt,
  type UnsignedIntent,
} from '@lumina/contracts';
import type { LocalAuthorization, OfflineSession } from './scope';
import { listJson, putJson, putNewWithAssets, readJson, sha256 } from './vault';

type Generated =
  | 'schemaVersion'
  | 'tenantId'
  | 'actorId'
  | 'deviceId'
  | 'operationId'
  | 'createdAt';
type Draft<T> = T extends UnsignedIntent ? Omit<T, Generated> : never;
export type IntentDraft = Draft<UnsignedIntent>;
export type QueueEntry = {
  intent: OfflineIntent;
  status: LocalState;
  receipt?: OperationReceipt;
  problem?: ApiProblem;
  reconciles?: string;
};
const key = (operationId: string) => 'queue:' + operationId;

export async function enqueueIntent(
  session: OfflineSession,
  draft: IntentDraft,
  options: { assets?: { key: string; bytes: ArrayBuffer }[]; reconciles?: string } = {},
) {
  const cached = await readJson<LocalAuthorization>(session, 'authorization');
  if (!cached) throw new Error('Primero habilita el acceso offline con conexión.');
  const { permissions, locationIds, entitlements } = cached.data;
  if (
    entitlements.readOnly ||
    (!entitlements.legacyPilot && Date.parse(entitlements.periodTo) <= Date.now())
  )
    throw new Error('Renueva la suscripción antes de preparar cambios.');
  if (draft.kind === 'STOCK_DELTA' || draft.kind === 'STOCK_COUNT') {
    if (
      !permissions.includes('inventario:gestionar') ||
      !locationIds.includes(draft.payload.locationId)
    )
      throw new Error('La ubicación no está autorizada para este dispositivo.');
  } else if (!permissions.includes('catalogo:gestionar')) {
    throw new Error('La cuenta no tiene permiso para editar catálogo.');
  }
  const unsigned = UnsignedIntentSchema.parse({
    ...draft,
    schemaVersion: '1.0',
    tenantId: session.tenantId,
    actorId: session.actorId,
    deviceId: session.deviceId,
    operationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  });
  const intent = OfflineIntentSchema.parse({
    ...unsigned,
    payloadHash: await sha256(new TextEncoder().encode(canonicalIntentJson(unsigned))),
  });
  // The intent is the durable projection input. Derive pending stock/catalog views from it
  // to avoid divergent copies of an edit after a restart or a failed storage transaction.
  await putNewWithAssets(
    session,
    key(intent.operationId),
    {
      intent,
      status: 'PENDING',
      ...(options.reconciles ? { reconciles: options.reconciles } : {}),
    } satisfies QueueEntry,
    options.assets ?? [],
  );
  return intent;
}

export async function listQueue(session: OfflineSession) {
  return (await listJson<QueueEntry>(session, 'queue:'))
    .map((row) => row.data)
    .sort(
      (a, b) =>
        a.intent.createdAt.localeCompare(b.intent.createdAt) ||
        a.intent.operationId.localeCompare(b.intent.operationId),
    );
}

export async function updateQueue(
  session: OfflineSession,
  id: string,
  change: (entry: QueueEntry) => QueueEntry | null,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readJson<QueueEntry>(session, key(id));
    if (!row) return false;
    const next = change(row.data);
    if (!next) return false;
    // Preserve the original payload and its hash on every state transition.
    if (await putJson(session, key(id), { ...next, intent: row.data.intent }, row.revision))
      return true;
  }
  throw new Error('La cola cambió en otra pestaña. Actualiza antes de continuar.');
}

export async function markSending(session: OfflineSession, ids: string[]) {
  const marked = [];
  for (const id of ids)
    if (
      await updateQueue(session, id, (entry) =>
        ['PENDING', 'BLOCKED'].includes(entry.status) && !entry.receipt
          ? { ...entry, status: 'SENDING' }
          : null,
      )
    )
      marked.push(id);
  return marked;
}

export async function recoverSending(session: OfflineSession) {
  for (const entry of await listQueue(session)) {
    if (entry.status === 'SENDING' && !entry.receipt)
      await updateQueue(session, entry.intent.operationId, (current) =>
        current.status === 'SENDING' && !current.receipt ? { ...current, status: 'PENDING' } : null,
      );
  }
}
