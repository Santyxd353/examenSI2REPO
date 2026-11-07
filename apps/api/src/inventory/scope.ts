import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Identity } from '../auth';
export const can = (user: Identity, permission: string) => user.permissions.includes(permission);
export async function requireLocationScope(
  db: Pick<Prisma.TransactionClient, 'usuario_ubicacion'>,
  user: Identity,
  locationId: string,
) {
  if (can(user, 'ubicaciones:gestionar') || user.roles.includes('Administrador')) return;
  const assigned = await db.usuario_ubicacion.findUnique({
    where: { usuario_id_ubicacion_id: { usuario_id: user.id, ubicacion_id: locationId } },
  });
  if (!assigned) throw new ForbiddenException('No tienes acceso a esta ubicación.');
}
export async function lockActiveLocations(tx: Prisma.TransactionClient, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<
    { id: string; activa: boolean }[]
  >`SELECT id,activa FROM ubicacion WHERE id=ANY(${unique}::uuid[]) ORDER BY id FOR SHARE`;
  if (rows.length !== unique.length || rows.some((row) => !row.activa))
    throw new NotFoundException('La ubicación no existe o está inactiva.');
}
