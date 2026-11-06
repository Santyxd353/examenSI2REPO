import {
  canonicalJson,
  OutfitManifestSchema,
  SnapshotDocumentSchema,
  SnapshotPageSchema,
  type DownloadStatus,
  type OutfitManifest,
  type SnapshotEntity,
} from '@lumina/contracts';
import { assertActive, type OfflineSession } from './scope';
import { sessionResponse } from './session';
import { listJson, putBytes, putJson, readBytes, removeLocal, sha256 } from './vault';
const digest = (value: unknown) => sha256(new TextEncoder().encode(canonicalJson(value)));
const packageKey = (id: string) => 'package:' + id;
const assetKey = (pkg: string, id: string) => 'asset:' + pkg + ':' + id;
const checkManifest = (session: OfflineSession, raw: unknown) => {
  const manifest = OutfitManifestSchema.parse(raw);
  if (
    manifest.tenantId !== session.tenantId ||
    manifest.ownerId !== session.actorId ||
    manifest.platform !== 'WEB_3D'
  )
    throw new Error('El paquete no corresponde a esta cuenta y plataforma.');
  return manifest;
};

export async function downloadSnapshot(session: OfflineSession, signal?: AbortSignal) {
  const base = '/api/offline/snapshot?deviceId=' + session.deviceId;
  const first = SnapshotPageSchema.parse(
    await (await sessionResponse(session, base, { signal })).json(),
  );
  const {
    entities: _rows,
    nextCursor: _cursor,
    offset: _offset,
    pageSize: _pageSize,
    pageHash: _pageHash,
    sha256: expectedHash,
    ...metadata
  } = first;
  const { scope } = metadata;
  if (
    scope.tenantId !== session.tenantId ||
    scope.actorId !== session.actorId ||
    scope.deviceId !== session.deviceId ||
    scope.channel !== 'WEB'
  )
    throw new Error('El corte pertenece a otro ámbito.');
  const entities: SnapshotEntity[] = [];
  let page = first;
  do {
    const {
      entities: rows,
      nextCursor,
      offset,
      pageSize,
      pageHash,
      sha256: wholeHash,
      ...headers
    } = page;
    if (
      offset !== entities.length ||
      pageSize !== first.pageSize ||
      wholeHash !== expectedHash ||
      canonicalJson(headers) !== canonicalJson(metadata) ||
      (await digest(rows)) !== pageHash ||
      entities.length + rows.length > metadata.coverage.rowCount ||
      (nextCursor && !rows.length)
    )
      throw new Error('El corte de catálogo está incompleto o cambió durante la descarga.');
    entities.push(...rows);
    if (!nextCursor) break;
    page = SnapshotPageSchema.parse(
      await (
        await sessionResponse(session, base + '&cursor=' + encodeURIComponent(nextCursor), {
          signal,
        })
      ).json(),
    );
  } while (true);
  const document = SnapshotDocumentSchema.parse({ ...metadata, entities });
  if (entities.length !== metadata.coverage.rowCount || (await digest(document)) !== expectedHash)
    throw new Error('La verificación del corte no coincide.');
  signal?.throwIfAborted();
  await putJson(session, 'snapshot', document);
  return document;
}

type ManifestAsset = { id: string; sha256: string; bytes: number; url: string; garment: boolean };
const resources = (manifest: OutfitManifest): ManifestAsset[] => [
  ...manifest.garments.map((item) => ({
    id: item.resourceId,
    sha256: item.sha256,
    bytes: item.bytes,
    url: item.privateDownloadUrl,
    garment: true,
  })),
  ...(manifest.optionalOwnAvatar
    ? [
        {
          id: manifest.optionalOwnAvatar.avatarId,
          sha256: manifest.optionalOwnAvatar.sha256,
          bytes: manifest.optionalOwnAvatar.bytes,
          url: manifest.optionalOwnAvatar.privateDownloadUrl,
          garment: false,
        },
      ]
    : []),
];
export async function verifiedAsset(session: OfflineSession, manifest: OutfitManifest, id: string) {
  const expected = resources(checkManifest(session, manifest)).find((asset) => asset.id === id);
  if (!expected) throw new Error('El recurso no pertenece al paquete.');
  const record = await readBytes(session, assetKey(manifest.packageId, id));
  if (
    !record ||
    record.bytes.byteLength !== expected.bytes ||
    (await sha256(record.bytes)) !== expected.sha256
  )
    throw new Error('El archivo local falta o está dañado.');
  await assertActive(session);
  return record.bytes;
}
export type LocalPackage = { manifest: OutfitManifest; status: DownloadStatus; failure?: string };
export async function listPackages(session: OfflineSession) {
  return (await listJson<LocalPackage>(session, 'package:'))
    .map((row) => row.data)
    .sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt));
}

