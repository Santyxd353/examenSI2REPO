import { PrismaClient } from '@prisma/client';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { resolve } from 'path';

type CatalogItem = {
  code: string;
  brand: string;
  name: string;
  description: string;
  category: 'Vestidos' | 'Faldas';
  material: string;
  color: string;
  colorHex: string;
  priceBob: number;
  kind: 'dress' | 'skirt';
  imageFile: string;
  sourcePage: string;
};

const catalogRoot = resolve('catalog-assets/women');
const items: CatalogItem[] = JSON.parse(readFileSync(resolve(catalogRoot, 'catalog.json'), 'utf8'));
const storageRoot = resolve(process.env.STORAGE_ROOT || '.local/storage');
const locationId = '10000000-0000-4000-8000-000000000001';
const effectiveFrom = new Date('2026-01-01T00:00:00Z');

export async function seedWomen(client: PrismaClient) {
  if (items.length !== 12 || new Set(items.map((item) => item.code)).size !== 12)
    throw new Error('El catálogo femenino requiere doce referencias únicas.');

  const categories = new Map<string, string>();
  for (const name of ['Vestidos', 'Faldas']) {
    const category = await client.categoria.upsert({
      where: { nombre: name },
      update: { activa: true },
      create: {
        nombre: name,
        descripcion: `Moda femenina · ${name.toLowerCase()}`,
        activa: true,
      },
    });
    categories.set(name, category.id);
  }
  const legacyCategory = await client.categoria.findUnique({ where: { nombre: 'Esenciales' } });
  if (legacyCategory)
    await client.categoria.update({ where: { id: legacyCategory.id }, data: { activa: false } });

  const template = await client.plantilla_corporal.findUniqueOrThrow({
    where: { nombre_version: { nombre: 'Cuerpo neutro G18', version: '1.0' } },
  });
  const location = await client.ubicacion.findUniqueOrThrow({ where: { id: locationId } });
  if (location.nombre === 'Almacén de desarrollo')
    await client.ubicacion.update({
      where: { id: locationId },
      data: { nombre: 'Almacén Lúmina' },
    });
  mkdirSync(resolve(storageRoot, 'public/catalog-women'), { recursive: true });
  mkdirSync(resolve(storageRoot, 'public/catalog-ar'), { recursive: true });

  for (const [index, item] of items.entries()) {
    const number = index + 21;
    const productId = `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
    const sourceImage = resolve(catalogRoot, item.imageFile);
    if (!existsSync(sourceImage)) throw new Error(`Falta fotografía de ${item.code}`);
    const imageKey = `public/catalog-women/${item.imageFile}`;
    copyFileSync(sourceImage, resolve(storageRoot, imageKey));
    const arImageFile = item.imageFile.replace(/\.(?:jpe?g|webp)$/i, '.png');
    const sourceArImage = resolve(catalogRoot, 'ar', arImageFile);
    if (!existsSync(sourceArImage)) throw new Error(`Falta imagen RA de ${item.code}`);
    const arImageKey = `public/catalog-ar/${arImageFile}`;
    copyFileSync(sourceArImage, resolve(storageRoot, arImageKey));

    const product = await client.producto.upsert({
      where: { id: productId },
      update: { estado: 'PUBLICADO' },
      create: {
        id: productId,
        categoria_id: categories.get(item.category)!,
        nombre: item.name,
        descripcion: item.description,
        material: item.material,
        marca: item.brand,
        coleccion: 'Lúmina · moda femenina',
        estado: 'PUBLICADO',
        creado_en: new Date('2026-09-23T00:00:00Z'),
      },
    });
    const publishedImage = await client.recurso_catalogo.findFirst({
      where: { producto_id: product.id, variante_id: null, clave_objeto: imageKey, uso: 'GALERIA' },
    });
    if (!publishedImage)
      await client.recurso_catalogo.create({
        data: {
          producto_id: product.id,
          clave_objeto: imageKey,
          tipo_mime: 'image/jpeg',
          orden: 0,
          texto_alternativo: `${item.name}, color ${item.color}`,
          licencia: `Imagen del fabricante ${item.brand}; fuente en catálogo académico.`,
          uso: 'GALERIA',
          estado: 'PUBLICADO',
        },
      });

    for (const [sizeIndex, size] of ['S', 'M', 'L'].entries()) {
      const variant = await client.variante.upsert({
        where: { sku: `G18-W${number}-${size}` },
        update: { activa: true },
        create: {
          producto_id: product.id,
          sku: `G18-W${number}-${size}`,
          talla: size,
          color: item.color,
          color_hex: item.colorHex,
          activa: true,
        },
      });
      for (const channel of ['WEB', 'APP', 'TIENDA']) {
        await client.precio_canal.upsert({
          where: {
            variante_id_canal_desde: {
              variante_id: variant.id,
              canal: channel,
              desde: effectiveFrom,
            },
          },
          update: {},
          create: {
            variante_id: variant.id,
            canal: channel,
            desde: effectiveFrom,
            importe: item.priceBob,
            descuento_pct: 0,
            moneda: 'BOB',
          },
        });
        await client.disponibilidad_canal.upsert({
          where: {
            variante_id_ubicacion_id_canal: {
              variante_id: variant.id,
              ubicacion_id: locationId,
              canal: channel,
            },
          },
          update: {},
          create: {
            variante_id: variant.id,
            ubicacion_id: locationId,
            canal: channel,
            habilitada: true,
            stock_seguridad: 1,
            plazo_reposicion_dias: 0,
          },
        });
      }
      await client.inventario.upsert({
        where: { variante_id_ubicacion_id: { variante_id: variant.id, ubicacion_id: locationId } },
        update: {},
        create: {
          variante_id: variant.id,
          ubicacion_id: locationId,
          fisico: 8 + sizeIndex,
          reservado: 0,
          comprometido: 0,
          version: 0,
        },
      });

      const arResource = await client.recurso_catalogo.findFirst({
        where: { variante_id: variant.id, clave_objeto: arImageKey, uso: 'AR' },
      });
      if (arResource) {
        await client.recurso_catalogo.update({
          where: { id: arResource.id },
          data: {
            estado: 'PUBLICADO',
            texto_alternativo: `${item.name}, vista frontal para prueba RA`,
            licencia: 'Catálogo Grupo 18 / recurso RA generado',
          },
        });
      } else {
        await client.recurso_catalogo.create({
          data: {
            producto_id: product.id,
            variante_id: variant.id,
            clave_objeto: arImageKey,
            tipo_mime: 'image/png',
            orden: 0,
            texto_alternativo: `${item.name}, vista frontal para prueba RA`,
            licencia: 'Catálogo Grupo 18 / recurso RA generado',
            uso: 'AR',
            estado: 'PUBLICADO',
          },
        });
      }
      await client.recurso_catalogo.updateMany({
        where: {
          variante_id: variant.id,
          uso: 'AR',
          estado: 'PUBLICADO',
          NOT: { clave_objeto: arImageKey },
        },
        data: { estado: 'BORRADOR' },
      });

      const glbKey = `public/${item.kind}-${size}.glb`;
      const glbFile = resolve(storageRoot, glbKey);
      if (existsSync(glbFile)) {
        const buffer = readFileSync(glbFile);
        const document = JSON.parse(
          buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'),
        );
        const triangles = document.meshes
          .flatMap((mesh: any) => mesh.primitives)
          .reduce(
            (count: number, primitive: any) =>
              count + document.accessors[primitive.indices].count / 3,
            0,
          );
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
            clave_glb: glbKey,
            ajuste: {
              talla: size,
              plantilla: 'g18-1',
              tipo: item.kind,
              representacion: 'referencial',
            },
            bytes: buffer.length,
            triangulos: triangles,
            licencia: 'Silueta 3D original Grupo 18, representación aproximada',
            estado: 'PUBLICADO',
            creado_en: new Date(),
          },
        });
      }
    }
  }

  await client.producto.updateMany({
    where: {
      id: {
        in: [1, 2, 3].map(
          (number) => `20000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
        ),
      },
    },
    data: { estado: 'RETIRADO' },
  });
  console.log('Catálogo femenino listo: 12 productos, 36 variantes, fotos, RA y siluetas 3D.');
}
