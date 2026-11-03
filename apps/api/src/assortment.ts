import { Prisma } from '@prisma/client';

// El catálogo es común; las cantidades físicas siguen siendo independientes por ubicación.
export async function assignAssortment(
  tx: Prisma.TransactionClient,
  variantIds: string[],
  locationIds: string[],
) {
  if (!variantIds.length || !locationIds.length) return;
  const pairs = variantIds.flatMap((variantId) =>
    locationIds.map((locationId) => ({ variante_id: variantId, ubicacion_id: locationId })),
  );
  await tx.inventario.createMany({
    data: pairs.map((pair) => ({
      ...pair,
      fisico: 0,
      reservado: 0,
      comprometido: 0,
      version: 1,
    })),
    skipDuplicates: true,
  });
  await tx.disponibilidad_canal.createMany({
    data: pairs.flatMap((pair) =>
      (['WEB', 'APP', 'TIENDA'] as const).map((canal) => ({
        ...pair,
        canal,
        habilitada: true,
        stock_seguridad: 0,
        plazo_reposicion_dias: 0,
      })),
    ),
    skipDuplicates: true,
  });
}
