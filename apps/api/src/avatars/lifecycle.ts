import { Prisma } from '@prisma/client';
import { QuotaService } from '../billing/quota.service';

/** Retain only identifiers needed for replay, never photographs or corrected measurements. */
export function retainedJobMetadata(value: Prisma.JsonValue | null): Prisma.InputJsonObject {
  const metadata = (value ?? {}) as Record<string, unknown>;
  const result: Record<string, string> = {};
  if (typeof metadata.requestHash === 'string' && /^[a-f0-9]{64}$/.test(metadata.requestHash))
    result.requestHash = metadata.requestHash;
  if (typeof metadata.sourceAvatarId === 'string') result.sourceAvatarId = metadata.sourceAvatarId;
  return result;
}
export async function releaseAvatarQuota(
  tx: Prisma.TransactionClient,
  quota: QuotaService,
  jobId: string,
) {
  // Jobs accepted by older releases can lack this ledger. Cleanup must still work.
  if (await tx.consumo_cuota.findUnique({ where: { trabajo_avatar_id: jobId } }))
    await quota.release(tx, 'AVATAR_GENERACION', jobId);
}
export async function avatarAudit(
  tx: Prisma.TransactionClient,
  actorId: string,
  id: string,
  action: string,
  correlation: string,
  data: Prisma.InputJsonObject,
) {
  await tx.auditoria.create({
    data: {
      actor_id: actorId,
      entidad: 'avatar',
      entidad_id: id,
      accion: action,
      correlacion: correlation,
      cambios: data,
      creado_en: new Date(),
    },
  });
}

export function isAvatarPrivacyDeletion(method: string, path: string) {
  return (
    method === 'DELETE' &&
    /^\/api\/avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i.test(path)
  );
}
