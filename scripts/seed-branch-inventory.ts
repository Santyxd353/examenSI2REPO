import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const channels = ['WEB', 'APP', 'TIENDA'];

function targetStock(locationType: string, variantIndex: number, locationIndex: number) {
  return locationType === 'ALMACEN'
    ? 8 + (variantIndex % 3)
    : 4 + ((variantIndex + locationIndex) % 4);
}

async function main() {
  const [actor, locations, variants] = await Promise.all([
    db.usuario.findFirst({
      where: { estado: 'ACTIVO', usuario_rol: { some: { rol: { nombre: 'Administrador' } } } },
      select: { id: true },
    }),
    db.ubicacion.findMany({
      where: { activa: true, tipo: { in: ['TIENDA', 'ALMACEN'] } },
      select: { id: true, nombre: true, tipo: true },
      orderBy: [{ tipo: 'asc' }, { nombre: 'asc' }],
    }),
    db.variante.findMany({
      where: { activa: true, producto: { estado: 'PUBLICADO' } },
      select: { id: true, sku: true },
      orderBy: { sku: 'asc' },
    }),
  ]);

  if (!actor) throw new Error('No hay un administrador activo para registrar los ajustes de inventario.');
  if (!locations.length) throw new Error('No hay sucursales o almacenes activos.');
  if (!variants.length) throw new Error('No hay variantes publicadas para distribuir.');

  let created = 0;
  let adjusted = 0;
  let unchanged = 0;
  let protectedRows = 0;
  const operationAt = new Date();

  for (const [locationIndex, location] of locations.entries()) {
    for (const [variantIndex, variant] of variants.entries()) {
      const desired = targetStock(location.tipo, variantIndex, locationIndex);
      await db.$transaction(
        async (tx) => {
          for (const canal of channels) {
            await tx.disponibilidad_canal.upsert({
              where: {
                variante_id_ubicacion_id_canal: {
                  variante_id: variant.id,
                  ubicacion_id: location.id,
                  canal,
                },
              },
              update: { habilitada: true },
              create: {
                variante_id: variant.id,
                ubicacion_id: location.id,
                canal,
                habilitada: true,
                stock_seguridad: 1,
                plazo_reposicion_dias: 0,
              },
            });
          }

          const inventory = await tx.inventario.findUnique({
            where: {
              variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: location.id },
            },
          });
          if (!inventory) {
            await tx.inventario.create({
              data: {
                variante_id: variant.id,
                ubicacion_id: location.id,
                fisico: desired,
                reservado: 0,
                comprometido: 0,
                version: 1,
              },
            });
            created++;
            return;
          }

          if (inventory.reservado > 0 || inventory.comprometido > 0) {
            protectedRows++;
            return;
          }
          const delta = desired - inventory.fisico;
          if (!delta) {
            unchanged++;
            return;
          }
          const updated = await tx.inventario.update({
            where: { id: inventory.id },
            data: { fisico: desired, version: { increment: 1 } },
          });
          await tx.movimiento_stock.create({
            data: {
              inventario_id: updated.id,
              grupo_operacion: randomUUID(),
              tipo: 'AJUSTE',
              delta_fisico: delta,
              delta_reservado: 0,
              delta_comprometido: 0,
              motivo: 'Balance inicial de inventario demostrativo por sucursal.',
              actor_id: actor.id,
              creado_en: operationAt,
            },
          });
          adjusted++;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    }
  }

  console.log(
    `Inventario distribuido: ${variants.length} variantes en ${locations.length} ubicaciones. ` +
      `Creados: ${created}; ajustados: ${adjusted}; sin cambios: ${unchanged}; protegidos: ${protectedRows}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
