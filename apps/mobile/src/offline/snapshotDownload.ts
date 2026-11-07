import {
  canonicalJson,
  SnapshotPageSchema,
  SnapshotDocumentSchema,
  type SnapshotEntity,
} from '@lumina/contracts';
import type { OfflineScope } from './scope';

export async function readSnapshotPages(
  scope: OfflineScope,
  deps: {
    get(cursor: string | null): Promise<unknown>;
    digest(text: string): Promise<string>;
    guard(): void;
  },
) {
  deps.guard();
  const first = SnapshotPageSchema.parse(await deps.get(null));
  deps.guard();
  const {
    entities: _entities,
    nextCursor: _cursor,
    offset: _offset,
    pageSize: _size,
    pageHash: _pageHash,
    sha256,
    ...metadata
  } = first;
  if (
    metadata.scope.tenantId !== scope.tenantId ||
    metadata.scope.actorId !== scope.actorId ||
    metadata.scope.deviceId !== scope.deviceId ||
    metadata.scope.channel !== 'APP'
  )
    throw new Error('El corte pertenece a otra cuenta o plataforma.');
  const entities: SnapshotEntity[] = [];
  let page = first;
  while (true) {
    const {
      entities: rows,
      nextCursor,
      offset,
      pageSize,
      pageHash,
      sha256: whole,
      ...headers
    } = page;
    if (
      offset !== entities.length ||
      pageSize !== first.pageSize ||
      whole !== sha256 ||
      canonicalJson(headers) !== canonicalJson(metadata) ||
      (await deps.digest(canonicalJson(rows))) !== pageHash ||
      entities.length + rows.length > metadata.coverage.rowCount ||
      (nextCursor && !rows.length)
    )
      throw new Error('El corte cambió o está incompleto.');
    deps.guard();
    entities.push(...rows);
    if (!nextCursor) break;
    page = SnapshotPageSchema.parse(await deps.get(nextCursor));
    deps.guard();
  }
  const document = SnapshotDocumentSchema.parse({ ...metadata, entities });
  if (
    entities.length !== metadata.coverage.rowCount ||
    (await deps.digest(canonicalJson(document))) !== sha256
  )
    throw new Error('La verificación completa del corte falló.');
  deps.guard();
  return document;
}
