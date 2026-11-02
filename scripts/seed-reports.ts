import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const db = new PrismaClient();
const locationId = '10000000-0000-4000-8000-000000000001';
const prefix = 'DEMO-REP-';
const demoBranches = [
  { id: '10000000-0000-4000-8000-000000000002', nombre: 'Sucursal Centro', direccion: 'Av. Mariscal Santa Cruz 120, La Paz' },
  { id: '10000000-0000-4000-8000-000000000003', nombre: 'Sucursal Sur', direccion: 'Calle 21 de Calacoto 45, La Paz' },
  { id: '10000000-0000-4000-8000-000000000004', nombre: 'Sucursal Norte', direccion: 'Av. Perú 860, La Paz' },
] as const;

const states = ['CONFIRMADO', 'PREPARANDO', 'DESPACHADO', 'ENTREGADO'] as const;
const quantities = [1, 2, 1, 1, 2, 1, 2, 1, 1, 2, 1, 2] as const;
const demoPassword = 'EquipoDemo2026!';

function reportDate(index: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - (index * 6 + 1));
  return date;
}

async function main() {
  const seller = await db.usuario.findFirst({
    where: { estado: 'ACTIVO', usuario_rol: { some: { rol: { nombre: 'Administrador' } } } },
    select: { id: true, nombres: true, apellidos: true },
  });
  if (!seller)
    throw new Error('No hay un administrador activo. Inicia sesión y asígnale el rol Administrador antes de cargar la demo.');

  const variants = await db.variante.findMany({
    where: {
      activa: true,
      inventario: { some: { ubicacion_id: locationId } },
      producto: { estado: 'PUBLICADO' },
    },
    include: {
      producto: { select: { nombre: true } },
      precio_canal: { where: { canal: 'TIENDA' }, orderBy: { desde: 'desc' }, take: 1 },
    },
    orderBy: { sku: 'asc' },
    take: 8,
  });
  if (variants.length < 4)
    throw new Error('Faltan variantes publicadas con inventario. Ejecuta primero npm run db:seed.');

  for (const branch of demoBranches) {
    await db.ubicacion.upsert({
      where: { id: branch.id },
      update: { activa: true },
      create: { ...branch, tipo: 'TIENDA', activa: true },
    });
    for (const [variantIndex, variant] of variants.entries()) {
      for (const canal of ['WEB', 'APP', 'TIENDA']) {
        await db.disponibilidad_canal.upsert({
          where: {
            variante_id_ubicacion_id_canal: {
              variante_id: variant.id,
              ubicacion_id: branch.id,
              canal,
            },
          },
          update: { habilitada: true },
          create: {
            variante_id: variant.id,
            ubicacion_id: branch.id,
            canal,
            habilitada: true,
            stock_seguridad: 1,
            plazo_reposicion_dias: 0,
          },
        });
      }
      await db.inventario.upsert({
        where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: branch.id } },
        update: {},
        create: {
          variante_id: variant.id,
          ubicacion_id: branch.id,
          fisico: 6 + (variantIndex % 3),
          reservado: 0,
          comprometido: 0,
          version: 0,
        },
      });
    }
  }

  const roles = await db.rol.findMany({
    where: { nombre: { in: ['Vendedor', 'Analista'] } },
    select: { id: true, nombre: true },
  });
  const rolesByName = new Map(roles.map((role) => [role.nombre, role.id]));
  if (!rolesByName.get('Vendedor') || !rolesByName.get('Analista'))
    throw new Error('Faltan roles para el equipo. Ejecuta primero npm run db:seed.');
  const team = [
    { nombres: 'Valeria', apellidos: 'Flores', correo: 'ventas.centro@lumina.demo', rol: 'Vendedor', ubicaciones: [demoBranches[0].id] },
    { nombres: 'Mateo', apellidos: 'Quispe', correo: 'ventas.sur@lumina.demo', rol: 'Vendedor', ubicaciones: [demoBranches[1].id] },
    { nombres: 'Camila', apellidos: 'Rojas', correo: 'ventas.norte@lumina.demo', rol: 'Vendedor', ubicaciones: [demoBranches[2].id] },
    { nombres: 'Diego', apellidos: 'Mendoza', correo: 'analitica@lumina.demo', rol: 'Analista', ubicaciones: [locationId, ...demoBranches.map((branch) => branch.id)] },
  ] as const;
  const passwordHash = await hash(demoPassword, 12);
  for (const member of team) {
    const user = await db.usuario.upsert({
      where: { correo: member.correo },
      update: { estado: 'ACTIVO' },
      create: {
        nombres: member.nombres,
        apellidos: member.apellidos,
        correo: member.correo,
        clave_hash: passwordHash,
        estado: 'ACTIVO',
        preferencias: { origen: 'semilla_demo_equipo' },
        creado_en: new Date(),
      },
    });
    const roleId = rolesByName.get(member.rol)!;
    await db.usuario_rol.upsert({
      where: { usuario_id_rol_id: { usuario_id: user.id, rol_id: roleId } },
      update: {},
      create: { usuario_id: user.id, rol_id: roleId, asignado_en: new Date() },
    });
    for (const branchId of member.ubicaciones) {
      await db.usuario_ubicacion.upsert({
        where: { usuario_id_ubicacion_id: { usuario_id: user.id, ubicacion_id: branchId } },
        update: {},
        create: { usuario_id: user.id, ubicacion_id: branchId },
      });
    }
  }

  let created = 0;
  for (const [index, quantity] of quantities.entries()) {
    const number = `${prefix}${String(index + 1).padStart(2, '0')}`;
    const exists = await db.pedido.findUnique({ where: { numero: number }, select: { id: true } });
    if (exists) continue;

    const variant = variants[index % variants.length];
    const unitPrice = variant.precio_canal[0]?.importe ?? new Prisma.Decimal(250);
    const total = new Prisma.Decimal(unitPrice).mul(quantity);
    const createdAt = reportDate(index);
    const state = states[index % states.length];

    await db.$transaction(async (tx) => {
      const inventory = await tx.inventario.findUniqueOrThrow({
        where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: locationId } },
        select: { fisico: true },
      });
      if (inventory.fisico < quantity)
        throw new Error(`Inventario insuficiente para la venta demo de ${variant.sku}.`);

      await tx.pedido.create({
        data: {
          usuario_id: seller.id,
          vendedor_id: seller.id,
          ubicacion_id: locationId,
          numero: number,
          canal: index % 3 === 0 ? 'WEB' : index % 3 === 1 ? 'APP' : 'TIENDA',
          moneda: 'BOB',
          subtotal: total,
          descuento: 0,
          impuesto: 0,
          entrega: 0,
          total,
          direccion_snapshot: { tipo: 'venta_demo', nota: 'Datos de demostración para reportes' },
          reglas_snapshot: { fuente: 'seed-reports', version: 1 },
          estado: state,
          creado_en: createdAt,
          entregado_en: state === 'ENTREGADO' ? createdAt : null,
          idempotencia: `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          detalle_pedido: {
            create: {
              variante_id: variant.id,
              sku_snapshot: variant.sku,
              descripcion_snapshot: variant.producto.nombre,
              talla_snapshot: variant.talla,
              color_snapshot: variant.color,
              cantidad: quantity,
              precio_unitario: unitPrice,
              descuento: 0,
              total_linea: total,
            },
          },
          pago: {
            create: {
              proveedor: 'DEMO_LOCAL',
              referencia: `${number}-PAGO`,
              idempotencia: `71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
              monto: total,
              moneda: 'BOB',
              estado: 'CONFIRMADO',
              creado_en: createdAt,
              confirmado_en: createdAt,
            },
          },
        },
      });
      await tx.inventario.update({
        where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: locationId } },
        data: { fisico: { decrement: quantity }, version: { increment: 1 } },
      });
    });
    created++;
  }

  let branchOrders = 0;
  for (const [index, branch] of demoBranches.entries()) {
    const number = `DEMO-SUC-${String(index + 1).padStart(2, '0')}`;
    if (await db.pedido.findUnique({ where: { numero: number }, select: { id: true } })) continue;
    const variant = variants[index];
    const unitPrice = variant.precio_canal[0]?.importe ?? new Prisma.Decimal(250);
    const quantity = index === 1 ? 2 : 1;
    const total = new Prisma.Decimal(unitPrice).mul(quantity);
    const createdAt = reportDate(index * 3 + 2);
    await db.$transaction(async (tx) => {
      await tx.pedido.create({
        data: {
          usuario_id: seller.id,
          vendedor_id: seller.id,
          ubicacion_id: branch.id,
          numero: number,
          canal: 'TIENDA',
          moneda: 'BOB',
          subtotal: total,
          descuento: 0,
          impuesto: 0,
          entrega: 0,
          total,
          direccion_snapshot: { tipo: 'venta_demo_sucursal', nota: branch.nombre },
          reglas_snapshot: { fuente: 'seed-reports', version: 1 },
          estado: 'CONFIRMADO',
          creado_en: createdAt,
          idempotencia: `72000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          detalle_pedido: { create: { variante_id: variant.id, sku_snapshot: variant.sku, descripcion_snapshot: variant.producto.nombre, talla_snapshot: variant.talla, color_snapshot: variant.color, cantidad: quantity, precio_unitario: unitPrice, descuento: 0, total_linea: total } },
          pago: { create: { proveedor: 'DEMO_LOCAL', referencia: `${number}-PAGO`, idempotencia: `73000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, monto: total, moneda: 'BOB', estado: 'CONFIRMADO', creado_en: createdAt, confirmado_en: createdAt } },
        },
      });
      await tx.inventario.update({
        where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: branch.id } },
        data: { fisico: { decrement: quantity }, version: { increment: 1 } },
      });
    });
    branchOrders++;
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);
  const summary = await db.pedido.aggregate({
    where: {
      OR: [{ numero: { startsWith: prefix } }, { numero: { startsWith: 'DEMO-SUC-' } }],
      creado_en: { gte: since },
    },
    _count: { id: true },
    _sum: { total: true },
  });
  console.log(
    `Reportes demo listos: ${summary._count.id} pedidos, Bs ${Number(summary._sum.total ?? 0).toFixed(2)} en ventas. Nuevos: ${created}.`,
  );
  console.log(`Sucursales demo listas: ${demoBranches.map((branch) => branch.nombre).join(', ')}. Ventas de sucursal nuevas: ${branchOrders}.`);
  console.log(`Equipo demo listo: ${team.length} integrantes. Contraseña temporal: ${demoPassword}`);
  console.log(`Vendedor asignado: ${seller.nombres} ${seller.apellidos}.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
