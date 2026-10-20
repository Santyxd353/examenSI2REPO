import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { seedWomen } from './seed-women';
import { seedTenantRoles } from '../apps/api/src/tenancy/defaults';
const db = new PrismaClient();
export async function seed(client: PrismaClient = db) {
  await seedTenantRoles(client);
  const category = await client.categoria.upsert({
    where: { nombre: 'Esenciales' },
    update: {},
    create: {
      nombre: 'Esenciales',
      descripcion: 'Prendas de muestra para el desarrollo del vestidor.',
      activa: true,
    },
  });
  const location = await client.ubicacion.upsert({
    where: { id: '10000000-0000-4000-8000-000000000001' },
    update: {},
    create: {
      id: '10000000-0000-4000-8000-000000000001',
      nombre: 'Almacén de desarrollo',
      tipo: 'ALMACEN',
      activa: true,
    },
  });
  const template = await client.plantilla_corporal.upsert({
    where: { nombre_version: { nombre: 'Cuerpo neutro G18', version: '1.0' } },
    update: {},
    create: {
      nombre: 'Cuerpo neutro G18',
      version: '1.0',
      clave_malla: 'public/reference.glb',
      esqueleto_version: 'g18-1',
      parametros: { unidad: 'metros', eje: 'Y', origen: 'suelo' },
      licencia: 'Geometría propia Grupo 18',
      activa: true,
    },
  });
  const items = [
    [
      'Camiseta esencial',
      'Algodón suave, corte recto y cuello redondo. Prenda inicial preparada para el vestidor.',
      'Algodón',
      159,
    ],
    [
      'Camiseta arena',
      'Una versión cálida de la camiseta esencial, preparada en la misma plantilla.',
      'Algodón',
      159,
    ],
    ['Camiseta grafito', 'Camiseta de corte recto en un tono oscuro y versátil.', 'Algodón', 179],
  ] as const;
  for (let j = 0; j < items.length; j++) {
    const [nombre, descripcion, material, price] = items[j];
    const id = '20000000-0000-4000-8000-' + String(j + 1).padStart(12, '0');
    const product = await client.producto.upsert({
      where: { id },
      update: {},
      create: {
        id,
        categoria_id: category.id,
        nombre,
        descripcion,
        material,
        marca: 'Grupo 18',
        coleccion: 'Esenciales 01',
        estado: 'PUBLICADO',
        creado_en: new Date(),
      },
    });
    for (const [i, talla] of ['S', 'M', 'L'].entries()) {
      const variant = await client.variante.upsert({
        where: { sku: `G18-${j + 1}-${talla}` },
        update: {},
        create: {
          producto_id: product.id,
          sku: `G18-${j + 1}-${talla}`,
          talla,
          color: ['Marfil', 'Arena', 'Grafito'][j],
          color_hex: ['#e9e4d8', '#bca389', '#3f4547'][j],
          activa: true,
        },
      });
      const desde = new Date('2026-01-01T00:00:00Z');
      for (const canal of ['WEB', 'APP', 'TIENDA']) {
        await client.precio_canal.upsert({
          where: { variante_id_canal_desde: { variante_id: variant.id, canal, desde } },
          update: {},
          create: {
            variante_id: variant.id,
            canal,
            desde,
            importe: price,
            descuento_pct: 0,
            moneda: 'BOB',
          },
        });
        await client.disponibilidad_canal.upsert({
          where: {
            variante_id_ubicacion_id_canal: {
              variante_id: variant.id,
              ubicacion_id: location.id,
              canal,
            },
          },
          update: {},
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
      await client.inventario.upsert({
        where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: location.id } },
        update: {},
        create: {
          variante_id: variant.id,
          ubicacion_id: location.id,
          fisico: 8 + i,
          reservado: 0,
          comprometido: 0,
          version: 0,
        },
      });
      const key = 'public/garment-' + talla + '.glb';
      const file = resolve(process.env.STORAGE_ROOT || '.local/storage', key);
      if (existsSync(file)) {
        const buffer = readFileSync(file);
        const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
        const triangles = json.meshes
          .flatMap((m: any) => m.primitives)
          .reduce((n: number, p: any) => n + json.accessors[p.indices].count / 3, 0);
        await client.modelo_prenda.upsert({
          where: {
            variante_id_plantilla_id_version: {
              variante_id: variant.id,
              plantilla_id: template.id,
              version: 1,
            },
          },
          update: { bytes: buffer.length, triangulos: triangles },
          create: {
            variante_id: variant.id,
            plantilla_id: template.id,
            version: 1,
            clave_glb: key,
            ajuste: { talla, plantilla: 'g18-1', unidad: 'metros' },
            bytes: buffer.length,
            triangulos: triangles,
            licencia: 'Geometría propia Grupo 18',
            estado: 'PUBLICADO',
            creado_en: new Date(),
          },
        });
      }
    }
  }
  await seedWomen(client);
  console.log('Semilla lista: roles y catálogo de moda femenina.');
}
if (require.main === module) seed().finally(() => db.$disconnect());
