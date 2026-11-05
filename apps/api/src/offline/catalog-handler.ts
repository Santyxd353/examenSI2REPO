import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OfflineIntent, OperationReceipt } from '@lumina/contracts';
import { Identity } from '../auth';
import { mutateCatalog } from '../catalog/catalog.service';
export async function catalogHandler(
  tx: Prisma.TransactionClient,
  actor: Identity,
  op: Extract<OfflineIntent, { kind: 'CATALOG_CREATE' | 'CATALOG_UPDATE' | 'CATALOG_ARCHIVE' }>,
  parents: OperationReceipt[],
) {
  let baseVersion = op.baseVersion;
  if (op.kind !== 'CATALOG_CREATE' && baseVersion === null) {
    const parent = parents.find(
      (p) =>
        p.entityId === op.entityId && p.status === 'APPLIED' && p.result.kind === 'CATALOG_CREATE',
    );
    if (!parent?.confirmedVersion)
      throw new ConflictException({
        code: 'INVALID_DEPENDENCY',
        message: 'La edición sin versión debe depender del alta aplicada de esta misma prenda.',
      });
    baseVersion = parent.confirmedVersion;
  }
  const row = await mutateCatalog(
    tx,
    {
      actor,
      operationId: op.operationId,
      resolveResource: async () => {
        throw new ServiceUnavailableException({
          code: 'RESOURCE_NOT_STAGED',
          message: 'Sube y verifica los archivos pendientes antes de sincronizar la prenda.',
          retryable: true,
        });
      },
    },
    { kind: op.kind, entityId: op.entityId, baseVersion, payload: op.payload },
  );
  return {
    version: row.version,
    result: {
      productId: row.id,
      kind: op.kind,
      version: row.version,
      state: row.estado,
      variants: row.variantes.map((v) => ({ id: v.id, version: v.version })),
    },
  };
}
