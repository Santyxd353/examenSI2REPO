import { canonicalJson, type VaultEnvelope } from '@lumina/contracts';
import { request, withTransaction } from './database';
import { assertActive, assertSession, scopeKey, type OfflineSession } from './scope';

const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const VERSION = '1.0';
type VaultRow = {
  key: string;
  scope: string;
  resourceKey: string;
  envelope: VaultEnvelope;
  revision: string;
};
function bytesFromBase64(value: string) {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let offset = 0; offset < bytes.length; offset++) bytes[offset] = decoded.charCodeAt(offset);
  return bytes;
}
function base64(bytes: Uint8Array) {
  // A multiple of three avoids embedded padding when joining blocks.
  const pieces = [];
  for (let offset = 0; offset < bytes.length; offset += 24576)
    pieces.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
  return pieces.join('');
}
function associatedData(session: OfflineSession, resourceKey: string) {
  if (!/^[a-zA-Z0-9:._-]{1,180}$/.test(resourceKey))
    throw new Error('Identificador local inválido.');
  return canonicalJson({
    schemaVersion: VERSION,
    tenantId: session.tenantId,
    actorId: session.actorId,
    deviceId: session.deviceId,
    keyVersion: session.keyVersion,
    resourceKey,
  });
}
const primaryKey = (session: OfflineSession, resourceKey: string) =>
  scopeKey(session) + '/' + resourceKey;

export async function sha256(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function seal(
  session: OfflineSession,
  resourceKey: string,
  bytes: BufferSource,
): Promise<VaultRow> {
  const nonce = crypto.getRandomValues(new Uint8Array(12)),
    aad = associatedData(session, resourceKey);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: utf8.encode(aad),
        tagLength: 128,
      },
      session.key,
      bytes,
    ),
  );
  return {
    key: primaryKey(session, resourceKey),
    scope: scopeKey(session),
    resourceKey,
    revision: crypto.randomUUID(),
    envelope: {
      schemaVersion: VERSION,
      algorithm: 'A256GCM',
      keyVersion: session.keyVersion,
      aad,
      nonce: base64(nonce),
      ciphertext: base64(encrypted.subarray(0, -16)),
      tag: base64(encrypted.subarray(-16)),
    },
  };
}
export function sealJson(session: OfflineSession, resourceKey: string, data: unknown) {
  return seal(session, resourceKey, utf8.encode(canonicalJson(data)));
}
async function open(session: OfflineSession, resourceKey: string, row: VaultRow) {
  const aad = associatedData(session, resourceKey),
    envelope = row.envelope;
  if (
    row.key !== primaryKey(session, resourceKey) ||
    envelope.schemaVersion !== VERSION ||
    envelope.algorithm !== 'A256GCM' ||
    envelope.keyVersion !== session.keyVersion ||
    envelope.aad !== aad
  )
    throw new Error('El registro pertenece a otra copia local.');
  const nonce = bytesFromBase64(envelope.nonce),
    ciphertext = bytesFromBase64(envelope.ciphertext),
    tag = bytesFromBase64(envelope.tag);
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('El archivo cifrado está dañado.');
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: utf8.encode(aad), tagLength: 128 },
    session.key,
    combined,
  );
}

async function put(session: OfflineSession, row: VaultRow, expected?: string | null) {
  return withTransaction(['sessions', 'vault'], 'readwrite', async ({ sessions, vault }) => {
    await assertSession(sessions, session);
    if (expected !== undefined) {
      const previous = (await request(vault.get(row.key))) as VaultRow | undefined;
      if ((previous?.revision ?? null) !== expected) return false;
    }
    await request(vault.put(row));
    return true;
  });
}

export async function putJson(
  session: OfflineSession,
  resourceKey: string,
  data: unknown,
  expected?: string | null,
) {
  return put(session, await sealJson(session, resourceKey, data), expected);
}
export async function putBytes(session: OfflineSession, resourceKey: string, bytes: ArrayBuffer) {
  return put(session, await seal(session, resourceKey, bytes));
}
export async function putNewWithAssets(
  session: OfflineSession,
  resourceKey: string,
  data: unknown,
  assets: { key: string; bytes: ArrayBuffer }[],
) {
  const rows = await Promise.all([
    sealJson(session, resourceKey, data),
    ...assets.map((asset) => seal(session, asset.key, asset.bytes)),
  ]);
  await withTransaction(['sessions', 'vault'], 'readwrite', async ({ sessions, vault }) => {
    await assertSession(sessions, session);
    for (const row of rows) await request(vault.add(row));
  });
}
export async function readBytes(session: OfflineSession, resourceKey: string) {
  const row = await withTransaction(
    ['sessions', 'vault'],
    'readonly',
    async ({ sessions, vault }) => {
      await assertSession(sessions, session);
      return (await request(vault.get(primaryKey(session, resourceKey)))) as VaultRow | undefined;
    },
  );
  if (!row) return null;
  const bytes = await open(session, resourceKey, row);
  await assertActive(session);
  return { bytes, revision: row.revision };
}
export async function readJson<T>(session: OfflineSession, resourceKey: string) {
  const row = await readBytes(session, resourceKey);
  return row && { data: JSON.parse(decoder.decode(row.bytes)) as T, revision: row.revision };
}
export async function listJson<T>(session: OfflineSession, prefix: string) {
  const rows = await withTransaction(
    ['sessions', 'vault'],
    'readonly',
    async ({ sessions, vault }) => {
      await assertSession(sessions, session);
      const start = primaryKey(session, prefix);
      return (await request(
        vault.getAll(IDBKeyRange.bound(start, start + '\uffff')),
      )) as VaultRow[];
    },
  );
  const results = [];
  for (const row of rows) {
    const bytes = await open(session, row.resourceKey, row);
    results.push({ data: JSON.parse(decoder.decode(bytes)) as T, revision: row.revision });
  }
  await assertActive(session);
  return results;
}
export async function removeLocal(session: OfflineSession, resourceKeys: string[]) {
  await withTransaction(['sessions', 'vault'], 'readwrite', async ({ sessions, vault }) => {
    await assertSession(sessions, session);
    for (const resourceKey of resourceKeys)
      await request(vault.delete(primaryKey(session, resourceKey)));
  });
}