export async function newPackage(
  session: OfflineSession,
  includeOwnAvatar: boolean,
  signal?: AbortSignal,
) {
  const response = await sessionResponse(session, '/api/offline/outfits', {
    method: 'POST',
    body: JSON.stringify({ deviceId: session.deviceId, platform: 'WEB_3D', includeOwnAvatar }),
    signal,
  });
  return checkManifest(session, await response.json());
}

export async function downloadPackage(
  session: OfflineSession,
  raw: OutfitManifest,
  notify: (progress: LocalPackage) => void,
  signal?: AbortSignal,
) {
  const manifest = checkManifest(session, raw),
    assets = resources(manifest);
  const status: DownloadStatus = {
    packageId: manifest.packageId,
    state: 'DOWNLOADING',
    bytesVerified: 0,
    bytesExpected: assets.reduce((total, asset) => total + asset.bytes, 0),
    readyItems: 0,
    expectedItems: manifest.garmentCount,
  };
  let failure: string | undefined;
  async function save() {
    const value = { manifest, status: { ...status }, ...(failure ? { failure } : {}) };
    signal?.throwIfAborted();
    await putJson(session, packageKey(manifest.packageId), value);
    notify(value);
    return value;
  }
  await save();
  for (const asset of assets) {
    signal?.throwIfAborted();
    try {
      await verifiedAsset(session, manifest, asset.id).catch(async () => {
        const path = new URL(asset.url, window.location.origin);
        if (
          path.origin !== window.location.origin ||
          path.pathname !== `/api/offline/outfits/${manifest.packageId}/files/${asset.id}` ||
          path.searchParams.get('deviceId') !== session.deviceId
        )
          throw new Error('El vínculo del archivo no coincide con este dispositivo.');
        const response = await sessionResponse(session, asset.url, { signal });
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== asset.bytes || (await sha256(bytes)) !== asset.sha256)
          throw new Error('La huella del archivo no coincide. Vuelve a descargarlo.');
        signal?.throwIfAborted();
        await putBytes(session, assetKey(manifest.packageId, asset.id), bytes);
      });
      status.bytesVerified += asset.bytes;
      if (asset.garment) status.readyItems++;
    } catch (error) {
      signal?.throwIfAborted();
      await assertActive(session);
      failure =
        (error as Error).name === 'QuotaExceededError'
          ? 'No hay espacio suficiente. Libera espacio y reintenta.'
          : (error as Error).message;
    }
    await save();
  }
  status.state =
    !failure && manifest.garmentCount > 0 && manifest.state === 'COMPLETO' ? 'READY' : 'PARTIAL';
  return save();
}

export async function deletePackage(session: OfflineSession, manifest: OutfitManifest) {
  checkManifest(session, manifest);
  await removeLocal(session, [
    packageKey(manifest.packageId),
    ...resources(manifest).map((asset) => assetKey(manifest.packageId, asset.id)),
  ]);
}

export async function revalidateAvatars(session: OfflineSession, signal?: AbortSignal) {
  const packages = (await listPackages(session)).filter(
    (saved) => saved.manifest.optionalOwnAvatar,
  );
  if (!packages.length) return;
  const payload = (await (await sessionResponse(session, '/api/avatars', { signal })).json()) as {
    avatars: { id: string; version: number; estado: string }[];
  };
  for (const saved of packages) {
    const avatar = saved.manifest.optionalOwnAvatar!;
    if (
      payload.avatars.some(
        (row) =>
          row.id === avatar.avatarId && row.version === avatar.version && row.estado === 'APROBADO',
      )
    )
      continue;
    const existing = await readBytes(
      session,
      assetKey(saved.manifest.packageId, avatar.avatarId),
    ).catch(() => null);
    await removeLocal(session, [assetKey(saved.manifest.packageId, avatar.avatarId)]);
    const manifest = { ...saved.manifest, optionalOwnAvatar: null };
    const status = {
      ...saved.status,
      bytesExpected: saved.status.bytesExpected - avatar.bytes,
      bytesVerified: Math.max(0, saved.status.bytesVerified - (existing ? avatar.bytes : 0)),
    };
    await putJson(session, packageKey(manifest.packageId), { ...saved, manifest, status });
  }
}
