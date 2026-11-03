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
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { PNG } from 'pngjs';
import { z } from 'zod';
import { Db } from './db';
import { AuthGuard, AuthRequest, AuthService, requirePermission } from './auth';
import { removeStored, storedPath, publicAssetPath } from './storage';
import { assignAssortment } from './assortment';
import { RealtimeGateway } from './realtime';
import { requireCapacity } from './tenancy/capacity';
import {
  CatalogEditSchema,
  CatalogArchiveSchema,
  CatalogProductSchema,
  UuidSchema,
} from '@lumina/contracts';
import { catalogDetail, mutateCatalog } from './catalog/catalog.service';
import { Prisma } from '@prisma/client';
import { TenantRegistry } from './tenancy/platform';
import { currentTenant } from './tenancy/context';
import { lockOperation } from './commerce/idempotency';

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
    @Inject(TenantRegistry) private registry: TenantRegistry,
    @Inject(AuthService) private auth: AuthService,
  ) {}
  private async writable<T>(req: AuthRequest, work: () => Promise<T>) {
    const tenant = currentTenant();
    if (!tenant) throw new BadRequestException('Selecciona la tienda.');
    return this.registry.withWriteAccess(tenant, async () => {
      req.user = await this.auth.verify(req.headers.authorization?.replace(/^Bearer /, ''));
      requirePermission(req.user, 'catalogo:gestionar');
      return work();
    });
  }
  private async touchResource(
    tx: Prisma.TransactionClient,
    actorId: string,
    productId: string,
    variantId?: string,
    expected?: number,
  ) {
    await lockOperation(tx, 'catalog', 'mutation');
    const product = await tx.producto.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado.');
    if (expected !== undefined && expected !== product.version)
      throw new ConflictException({
        code: 'VERSION_CONFLICT',
        message: 'La prenda cambió. Recarga su versión antes de editar las fotos.',
        details: { currentVersion: product.version },
      });
    await tx.producto.update({
      where: { id: productId },
      data: { version: { increment: 1 }, actualizado_en: new Date() },
    });
    if (variantId)
      await tx.variante.update({
        where: { id: variantId },
        data: { version: { increment: 1 }, actualizado_en: new Date() },
      });
    await tx.auditoria.create({
      data: {
        actor_id: actorId,
        accion: 'CATALOG_RESOURCE',
        entidad: 'producto',
        entidad_id: productId,
        correlacion: randomUUID(),
        cambios: { variantId: variantId ?? null, previousVersion: product.version },
        creado_en: new Date(),
      },
    });
  }
  @Get('manage')
  @UseGuards(AuthGuard)
  async manage(@Req() r: AuthRequest) {
    requirePermission(r.user, 'catalogo:gestionar');
    const products = await this.db.producto.findMany({
      select: { id: true },
      orderBy: { nombre: 'asc' },
    });
    return {
      products: await Promise.all(products.map((p) => catalogDetail(this.db, p.id))),
      categories: await this.db.categoria.findMany({
        where: { activa: true },
        orderBy: { nombre: 'asc' },
      }),
    };
  }
  @Post('products')
  @UseGuards(AuthGuard)
  async createProduct(@Req() r: AuthRequest, @Body() body: unknown) {
    const product = CatalogProductSchema.parse(body);
    return this.db.$transaction((tx) =>
      mutateCatalog(
        tx,
        { actor: r.user, operationId: randomUUID() },
        { kind: 'CATALOG_CREATE', entityId: product.id, baseVersion: null, payload: { product } },
      ),
    );
  }
  @Patch('products/:id')
  @UseGuards(AuthGuard)
  async editProduct(@Req() r: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    const id = UuidSchema.parse(rawId),
      input = CatalogEditSchema.parse(body);
    return this.db.$transaction((tx) =>
      mutateCatalog(
        tx,
        { actor: r.user, operationId: randomUUID() },
        {
          kind: 'CATALOG_UPDATE',
          entityId: id,
          baseVersion: input.baseVersion,
          payload: { patch: input.patch },
        },
      ),
    );
  }
  @Post('products/:id/archive')
  @UseGuards(AuthGuard)
  async archiveProduct(@Req() r: AuthRequest, @Param('id') rawId: string, @Body() body: unknown) {
    const id = UuidSchema.parse(rawId),
      input = CatalogArchiveSchema.parse(body);
    return this.db.$transaction((tx) =>
      mutateCatalog(
        tx,
        { actor: r.user, operationId: randomUUID() },
        {
          kind: 'CATALOG_ARCHIVE',
          entityId: id,
          baseVersion: input.baseVersion,
          payload: { reason: input.reason },
        },
      ),
    );
  }
  @Post('products/:id/photos')
  @UseGuards(AuthGuard)
  @UseInterceptors(
    FilesInterceptor('fotos', 8, {
      storage: memoryStorage(),
      limits: { files: 8, fileSize: 5 * 1024 * 1024, fields: 2 },
    }),
  )
  async addPhotos(
    @Req() req: AuthRequest,
    @Param('id') rawId: string,
    @Body() raw: unknown,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    requirePermission(req.user, 'catalogo:gestionar');
    const id = UuidSchema.parse(rawId);
    const input = z
      .strictObject({
        baseVersion: z.coerce.number().int().positive(),
        license: z.string().trim().min(3).max(255),
      })
      .parse(raw);
    if (!files?.length) throw new BadRequestException('Selecciona al menos una foto.');
    const photos = files.map((file) => ({ file, ...galleryMime(file), key: '' }));
    const written: string[] = [];
    try {
      return await this.writable(req, async () => {
        await mkdir(storedPath('public/catalog-gallery'), { recursive: true });
        for (const photo of photos) {
          photo.key = `public/catalog-gallery/${randomUUID()}.${photo.extension}`;
          await writeFile(storedPath(photo.key), photo.file.buffer, { flag: 'wx' });
          written.push(photo.key);
        }
        return this.db.$transaction(async (tx) => {
          await this.touchResource(tx, req.user.id, id, undefined, input.baseVersion);
          const count = await tx.recurso_catalogo.count({
            where: { producto_id: id, uso: 'GALERIA', estado: 'PUBLICADO' },
          });
          if (count + photos.length > 30)
            throw new BadRequestException('La galería admite hasta 30 fotos visibles.');
          await tx.recurso_catalogo.createMany({
            data: photos.map((photo, index) => ({
              producto_id: id,
              clave_objeto: photo.key,
              tipo_mime: photo.mime,
              orden: count + index,
              texto_alternativo: `Prenda, vista ${count + index + 1}`,
              licencia: input.license,
              uso: 'GALERIA',
              estado: 'PUBLICADO',
            })),
          });
          return catalogDetail(tx, id);
        });
      });
    } catch (error) {
      await Promise.all(written.map(removeStored));
      throw error;
    }
  }
  @Patch('products/:id/photos/:resourceId')
  @UseGuards(AuthGuard)
  async photoVisibility(
    @Req() req: AuthRequest,
    @Param('id') rawId: string,
    @Param('resourceId') rawResourceId: string,
    @Body() raw: unknown,
  ) {
    requirePermission(req.user, 'catalogo:gestionar');
    const id = UuidSchema.parse(rawId),
      resourceId = UuidSchema.parse(rawResourceId);
    const input = z
      .strictObject({ baseVersion: z.number().int().positive(), visible: z.boolean() })
      .parse(raw);
    return this.db.$transaction(async (tx) => {
      await this.touchResource(tx, req.user.id, id, undefined, input.baseVersion);
      const resource = await tx.recurso_catalogo.findFirst({
        where: { id: resourceId, producto_id: id, uso: 'GALERIA' },
      });
      if (!resource) throw new NotFoundException('Foto no encontrada.');
      if (
        input.visible &&
        resource.estado !== 'PUBLICADO' &&
        (await tx.recurso_catalogo.count({
          where: { producto_id: id, uso: 'GALERIA', estado: 'PUBLICADO' },
        })) >= 30
      )
        throw new BadRequestException('La galería admite hasta 30 fotos visibles.');
      await tx.recurso_catalogo.update({
        where: { id: resourceId },
        data: { estado: input.visible ? 'PUBLICADO' : 'BORRADOR' },
      });
      return catalogDetail(tx, id);
    });
  }
  @Get()
  async list(
    @Query('search') search = '',
    @Query('category') category = '',
    @Query('location') location = '',
    @Query('brand') brand = '',
    @Query('color') color = '',
    @Query('size') size = '',
    @Query('channel') rawChannel = 'WEB',
    @Query('minPriceMinor') minPriceMinor?: string,
    @Query('maxPriceMinor') maxPriceMinor?: string,
    @Query('sort') rawSort = 'featured',
  ) {
    const channel = z.enum(['WEB', 'APP']).catch('WEB').parse(rawChannel.toUpperCase());
    const locationId = z.string().uuid().safeParse(location).success ? location : null;
    const searchFilter = search.trim().slice(0, 100);
    const brandFilter = brand.trim().slice(0, 100);
    const colorFilter = color.trim().slice(0, 50);
    const sizeFilter = size.trim().slice(0, 20);
    const bounds = z
      .object({
        min: z.coerce.number().int().min(0).max(100000000).optional(),
        max: z.coerce.number().int().min(0).max(100000000).optional(),
      })
      .refine(
        (v) => v.min === undefined || v.max === undefined || v.min <= v.max,
        'El precio mínimo no puede superar al máximo.',
      )
      .parse({ min: minPriceMinor, max: maxPriceMinor });
    const sort = z
      .enum(['featured', 'name_asc', 'newest', 'price_asc', 'price_desc'])
      .parse(rawSort);
    const asOf = new Date();
    let priceRank: Map<string, number> | null = null;
    if (bounds.min !== undefined || bounds.max !== undefined || sort.startsWith('price_')) {
      const rows = await this.db.$queryRaw<{ product_id: string; price: Prisma.Decimal }[]>`
        SELECT v.producto_id AS product_id, MIN(current.price) AS price FROM variante v
        JOIN producto p ON p.id=v.producto_id AND p.estado='PUBLICADO'
        CROSS JOIN LATERAL (SELECT ROUND(pc.importe*(1-pc.descuento_pct/100),2)*100 AS price FROM precio_canal pc
          WHERE pc.variante_id=v.id AND pc.canal=${channel} AND pc.desde<=${asOf} AND (pc.hasta IS NULL OR pc.hasta>${asOf}) ORDER BY pc.desde DESC LIMIT 1) current
        WHERE v.activa AND current.price>=${bounds.min ?? 0} AND current.price<=${bounds.max ?? 100000000}
          ${colorFilter ? Prisma.sql`AND LOWER(v.color)=LOWER(${colorFilter})` : Prisma.empty}
          ${sizeFilter ? Prisma.sql`AND LOWER(v.talla)=LOWER(${sizeFilter})` : Prisma.empty}
          ${locationId ? Prisma.sql`AND EXISTS(SELECT 1 FROM disponibilidad_canal d JOIN ubicacion u ON u.id=d.ubicacion_id WHERE d.variante_id=v.id AND d.ubicacion_id=${locationId}::uuid AND d.canal=${channel} AND d.habilitada AND u.activa)` : Prisma.empty}
        GROUP BY v.producto_id`;
      priceRank = new Map(rows.map((row) => [row.product_id, Number(row.price)]));
    }

    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    const compareSizes = (a: string, b: string) => {
      const left = sizeOrder.indexOf(a.toUpperCase());
      const right = sizeOrder.indexOf(b.toUpperCase());
      return (left < 0 ? 999 : left) - (right < 0 ? 999 : right) || a.localeCompare(b, 'es');
    };
    const products = await this.db.producto.findMany({
      where: {
        estado: 'PUBLICADO',
        ...(priceRank ? { id: { in: [...priceRank.keys()] } } : {}),
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
      orderBy:
        sort === 'name_asc' ? { nombre: 'asc' } : { creado_en: sort === 'newest' ? 'desc' : 'asc' },
      include: { categoria: { select: { nombre: true } } },
      ...(priceRank ? {} : { take: 61 }),
    });
    if (priceRank && sort.startsWith('price_'))
      products.sort(
        (a, b) =>
          (priceRank!.get(a.id)! - priceRank!.get(b.id)!) * (sort === 'price_desc' ? -1 : 1) ||
          a.nombre.localeCompare(b.nombre, 'es'),
      );
    const hasMore = products.length > 60;
    const result = [];
    for (const p of products.slice(0, 60)) {
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
        const now = asOf;
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
        const effective = price
          ? price.importe
              .mul(new Prisma.Decimal(100).minus(price.descuento_pct))
              .div(100)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
              .toNumber()
          : null;
        const cents = effective === null ? null : Math.round(effective * 100);
        if (
          price &&
          cents !== null &&
          cents >= (bounds.min ?? 0) &&
          cents <= (bounds.max ?? 100000000)
        )
          disponibles.push({
            ...v,
            precio: effective!,
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
        (!priceRank && !locationId && !brandFilter && !colorFilter && !sizeFilter && !search)
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
      hasMore,
      asOf: asOf.toISOString(),
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
      created = await this.writable(r, () =>
        this.db.$transaction(async (tx) => {
          await lockOperation(tx, 'catalog', 'mutation');
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
        }),
      );
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
      return await this.writable(r, () =>
        this.db.$transaction(async (tx) => {
          await this.touchResource(tx, r.user.id, variant.producto_id, data.varianteId);
          return tx.recurso_catalogo.create({
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
        }),
      );
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
      await this.touchResource(tx, r.user.id, resource.producto_id, resource.variante_id!);
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
