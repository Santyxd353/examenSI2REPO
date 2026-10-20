import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Inject,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthRequest, requirePermission } from './auth';
import { removeStored, storedPath, publicAssetPath } from './storage';
import { assignAssortment } from './assortment';
import { RealtimeGateway } from './realtime';
import { requireCapacity } from './tenancy/capacity';

const garmentInput = z
  .object({
    nombre: z.string().trim().min(2).max(160),
    descripcion: z.string().trim().min(10).max(3000),
    material: z.string().trim().min(2).max(150),
    marca: z.string().trim().min(2).max(100),
    tipoPrenda: z.string().trim().min(2).max(80),
    precio: z.coerce.number().positive().max(1000000),
    licencia: z.string().trim().min(3).max(255),
    variantes: z.string(),
  })
  .strict();
const variantsInput = z
  .array(
    z
      .object({
        talla: z.string().trim().min(1).max(20),
        color: z.string().trim().min(2).max(50),
        colorHex: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .strict(),
  )
  .min(1)
  .max(30);

function galleryMime(file: Express.Multer.File) {
  const bytes = file.buffer;
  if (
    file.mimetype === 'image/png' &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: 'image/png', extension: 'png' };
  if (file.mimetype === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    file.mimetype === 'image/webp' &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return { mime: 'image/webp', extension: 'webp' };
  throw new BadRequestException('Las fotos deben ser PNG, JPEG o WebP válidos.');
}

function validateArPng(bytes: Buffer) {
  if (
    bytes.length < 33 ||
    bytes.length > 5 * 1024 * 1024 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    throw new BadRequestException('Sube un PNG válido de hasta 5 MB.');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  // Bound decoded memory before inflating any image data.
  if (width < 256 || height < 256 || width > 2048 || height > 2048)
    throw new BadRequestException('La imagen debe medir entre 256 y 2048 píxeles por lado.');
  let decoded: PNG;
  try {
    decoded = PNG.sync.read(bytes, { checkCRC: true });
  } catch {
    throw new BadRequestException('El PNG está incompleto o dañado. Exporta la imagen nuevamente.');
  }
  let transparent = 0;
  let visible = 0;
  for (let offset = 3; offset < decoded.data.length; offset += 4) {
    if (decoded.data[offset] <= 16) transparent++;
    if (decoded.data[offset] >= 128) visible++;
  }
  const minimumPixels = Math.ceil(width * height * 0.05);
  if (transparent < minimumPixels || visible < minimumPixels)
    throw new BadRequestException(
      'El PNG debe mostrar una prenda visible y un fondo transparente: al menos 5% de cada uno.',
    );
}
@Controller('catalog')
export class CatalogController {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(RealtimeGateway) private realtime: RealtimeGateway,
  ) {}
  @Get()
  async list(
    @Query('search') search = '',
    @Query('category') category = '',
    @Query('location') location = '',
    @Query('brand') brand = '',
    @Query('color') color = '',
    @Query('size') size = '',
    @Query('channel') rawChannel = 'WEB',
  ) {
    const channel = z.enum(['WEB', 'APP']).catch('WEB').parse(rawChannel.toUpperCase());
    const locationId = z.string().uuid().safeParse(location).success ? location : null;
    const searchFilter = search.trim().slice(0, 100);
    const brandFilter = brand.trim().slice(0, 100);
    const colorFilter = color.trim().slice(0, 50);
    const sizeFilter = size.trim().slice(0, 20);
    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    const compareSizes = (a: string, b: string) => {
      const left = sizeOrder.indexOf(a.toUpperCase());
      const right = sizeOrder.indexOf(b.toUpperCase());
      return (left < 0 ? 999 : left) - (right < 0 ? 999 : right) || a.localeCompare(b, 'es');
    };
    const products = await this.db.producto.findMany({
      where: {
        estado: 'PUBLICADO',
        ...(searchFilter
          ? {
              OR: [
                { nombre: { contains: searchFilter, mode: 'insensitive' as const } },
                { marca: { contains: searchFilter, mode: 'insensitive' as const } },
                { descripcion: { contains: searchFilter, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        ...(brandFilter ? { marca: { equals: brandFilter, mode: 'insensitive' as const } } : {}),
        ...(colorFilter || sizeFilter
          ? {
              variante: {
                some: {
                  activa: true,
                  ...(colorFilter
                    ? { color: { equals: colorFilter, mode: 'insensitive' as const } }
                    : {}),
                  ...(sizeFilter
                    ? { talla: { equals: sizeFilter, mode: 'insensitive' as const } }
                    : {}),
                },
              },
            }
          : {}),
        ...(z.string().uuid().safeParse(category).success ? { categoria_id: category } : {}),
      },
      orderBy: { creado_en: 'asc' },
      include: { categoria: { select: { nombre: true } } },
      take: 60,
    });
    const result = [];
    for (const p of products) {
      const variants = await this.db.variante.findMany({
        where: {
          producto_id: p.id,
          activa: true,
          ...(colorFilter ? { color: { equals: colorFilter, mode: 'insensitive' } } : {}),
          ...(sizeFilter ? { talla: { equals: sizeFilter, mode: 'insensitive' } } : {}),
        },
        orderBy: { sku: 'asc' },
      });
      const disponibles = [];
      const gallery = await this.db.recurso_catalogo.findMany({
        where: { producto_id: p.id, variante_id: null, uso: 'GALERIA', estado: 'PUBLICADO' },
        orderBy: { orden: 'asc' },
        select: { clave_objeto: true, texto_alternativo: true },
      });
      const arResources = await this.db.recurso_catalogo.findMany({
        where: { producto_id: p.id, uso: 'AR', estado: 'PUBLICADO', variante_id: { not: null } },
        select: { variante_id: true, clave_objeto: true },
      });
      for (const v of variants) {
        const policy = locationId
          ? await this.db.disponibilidad_canal.findUnique({
              where: {
                variante_id_ubicacion_id_canal: {
                  variante_id: v.id,
                  ubicacion_id: locationId,
                  canal: channel,
                },
              },
            })
          : null;
        if (locationId && !policy?.habilitada) continue;
        const now = new Date();
        const price = await this.db.precio_canal.findFirst({
          where: {
            variante_id: v.id,
            canal: channel,
            desde: { lte: now },
            OR: [{ hasta: null }, { hasta: { gt: now } }],
          },
          orderBy: { desde: 'desc' },
        });
        const stock = locationId
          ? await this.db.$queryRaw<
              { available: number }[]
            >`SELECT COALESCE(SUM(GREATEST(i.disponible-d.stock_seguridad,0)),0)::int AS available FROM inventario i JOIN disponibilidad_canal d ON d.variante_id=i.variante_id AND d.ubicacion_id=i.ubicacion_id JOIN ubicacion u ON u.id=i.ubicacion_id WHERE i.variante_id=${v.id}::uuid AND i.ubicacion_id=${locationId}::uuid AND d.canal=${channel} AND d.habilitada AND u.activa`
          : await this.db.$queryRaw<
              { available: number }[]
            >`SELECT COALESCE(SUM(GREATEST(i.disponible-d.stock_seguridad,0)),0)::int AS available FROM inventario i JOIN disponibilidad_canal d ON d.variante_id=i.variante_id AND d.ubicacion_id=i.ubicacion_id JOIN ubicacion u ON u.id=i.ubicacion_id WHERE i.variante_id=${v.id}::uuid AND d.canal=${channel} AND d.habilitada AND u.activa`;
        const locations = locationId
          ? await this.db.$queryRaw<
              {
                id: string;
                nombre: string;
                tipo: string;
                direccion: string | null;
                disponible: number;
              }[]
            >`SELECT u.id,u.nombre,u.tipo,u.direccion,GREATEST(i.disponible-d.stock_seguridad,0)::int AS disponible
              FROM inventario i JOIN ubicacion u ON u.id=i.ubicacion_id
              JOIN disponibilidad_canal d ON d.variante_id=i.variante_id AND d.ubicacion_id=i.ubicacion_id
              WHERE i.variante_id=${v.id}::uuid AND i.ubicacion_id=${locationId}::uuid
                AND u.activa AND d.canal=${channel} AND d.habilitada
              ORDER BY CASE u.tipo WHEN 'TIENDA' THEN 0 ELSE 1 END,u.nombre`
          : await this.db.$queryRaw<
              {
                id: string;
                nombre: string;
                tipo: string;
                direccion: string | null;
                disponible: number;
              }[]
            >`SELECT u.id,u.nombre,u.tipo,u.direccion,GREATEST(i.disponible-d.stock_seguridad,0)::int AS disponible
              FROM inventario i JOIN ubicacion u ON u.id=i.ubicacion_id
              JOIN disponibilidad_canal d ON d.variante_id=i.variante_id AND d.ubicacion_id=i.ubicacion_id
              WHERE i.variante_id=${v.id}::uuid AND u.activa AND d.canal=${channel} AND d.habilitada
              ORDER BY CASE u.tipo WHEN 'TIENDA' THEN 0 ELSE 1 END,u.nombre`;
        const model = await this.db.modelo_prenda.findFirst({
          where: { variante_id: v.id, estado: 'PUBLICADO' },
          orderBy: { version: 'desc' },
        });
        const arResource = arResources.find((resource) => resource.variante_id === v.id);
        if (price)
          disponibles.push({
            ...v,
            precio: Number(price.importe) * (1 - Number(price.descuento_pct) / 100),
            moneda: price.moneda,
            disponible: stock[0].available,
            ubicaciones: locations,
            modeloId: model?.id,
            plantillaId: model?.plantilla_id,
            arImagePath: arResource ? publicAssetPath(arResource.clave_objeto) : null,
          });
      }
      if (
        disponibles.length ||
        (!locationId && !brandFilter && !colorFilter && !sizeFilter && !search)
      )
        result.push({
          ...p,
          tipoPrenda: p.categoria.nombre,
          imagenes: gallery.map((image) => ({
            url: publicAssetPath(image.clave_objeto),
            textoAlternativo: image.texto_alternativo,
          })),
          variantes: disponibles.sort(
            (a, b) => compareSizes(a.talla, b.talla) || a.color.localeCompare(b.color, 'es'),
          ),
        });
    }
    const filterProducts = await this.db.producto.findMany({
      where: { estado: 'PUBLICADO' },
      select: {
        marca: true,
        variante: { where: { activa: true }, select: { color: true, talla: true } },
      },
    });
    const sorted = (values: string[]) =>
      [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es'));
    return {
      products: result,
      filters: {
        brands: sorted(
          filterProducts
            .map((product) => product.marca)
            .filter((value): value is string => !!value),
        ),
        colors: sorted(
          filterProducts.flatMap((product) => product.variante.map((variant) => variant.color)),
        ),
        sizes: sorted(
          filterProducts.flatMap((product) => product.variante.map((variant) => variant.talla)),
        ).sort(compareSizes),
      },
      categories: await this.db.categoria.findMany({ where: { activa: true } }),
      locations: await this.db.ubicacion.findMany({
        where: { activa: true, inventario: { some: {} } },
        select: { id: true, nombre: true, tipo: true, direccion: true },
        orderBy: [{ tipo: 'desc' }, { nombre: 'asc' }],
      }),
    };
  }

  @Post('garments')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FilesInterceptor('fotos', 8, {
      storage: memoryStorage(),
      limits: { files: 8, fileSize: 5 * 1024 * 1024, fields: 8 },
    }),
  )
  async createGarment(
    @Req() r: AuthRequest,
    @Body() body: unknown,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    requirePermission(r.user, 'catalogo:gestionar');
    const data = garmentInput.parse(body);
    let variants: z.infer<typeof variantsInput>;
    try {
      variants = variantsInput.parse(JSON.parse(data.variantes));
    } catch {
      throw new BadRequestException('Añade al menos una combinación válida de talla y color.');
    }
    const combinations = variants.map(
      (variant) => `${variant.talla.toLowerCase()}|${variant.color.toLowerCase()}`,
    );
    if (new Set(combinations).size !== combinations.length)
      throw new BadRequestException('No repitas la misma talla y color en una prenda.');
    if (!files?.length) throw new BadRequestException('Adjunta al menos una foto de la prenda.');
    const photos = files.map((file) => {
      if (file.size < 100) throw new BadRequestException('Una de las fotos está vacía.');
      return { file, ...galleryMime(file), key: '' };
    });
    await mkdir(storedPath('public/catalog-gallery'), { recursive: true });
    const written: string[] = [];
    let created: {
      id: string;
      nombre: string;
      variantes: string[];
      ubicaciones: string[];
      fotos: number;
    };
    try {
      for (const photo of photos) {
        photo.key = `public/catalog-gallery/${randomUUID()}.${photo.extension}`;
        await writeFile(storedPath(photo.key), photo.file.buffer, { flag: 'wx' });
        written.push(photo.key);
      }
      created = await this.db.$transaction(async (tx) => {
        await requireCapacity(tx, 'products');
        const existingCategory = await tx.categoria.findFirst({
          where: { nombre: { equals: data.tipoPrenda, mode: 'insensitive' } },
        });
        const category =
          existingCategory ??
          (await tx.categoria.create({
            data: {
              nombre: data.tipoPrenda,
              descripcion: 'Tipo de prenda del catálogo',
              activa: true,
            },
          }));
        const product = await tx.producto.create({
          data: {
            categoria_id: category.id,
            nombre: data.nombre,
            descripcion: data.descripcion,
            material: data.material,
            marca: data.marca,
            estado: 'PUBLICADO',
            creado_en: new Date(),
          },
        });
        const createdVariants = [];
        const now = new Date();
        for (const [index, variant] of variants.entries()) {
          const created = await tx.variante.create({
            data: {
              producto_id: product.id,
              sku: `G18-${randomUUID().replace(/-/g, '').slice(0, 16)}-${index + 1}`,
              talla: variant.talla,
              color: variant.color,
              color_hex: variant.colorHex,
              activa: true,
            },
          });
          createdVariants.push(created);
          await tx.precio_canal.createMany({
            data: (['WEB', 'APP', 'TIENDA'] as const).map((canal) => ({
              variante_id: created.id,
              canal,
              moneda: 'BOB',
              importe: data.precio,
              descuento_pct: 0,
              desde: now,
            })),
          });
        }
        const locations = await tx.ubicacion.findMany({
          where: { activa: true },
          select: { id: true },
        });
        await assignAssortment(
          tx,
          createdVariants.map((variant) => variant.id),
          locations.map((location) => location.id),
        );
        await tx.recurso_catalogo.createMany({
          data: photos.map((photo, index) => ({
            producto_id: product.id,
            clave_objeto: photo.key,
            tipo_mime: photo.mime,
            orden: index,
            texto_alternativo: `${data.nombre}, vista ${index + 1}`,
            licencia: data.licencia,
            uso: 'GALERIA',
            estado: 'PUBLICADO',
          })),
        });
        return {
          id: product.id,
          nombre: product.nombre,
          variantes: createdVariants.map((variant) => variant.id),
          ubicaciones: locations.map((location) => location.id),
          fotos: photos.length,
        };
      });
    } catch (error) {
      await Promise.all(written.map((key) => removeStored(key)));
      throw error;
    }
    for (const locationId of created.ubicaciones)
      this.realtime.inventoryChanged(locationId, {
        variantIds: created.variantes,
        reason: 'catalog-new-product',
      });
    return { ...created, ubicaciones: created.ubicaciones.length };
  }

  @Get('ar-resources')
  @UseGuards(AuthGuard)
  async arResources(@Req() r: AuthRequest) {
    requirePermission(r.user, 'catalogo:gestionar');
    const resources = await this.db.recurso_catalogo.findMany({
      where: { uso: 'AR' },
      include: {
        producto: { select: { nombre: true } },
        variante: { select: { talla: true, color: true } },
      },
      orderBy: { id: 'desc' },
    });
    return resources.map((resource) => ({
      id: resource.id,
      productoId: resource.producto_id,
      varianteId: resource.variante_id,
      producto: resource.producto.nombre,
      talla: resource.variante?.talla,
      color: resource.variante?.color,
      estado: resource.estado,
      textoAlternativo: resource.texto_alternativo,
      licencia: resource.licencia,
      imagePath: publicAssetPath(resource.clave_objeto),
    }));
  }

  @Post('ar-resources')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FileInterceptor('imagen', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3 },
    }),
  )
  async uploadArResource(
    @Req() r: AuthRequest,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    requirePermission(r.user, 'catalogo:gestionar');
    const data = z
      .object({
        varianteId: z.string().uuid(),
        textoAlternativo: z.string().trim().min(5).max(255),
        licencia: z.string().trim().min(3).max(255),
      })
      .strict()
      .parse(body);
    if (!file || file.mimetype !== 'image/png')
      throw new BadRequestException('Sube una imagen PNG con fondo transparente.');
    validateArPng(file.buffer);
    const variant = await this.db.variante.findUnique({
      where: { id: data.varianteId },
      select: { producto_id: true },
    });
    if (!variant) throw new NotFoundException('Variante no encontrada.');
    const key = `public/catalog-ar/${randomUUID()}.png`;
    await mkdir(storedPath('public/catalog-ar'), { recursive: true });
    await writeFile(storedPath(key), file.buffer, { flag: 'wx' });
    try {
      return await this.db.recurso_catalogo.create({
        data: {
          producto_id: variant.producto_id,
          variante_id: data.varianteId,
          clave_objeto: key,
          tipo_mime: 'image/png',
          orden: 0,
          texto_alternativo: data.textoAlternativo,
          licencia: data.licencia,
          uso: 'AR',
          estado: 'BORRADOR',
        },
        select: { id: true, estado: true },
      });
    } catch (error) {
      await removeStored(key);
      throw error;
    }
  }

  @Patch('ar-resources/:id')
  @UseGuards(AuthGuard)
  async setArResourceStatus(@Req() r: AuthRequest, @Param('id') id: string, @Body() body: unknown) {
    requirePermission(r.user, 'catalogo:gestionar');
    const resourceId = z.string().uuid().parse(id);
    const { estado } = z
      .object({ estado: z.enum(['BORRADOR', 'PUBLICADO']) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      const resource = await tx.recurso_catalogo.findFirst({
        where: { id: resourceId, uso: 'AR', variante_id: { not: null } },
      });
      if (!resource) throw new NotFoundException('Imagen AR no encontrada.');
      if (estado === 'PUBLICADO') {
        const bytes = await readFile(storedPath(resource.clave_objeto)).catch(() => {
          throw new BadRequestException(
            'El archivo AR no está disponible. Carga la imagen nuevamente.',
          );
        });
        validateArPng(bytes);
        await tx.recurso_catalogo.updateMany({
          where: { variante_id: resource.variante_id, uso: 'AR', estado: 'PUBLICADO' },
          data: { estado: 'BORRADOR' },
        });
      }
      return tx.recurso_catalogo.update({
        where: { id: resource.id },
        data: { estado },
        select: { id: true, estado: true },
      });
    });
  }
  @Post() @UseGuards(AuthGuard) async create(@Req() r: AuthRequest, @Body() body: unknown) {
    requirePermission(r.user, 'catalogo:gestionar');
    const data = z
      .object({
        nombre: z.string().min(2).max(160),
        descripcion: z.string().min(10).max(3000),
        material: z.string().min(2).max(150),
        categoria_id: z.string().uuid(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await requireCapacity(tx, 'products');
      return tx.producto.create({
        data: { ...data, estado: 'BORRADOR', creado_en: new Date() },
      });
    });
  }
}
