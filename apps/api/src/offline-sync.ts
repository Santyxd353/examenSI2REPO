import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpException,
  Inject,
  Injectable,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuthGuard, AuthRequest, Identity, requirePermission } from './auth';
import { Db } from './db';
import { requireLocationScope } from './locations';

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

const operation = z
  .object({
    operationId: z.string().uuid(),
    kind: z.enum(['CATALOG_CREATE', 'CATALOG_UPDATE', 'CATALOG_ARCHIVE', 'STOCK_COUNT']),
    baseVersion: z.number().int().min(0).nullable(),
    payload: z.string().min(2).max(100000),
  })
  .strict();
const syncRequest = z.object({ deviceId: z.string().uuid(), operations: z.array(operation).min(1).max(50) }).strict();
type OfflineOperation = z.infer<typeof operation>;
type Receipt = { operationId: string; status: 'APPLIED' | 'CONFLICT' | 'REJECTED'; serverVersion?: number; message?: string };
type StoredReceipt = { status: Receipt['status']; server_version: number | null; message: string | null };

@Injectable()
export class OfflineSyncService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private async ensureTables() {
    await this.db.$executeRaw`CREATE TABLE IF NOT EXISTS offline_sync_receipt (
      operation_id uuid PRIMARY KEY, user_id uuid NOT NULL, device_id uuid NOT NULL,
      status varchar(12) NOT NULL, server_version integer, message varchar(500), created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await this.db.$executeRaw`CREATE TABLE IF NOT EXISTS offline_entity_version (
      entity_type varchar(40) NOT NULL, entity_id uuid NOT NULL, version integer NOT NULL,
      PRIMARY KEY (entity_type, entity_id)
    )`;
  }

  private async stored(userId: string, deviceId: string, operationId: string): Promise<Receipt | null> {
    const rows = await this.db.$queryRaw<StoredReceipt[]>`
      SELECT status,server_version,message FROM offline_sync_receipt
      WHERE operation_id=${operationId}::uuid AND user_id=${userId}::uuid AND device_id=${deviceId}::uuid`;
    const receipt = rows[0];
    return receipt
      ? { operationId, status: receipt.status, ...(receipt.server_version === null ? {} : { serverVersion: receipt.server_version }), ...(receipt.message ? { message: receipt.message } : {}) }
      : null;
  }

  private async save(userId: string, deviceId: string, receipt: Receipt) {
    await this.db.$executeRaw`
      INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message)
      VALUES (${receipt.operationId}::uuid,${userId}::uuid,${deviceId}::uuid,${receipt.status},${receipt.serverVersion ?? null},${receipt.message ?? null})
      ON CONFLICT (operation_id) DO NOTHING`;
  }

  private async catalog(user: Identity, item: OfflineOperation, deviceId: string) {
    requirePermission(user, 'catalogo:gestionar');
    const data = catalogPayload.parse(JSON.parse(item.payload));
    const archived = data.archived || data.product.archived;
    return this.db.$transaction(async (tx) => {
      const applied = async (version: number) => {
        const inserted = await tx.$executeRaw`
          INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message)
          VALUES (${item.operationId}::uuid,${user.id}::uuid,${deviceId}::uuid,'APPLIED',${version},NULL)
          ON CONFLICT (operation_id) DO NOTHING`;
        if (inserted !== 1) throw new ConflictException('El identificador de la operación ya existe.');
        return version;
      };
      if (item.kind === 'CATALOG_CREATE') {
        if (item.baseVersion !== null) throw new BadRequestException('Una alta offline no puede declarar versión base.');
        const category = await tx.categoria.findUnique({ where: { id: data.product.categoriaId } });
        if (!category?.activa) throw new BadRequestException('La categoría ya no está disponible.');
        await tx.producto.create({
          data: {
            id: data.product.id,
            categoria_id: data.product.categoriaId,
            nombre: data.product.nombre,
            descripcion: data.product.descripcion,
            material: data.product.material,
            marca: data.product.marca,
            estado: archived ? 'ARCHIVADO' : 'BORRADOR',
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
          estado: archived ? 'ARCHIVADO' : existing.estado,
        },
      });
      if (archived) await tx.variante.updateMany({ where: { producto_id: existing.id }, data: { activa: false } });
      const next = actual + 1;
      await tx.$executeRaw`
        UPDATE offline_entity_version SET version=${next} WHERE entity_type='PRODUCT' AND entity_id=${existing.id}::uuid`;
      return applied(next);
    });
  }

  private async stockCount(user: Identity, item: OfflineOperation, deviceId: string) {
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
        INSERT INTO offline_sync_receipt (operation_id,user_id,device_id,status,server_version,message)
        VALUES (${item.operationId}::uuid,${user.id}::uuid,${deviceId}::uuid,'APPLIED',${updated.version},NULL)
        ON CONFLICT (operation_id) DO NOTHING`;
      if (inserted !== 1) throw new ConflictException('El identificador de la operación ya existe.');
      return updated.version;
    });
  }

  async sync(user: Identity, body: unknown) {
    const input = syncRequest.parse(body);
    await this.ensureTables();
    const receipts: Receipt[] = [];
    for (const item of input.operations) {
      const previous = await this.stored(user.id, input.deviceId, item.operationId);
      if (previous) {
        receipts.push(previous);
        continue;
      }
      try {
        const serverVersion = item.kind === 'STOCK_COUNT'
          ? await this.stockCount(user, item, input.deviceId)
          : await this.catalog(user, item, input.deviceId);
        const receipt: Receipt = { operationId: item.operationId, status: 'APPLIED', serverVersion };
        await this.save(user.id, input.deviceId, receipt);
        receipts.push((await this.stored(user.id, input.deviceId, item.operationId)) ?? receipt);
      } catch (reason) {
        const completed = await this.stored(user.id, input.deviceId, item.operationId);
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
        await this.save(user.id, input.deviceId, receipt);
        receipts.push((await this.stored(user.id, input.deviceId, item.operationId)) ?? receipt);
      }
    }
    return { receipts };
  }
}

@Controller('offline')
@UseGuards(AuthGuard)
export class OfflineSyncController {
  constructor(@Inject(OfflineSyncService) private readonly service: OfflineSyncService) {}
  @Post('sync') sync(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.service.sync(request.user, body);
  }
}
