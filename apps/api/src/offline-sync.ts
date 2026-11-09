import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { z } from 'zod';
import { AuthGuard, AuthRequest, Identity, requirePermission } from './auth';
import { Db } from './db';
import { requireLocationScope } from './locations';
import { assignAssortment } from './assortment';
import { requireCapacity } from './tenancy/capacity';
import { removeStored, storedPath } from './storage';

const product = z
  .object({
    id: z.string().uuid(),
    nombre: z.string().trim().min(2).max(160),
    categoriaId: z.string().uuid(),
    descripcion: z.string().trim().min(10).max(3000),
    material: z.string().trim().min(2).max(150),
    marca: z.string().trim().min(2).max(100).optional(),
    archived: z.boolean(),
    variants: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            talla: z.string().trim().min(1).max(20),
            color: z.string().trim().min(2).max(50),
            priceCents: z.number().int().min(0).max(100000000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

const catalogPayload = z.object({ product, archived: z.boolean() }).strict();
const stockPayload = z
  .object({
    locationId: z.string().uuid(),
    variantId: z.string().uuid(),
    observedPhysical: z.number().int().min(0).max(1000000),
    reason: z.string().trim().min(5).max(400),
  })
  .strict();
const stockDeltaPayload = z
  .object({
    locationId: z.string().uuid(),
    variantId: z.string().uuid(),
    delta: z.number().int().min(-100000).max(100000).refine((value) => value !== 0),
    reason: z.string().trim().min(5).max(400),
  })
  .strict();

const operation = z
  .object({
    operationId: z.string().uuid(),
    kind: z.enum(['CATALOG_CREATE', 'CATALOG_UPDATE', 'CATALOG_ARCHIVE', 'STOCK_DELTA', 'STOCK_COUNT']),
    baseVersion: z.number().int().min(0).nullable(),
    payload: z.string().min(2).max(100000),
  })
  .strict();
const syncRequest = z.object({ deviceId: z.string().uuid(), operations: z.array(operation).min(1).max(50) }).strict();
const offlineResource = z.object({
  clientResourceId: z.string().uuid(),
  productId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  usage: z.literal('GALLERY'),
  license: z.string().trim().min(3).max(255),
}).strict();
type OfflineOperation = z.infer<typeof operation>;
type Receipt = { operationId: string; status: 'APPLIED' | 'CONFLICT' | 'REJECTED'; serverVersion?: number; message?: string };
type StoredReceipt = {
  user_id: string;
  device_id: string;
  status: Receipt['status'];
  server_version: number | null;
  message: string | null;
  request_hash: string | null;
};

const operationHash = (item: OfflineOperation) => createHash('sha256')
  .update(`${item.kind}\n${item.baseVersion ?? 'null'}\n${item.payload}`)
  .digest('hex');

function galleryFile(file: Express.Multer.File) {
  if (file.mimetype === 'image/png' && file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mimeType: 'image/png', extension: 'png' };
  if (file.mimetype === 'image/jpeg' && file.buffer[0] === 255 && file.buffer[1] === 216 && file.buffer[2] === 255)
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (file.mimetype === 'image/webp' && file.buffer.toString('ascii', 0, 4) === 'RIFF' && file.buffer.toString('ascii', 8, 12) === 'WEBP')
    return { mimeType: 'image/webp', extension: 'webp' };
  throw new BadRequestException('El adjunto no coincide con un PNG, JPEG o WebP válido.');
}

@Injectable()
export class OfflineSyncService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async ensureTables() {
    await this.db.$executeRaw`CREATE TABLE IF NOT EXISTS offline_sync_receipt (
      operation_id uuid PRIMARY KEY, user_id uuid NOT NULL, device_id uuid NOT NULL,
      status varchar(12) NOT NULL, server_version integer, message varchar(500), request_hash char(64),
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await this.db.$executeRaw`ALTER TABLE offline_sync_receipt ADD COLUMN IF NOT EXISTS request_hash char(64)`;
    await this.db.$executeRaw`CREATE TABLE IF NOT EXISTS offline_entity_version (
      entity_type varchar(40) NOT NULL, entity_id uuid NOT NULL, version integer NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    )`;
  }

  async stored(userId: string, deviceId: string, operationId: string, requestHash?: string): Promise<Receipt | null> {
    const rows = await this.db.$queryRaw<StoredReceipt[]>`
      SELECT user_id::text,device_id::text,status,server_version,message,request_hash FROM offline_sync_receipt
      WHERE operation_id=${operationId}::uuid`;
    const receipt = rows[0];
    if (receipt && (receipt.user_id !== userId || receipt.device_id !== deviceId))
      throw new ConflictException('El identificador de operación ya pertenece a otra identidad o dispositivo.');
    if (receipt?.request_hash && requestHash && receipt.request_hash.trim() !== requestHash)
      throw new ConflictException('El identificador de operación ya fue usado con un contenido distinto.');
    return receipt
      ? { operationId, status: receipt.status, ...(receipt.server_version === null ? {} : { serverVersion: receipt.server_version }), ...(receipt.message ? { message: receipt.message } : {}) }
      : null;
  }

  private async save(userId: string, deviceId: string, receipt: Receipt, requestHash: string) {
    await this.db.$executeRaw`
      INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message,request_hash)
      VALUES (${receipt.operationId}::uuid,${userId}::uuid,${deviceId}::uuid,${receipt.status},${receipt.serverVersion ?? null},${receipt.message ?? null},${requestHash})
      ON CONFLICT (operation_id) DO NOTHING`;
  }

  private async catalog(user: Identity, item: OfflineOperation, deviceId: string, requestHash: string) {
    requirePermission(user, 'catalogo:gestionar');
    const data = catalogPayload.parse(JSON.parse(item.payload));
    const archived = data.archived || data.product.archived;
    return this.db.$transaction(async (tx) => {
      const applied = async (version: number) => {
        const inserted = await tx.$executeRaw`
          INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message,request_hash)
          VALUES (${item.operationId}::uuid,${user.id}::uuid,${deviceId}::uuid,'APPLIED',${version},NULL,${requestHash})
          ON CONFLICT (operation_id) DO NOTHING`;
        if (inserted !== 1) throw new ConflictException('El identificador de la operación ya existe.');
        return version;
      };
      if (item.kind === 'CATALOG_CREATE') {
        if (item.baseVersion !== null) throw new BadRequestException('Una alta offline no puede declarar versión base.');
        const category = await tx.categoria.findUnique({ where: { id: data.product.categoriaId } });
        if (!category?.activa) throw new BadRequestException('La categoría ya no está disponible.');
        await requireCapacity(tx, 'products');
        await tx.producto.create({
          data: {
            id: data.product.id,
            categoria_id: data.product.categoriaId,
            nombre: data.product.nombre,
            descripcion: data.product.descripcion,
            material: data.product.material,
            marca: data.product.marca,
            estado: archived ? 'RETIRADO' : 'BORRADOR',
            creado_en: new Date(),
          },
        });
        const now = new Date();
        for (const variant of data.product.variants) {
          await tx.variante.create({
            data: {
              id: variant.id,
              producto_id: data.product.id,
              sku: `OFF-${variant.id.replace(/-/g, '').slice(0, 24)}`,
              talla: variant.talla,
              color: variant.color,
              activa: !archived,
            },
          });
          await tx.precio_canal.createMany({
            data: (['WEB', 'APP', 'TIENDA'] as const).map((canal) => ({
              variante_id: variant.id,
              canal,
              moneda: 'BOB',
              importe: variant.priceCents / 100,
              descuento_pct: 0,
              desde: now,
            })),
          });
        }
        const locations = await tx.ubicacion.findMany({ where: { activa: true }, select: { id: true } });
        await assignAssortment(
          tx,
          data.product.variants.map((variant) => variant.id),
          locations.map((location) => location.id),
        );
        await tx.$executeRaw`
          INSERT INTO offline_entity_version (entity_type,entity_id,version)
          VALUES ('PRODUCT',${data.product.id}::uuid,1)`;
        return applied(1);
      }

      const versionRows = await tx.$queryRaw<{ version: number }[]>`
        SELECT version FROM offline_entity_version WHERE entity_type='PRODUCT' AND entity_id=${data.product.id}::uuid FOR UPDATE`;
      const actual = versionRows[0]?.version;
      if (actual === undefined || item.baseVersion === null || actual !== item.baseVersion)
        throw new ConflictException('El catálogo cambió desde la última copia offline.');
      const existing = await tx.producto.findUnique({ where: { id: data.product.id } });
      if (!existing) throw new ConflictException('La prenda ya no existe en el catálogo.');
      await tx.producto.update({
        where: { id: existing.id },
        data: {
          categoria_id: data.product.categoriaId,
          nombre: data.product.nombre,
          descripcion: data.product.descripcion,
          material: data.product.material,
          marca: data.product.marca,
          estado: archived ? 'RETIRADO' : existing.estado,
        },
      });
      if (archived) {
        await tx.variante.updateMany({ where: { producto_id: existing.id }, data: { activa: false } });
      } else {
        const currentVariants = await tx.variante.findMany({ where: { producto_id: existing.id } });
        const requestedIds = data.product.variants.map((variant) => variant.id);
        await tx.variante.updateMany({
          where: { producto_id: existing.id, id: { notIn: requestedIds } },
          data: { activa: false },
        });
        const now = new Date();
        const added: string[] = [];
        for (const variant of data.product.variants) {
          const current = currentVariants.find((entry) => entry.id === variant.id);
          if (current) {
            await tx.variante.update({
              where: { id: current.id },
              data: { talla: variant.talla, color: variant.color, activa: true },
            });
          } else {
            const owner = await tx.variante.findUnique({ where: { id: variant.id } });
            if (owner) throw new ConflictException('Una variante pertenece a otra prenda.');
            await tx.variante.create({
              data: {
                id: variant.id,
                producto_id: existing.id,
                sku: `OFF-${variant.id.replace(/-/g, '').slice(0, 24)}`,
                talla: variant.talla,
                color: variant.color,
                activa: true,
              },
            });
            added.push(variant.id);
          }
          for (const canal of ['WEB', 'APP', 'TIENDA'] as const) {
            const price = await tx.precio_canal.findFirst({
              where: { variante_id: variant.id, canal, hasta: null },
              orderBy: { desde: 'desc' },
            });
            if (price) {
              await tx.precio_canal.update({
                where: { id: price.id },
                data: { importe: variant.priceCents / 100 },
              });
            } else {
              await tx.precio_canal.create({
                data: {
                  variante_id: variant.id,
                  canal,
                  moneda: 'BOB',
                  importe: variant.priceCents / 100,
                  descuento_pct: 0,
                  desde: now,
                },
              });
            }
          }
        }
        if (added.length) {
          const locations = await tx.ubicacion.findMany({ where: { activa: true }, select: { id: true } });
          await assignAssortment(tx, added, locations.map((location) => location.id));
        }
      }
      const next = actual + 1;
      await tx.$executeRaw`
        UPDATE offline_entity_version SET version=${next} WHERE entity_type='PRODUCT' AND entity_id=${existing.id}::uuid`;
      return applied(next);
    });
  }

  private async stockCount(user: Identity, item: OfflineOperation, deviceId: string, requestHash: string) {
    requirePermission(user, 'inventario:gestionar');
    const data = stockPayload.parse(JSON.parse(item.payload));
    if (item.baseVersion === null) throw new BadRequestException('El conteo offline requiere la versión de inventario.');
    await requireLocationScope(this.db, user, data.locationId);
    return this.db.$transaction(async (tx) => {
      const inventory = await tx.inventario.findUnique({
        where: { variante_id_ubicacion_id: { variante_id: data.variantId, ubicacion_id: data.locationId } },
      });
      if (!inventory || inventory.version !== item.baseVersion)
        throw new ConflictException('El inventario cambió desde el conteo offline.');
      if (data.observedPhysical < inventory.reservado + inventory.comprometido)
        throw new BadRequestException('El conteo es menor que el stock reservado o comprometido.');
      const changed = await tx.inventario.updateMany({
        where: { id: inventory.id, version: item.baseVersion },
        data: { fisico: data.observedPhysical, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ConflictException('El inventario fue modificado durante la sincronización.');
      const updated = await tx.inventario.findUniqueOrThrow({ where: { id: inventory.id } });
      await tx.movimiento_stock.create({
        data: {
          inventario_id: inventory.id,
          grupo_operacion: randomUUID(),
          tipo: 'CONTEO',
          delta_fisico: data.observedPhysical - inventory.fisico,
          delta_reservado: 0,
          delta_comprometido: 0,
          conteo_observado: data.observedPhysical,
          motivo: data.reason,
          actor_id: user.id,
          creado_en: new Date(),
        },
      });
      const inserted = await tx.$executeRaw`
        INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message,request_hash)
        VALUES (${item.operationId}::uuid,${user.id}::uuid,${deviceId}::uuid,'APPLIED',${updated.version},NULL,${requestHash})
        ON CONFLICT (operation_id) DO NOTHING`;
      if (inserted !== 1) throw new ConflictException('El identificador de la operación ya existe.');
      return updated.version;
    });
  }

  private async stockDelta(user: Identity, item: OfflineOperation, deviceId: string, requestHash: string) {
    requirePermission(user, 'inventario:gestionar');
    const data = stockDeltaPayload.parse(JSON.parse(item.payload));
    await requireLocationScope(this.db, user, data.locationId);
    return this.db.$transaction(async (tx) => {
      const inventory = await tx.inventario.findUnique({
        where: { variante_id_ubicacion_id: { variante_id: data.variantId, ubicacion_id: data.locationId } },
      });
      if (!inventory) throw new BadRequestException('La variante no pertenece al inventario de esta ubicación.');
      const updated = await tx.$queryRaw<{ id: string; version: number }[]>`
        UPDATE inventario
        SET fisico=fisico+${data.delta}, version=version+1
        WHERE id=${inventory.id}::uuid
          AND (fisico+${data.delta}) >= (reservado+comprometido)
        RETURNING id,version`;
      if (updated.length !== 1)
        throw new BadRequestException('El ajuste dejaría stock disponible negativo.');
      await tx.movimiento_stock.create({
        data: {
          inventario_id: inventory.id,
          grupo_operacion: randomUUID(),
          tipo: 'AJUSTE',
          delta_fisico: data.delta,
          delta_reservado: 0,
          delta_comprometido: 0,
          motivo: data.reason,
          actor_id: user.id,
          creado_en: new Date(),
        },
      });
      const inserted = await tx.$executeRaw`
        INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message,request_hash)
        VALUES (${item.operationId}::uuid,${user.id}::uuid,${deviceId}::uuid,'APPLIED',${updated[0].version},NULL,${requestHash})
        ON CONFLICT (operation_id) DO NOTHING`;
      if (inserted !== 1) throw new ConflictException('El identificador de la operación ya existe.');
      return updated[0].version;
    });
  }

  async sync(user: Identity, body: unknown) {
    const input = syncRequest.parse(body);
    await this.ensureTables();
    const receipts: Receipt[] = [];
    for (const item of input.operations) {
      const requestHash = operationHash(item);
      const previous = await this.stored(user.id, input.deviceId, item.operationId, requestHash);
      if (previous) {
        receipts.push(previous);
        continue;
      }
      try {
        const serverVersion = item.kind === 'STOCK_COUNT'
          ? await this.stockCount(user, item, input.deviceId, requestHash)
          : item.kind === 'STOCK_DELTA'
            ? await this.stockDelta(user, item, input.deviceId, requestHash)
            : await this.catalog(user, item, input.deviceId, requestHash);
        const receipt: Receipt = { operationId: item.operationId, status: 'APPLIED', serverVersion };
        await this.save(user.id, input.deviceId, receipt, requestHash);
        receipts.push((await this.stored(user.id, input.deviceId, item.operationId, requestHash)) ?? receipt);
      } catch (reason) {
        const completed = await this.stored(user.id, input.deviceId, item.operationId, requestHash);
        if (completed) {
          receipts.push(completed);
          continue;
        }
        if (!(reason instanceof HttpException)) throw reason;
        const receipt: Receipt = {
          operationId: item.operationId,
          status: reason instanceof ConflictException ? 'CONFLICT' : 'REJECTED',
          message: reason.message,
        };
        await this.save(user.id, input.deviceId, receipt, requestHash);
        receipts.push((await this.stored(user.id, input.deviceId, item.operationId, requestHash)) ?? receipt);
      }
    }
    return { receipts };
  }
}

@Controller('offline')
@UseGuards(AuthGuard)
export class OfflineSyncController {
  constructor(
    @Inject(OfflineSyncService) private readonly service: OfflineSyncService,
    @Inject(Db) private readonly db: Db,
  ) {}
  @Post('sync') sync(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.service.sync(request.user, body);
  }

  @Get('receipts/:operationId')
  async receipt(
    @Req() request: AuthRequest,
    @Param('operationId') operationId: string,
    @Query('deviceId') deviceId: string,
  ) {
    const ids = z.object({ operationId: z.string().uuid(), deviceId: z.string().uuid() })
      .parse({ operationId, deviceId });
    const receipt = await this.service.stored(request.user.id, ids.deviceId, ids.operationId);
    if (!receipt) throw new NotFoundException('El servidor todavía no tiene un recibo para esta operación.');
    return receipt;
  }

  @Post('resources')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { files: 1, fileSize: 5 * 1024 * 1024, fields: 5 },
  }))
  async resource(
    @Req() request: AuthRequest,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    requirePermission(request.user, 'catalogo:gestionar');
    const input = offlineResource.parse(body);
    if (!file) throw new BadRequestException('Selecciona una imagen para la galería.');
    const actualHash = createHash('sha256').update(file.buffer).digest('hex');
    if (actualHash !== input.sha256.toLowerCase())
      throw new BadRequestException('El SHA-256 del adjunto no coincide con el archivo recibido.');
    const format = galleryFile(file);
    const existing = await this.db.recurso_catalogo.findUnique({ where: { id: input.clientResourceId } });
    if (existing) {
      if (existing.producto_id !== input.productId || existing.tipo_mime !== format.mimeType)
        throw new ConflictException('El identificador del adjunto ya pertenece a otro recurso.');
      const storedHash = createHash('sha256').update(await readFile(storedPath(existing.clave_objeto))).digest('hex');
      if (storedHash !== actualHash) throw new ConflictException('El recurso existente contiene otros bytes.');
      return { resourceId: existing.id, state: 'STAGED', sha256: actualHash };
    }
    const product = await this.db.producto.findUnique({ where: { id: input.productId } });
    if (!product) throw new ConflictException('Sincroniza primero la prenda antes de subir sus imágenes.');
    const key = `public/catalog/offline/${input.clientResourceId}.${format.extension}`;
    const path = storedPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.buffer, { flag: 'wx' });
    try {
      const last = await this.db.recurso_catalogo.aggregate({
        where: { producto_id: input.productId, uso: 'GALERIA' },
        _max: { orden: true },
      });
      await this.db.recurso_catalogo.create({
        data: {
          id: input.clientResourceId,
          producto_id: input.productId,
          clave_objeto: key,
          tipo_mime: format.mimeType,
          orden: (last._max.orden ?? -1) + 1,
          texto_alternativo: `${product.nombre}, imagen de galería`,
          licencia: input.license,
          uso: 'GALERIA',
          estado: 'BORRADOR',
        },
      });
    } catch (reason) {
      await removeStored(key);
      throw reason;
    }
    return { resourceId: input.clientResourceId, state: 'STAGED', sha256: actualHash };
  }
}
