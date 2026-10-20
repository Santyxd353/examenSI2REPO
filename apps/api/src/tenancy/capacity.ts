import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { currentTenant } from './context';

type Capacity = 'locations' | 'products' | 'staff';
const labels = {
  locations: 'ubicaciones activas',
  products: 'productos',
  staff: 'integrantes activos del equipo',
};

// Debe ejecutarse dentro de la misma transacción que crea o reactiva el registro.
export async function requireCapacity(tx: Prisma.TransactionClient, resource: Capacity) {
  const tenant = currentTenant();
  // El espacio anterior conserva sus datos y no es una suscripción comercial.
  if (tenant?.slug === 'lumina' && tenant.subscription?.plan === 'piloto') return;
  const limit = tenant?.subscription?.limits[resource];
  if (limit === undefined) return;
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`lumina:capacity:${resource}`}, 0))`;
  const count =
    resource === 'locations'
      ? await tx.ubicacion.count({ where: { activa: true } })
      : resource === 'products'
        ? await tx.producto.count()
        : await tx.usuario.count({
            where: {
              estado: 'ACTIVO',
              usuario_rol: {
                some: { rol: { nombre: { in: ['Administrador', 'Vendedor', 'Analista'] } } },
              },
            },
          });
  if (!Number.isSafeInteger(limit) || limit < 0 || count >= limit)
    throw new ConflictException(
      `El plan alcanzó su límite de ${labels[resource]}. Revisa la capacidad de tu suscripción.`,
    );
}
