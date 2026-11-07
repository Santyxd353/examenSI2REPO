import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import {
  canonicalJson,
  HashSchema,
  moneyToMinor,
  SnapshotDocument,
  SnapshotDocumentSchema,
  SnapshotEntity,
  SnapshotPageSchema,
  UuidSchema,
} from '@lumina/contracts';
import { Db } from '../db';
import { AuthRequest } from '../auth';
import { currentTenant } from '../tenancy/context';
import { DeviceKeysService } from './device-keys.service';
import { readStoredFile, writePrivateDocument } from './private-files';
const LIMIT = 50000;
const MAX_SNAPSHOT_BYTES = 200 * 1024 * 1024;
const querySchema = z.strictObject({
  deviceId: UuidSchema,
  cursor: z.string().min(1).max(3000).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});
const cursorSchema = z.strictObject({
  snapshotId: UuidSchema,
  scopeHash: HashSchema,
  documentHash: HashSchema,
  offset: z.number().int().min(1).max(LIMIT),
  pageSize: z.number().int().min(1).max(500),
});
const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const signature = (value: string) =>
  createHmac('sha256', process.env.JWT_SECRET!)
    .update('offline-snapshot-v1:' + value)
    .digest('base64url');
const invalidCursor = () =>
  new BadRequestException({
    code: 'INVALID_SNAPSHOT_CURSOR',
    message: 'La página no corresponde a esta identidad o descarga. Inicia una descarga nueva.',
  });

@Injectable()
export class SnapshotService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(DeviceKeysService) private keys: DeviceKeysService,
  ) {}
  private async scope(tx: Prisma.TransactionClient, request: AuthRequest, deviceId: string) {
    const actor = request.user,
      inventory = actor.permissions.includes('inventario:gestionar');
    const locations = inventory
      ? await tx.ubicacion.findMany({
          where: {
            activa: true,
            ...(actor.roles.includes('Administrador') ||
            actor.permissions.includes('ubicaciones:gestionar')
              ? {}
              : { usuario_ubicacion: { some: { usuario_id: actor.id } } }),
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        })
      : [];
    return {
      tenantId: currentTenant()!.id,
      actorId: actor.id,
      deviceId,
      channel: request.headers['x-client-channel'] === 'APP' ? ('APP' as const) : ('WEB' as const),
      permissions: [...actor.permissions].sort(),
      locationIds: locations.map((l) => l.id),
    };
  }
  private async capture(request: AuthRequest, deviceId: string): Promise<SnapshotDocument> {
    return this.db.$transaction(
      async (tx) => {
        const [{ at }] = await tx.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
        const scope = await this.scope(tx, request, deviceId);
        const manage = request.user.permissions.includes('catalogo:gestionar'),
          inventory = request.user.permissions.includes('inventario:gestionar');
        const productFilter: Prisma.productoWhereInput =
          manage || inventory ? {} : { estado: 'PUBLICADO', categoria: { activa: true } };
        const variantFilter: Prisma.varianteWhereInput = {
          producto: productFilter,
          ...(manage || inventory ? {} : { activa: true }),
        };
        const stockFilter: Prisma.inventarioWhereInput = {
          ubicacion_id: { in: scope.locationIds },
          variante: variantFilter,
        };
        const categoryFilter: Prisma.categoriaWhereInput =
          manage || inventory ? {} : { activa: true };
        const counts = await Promise.all([
          tx.categoria.count({ where: categoryFilter }),
          tx.ubicacion.count({ where: { id: { in: scope.locationIds } } }),
          tx.producto.count({ where: productFilter }),
          tx.variante.count({ where: variantFilter }),
          inventory ? tx.inventario.count({ where: stockFilter }) : Promise.resolve(0),
        ]);
        const total = counts.reduce((sum, count) => sum + count, 0),
          entities: SnapshotEntity[] = [];
        const take = () => Math.max(0, LIMIT - entities.length);
        const categories = await tx.categoria.findMany({
          where: categoryFilter,
          orderBy: { id: 'asc' },
          take: take(),
        });
        for (const c of categories)
          entities.push({ kind: 'CATEGORY', id: c.id, name: c.nombre, active: c.activa });
        const locations = await tx.ubicacion.findMany({
          where: { id: { in: scope.locationIds } },
          orderBy: { id: 'asc' },
          take: take(),
        });
        for (const l of locations)
          entities.push({
            kind: 'LOCATION',
            id: l.id,
            version: l.version,
            name: l.nombre,
            type: l.tipo as 'TIENDA' | 'ALMACEN',
            active: l.activa,
            parentId: l.padre_id,
          });
        const products = await tx.producto.findMany({
          where: productFilter,
          orderBy: { id: 'asc' },
          take: take(),
        });
        for (const p of products)
          entities.push({
            kind: 'PRODUCT',
            id: p.id,
            version: p.version,
            name: p.nombre,
            description: p.descripcion,
            material: p.material,
            brand: p.marca,
            collection: p.coleccion,
            categoryId: p.categoria_id,
            state: p.estado as 'BORRADOR' | 'PUBLICADO' | 'RETIRADO',
          });
        const variants = await tx.variante.findMany({
          where: variantFilter,
          orderBy: { id: 'asc' },
          take: take(),
          include: {
            precio_canal: {
              where: {
                ...(manage || inventory ? {} : { canal: scope.channel }),
                OR: [{ hasta: null }, { hasta: { gt: at } }],
              },
              orderBy: [{ canal: 'asc' }, { desde: 'asc' }],
            },
          },
        });
        for (const v of variants)
          entities.push({
            kind: 'VARIANT',
            id: v.id,
            version: v.version,
            productId: v.producto_id,
            sku: v.sku,
            barcode: v.codigo_barras,
            size: v.talla,
            color: v.color,
            colorHex: v.color_hex,
            active: v.activa,
            prices: v.precio_canal.map((p) => ({
              channel: p.canal as 'WEB' | 'APP' | 'TIENDA',
              baseMinor: moneyToMinor(p.importe.toFixed(2)),
              discountBasisPoints: Number(p.descuento_pct.mul(100).toFixed(0)),
              startsAt: p.desde.toISOString(),
              endsAt: p.hasta?.toISOString() ?? null,
            })),
          });
        if (inventory) {
          const stocks = await tx.inventario.findMany({
            where: stockFilter,
            orderBy: { id: 'asc' },
            take: take(),
          });
          for (const s of stocks)
            entities.push({
              kind: 'STOCK',
              id: s.id,
              version: s.version,
              variantId: s.variante_id,
              locationId: s.ubicacion_id,
              physical: s.fisico,
              reserved: s.reservado,
              committed: s.comprometido,
              available: s.fisico - s.reservado - s.comprometido,
            });
        }
        return SnapshotDocumentSchema.parse({
          schemaVersion: '1.0',
          snapshotId: randomUUID(),
          asOf: at.toISOString(),
          expiresAt: new Date(at.getTime() + 24 * 3600000).toISOString(),
          scope,
          coverage: {
            complete: total <= LIMIT,
            truncated: total > LIMIT,
            rowCount: entities.length,
            totalKnownRows: total,
            limit: LIMIT,
            omissions:
              total > LIMIT
                ? [
                    'El límite de 50000 entidades deja esta descarga incompleta; los saldos ausentes no son cero.',
                  ]
                : [],
          },
          entities,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30000 },
    );
  }
  async page(request: AuthRequest, raw: unknown) {
    const query = querySchema.parse(raw);
    await this.keys.registered(request.user.id, query.deviceId);
    const scope = await this.db.$transaction((tx) => this.scope(tx, request, query.deviceId));
    let document: SnapshotDocument,
      sha256: string,
      offset = 0,
      pageSize = query.pageSize;
    if (query.cursor) {
      let cursor: z.infer<typeof cursorSchema>;
      try {
        const [payload, mac, extra] = query.cursor.split('.');
        if (!payload || !mac || extra || !/^[a-zA-Z0-9_-]+$/.test(payload)) throw invalidCursor();
        const expected = Buffer.from(signature(payload));
        const supplied = Buffer.from(mac);
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
          throw invalidCursor();
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
        if (cursor.scopeHash !== digest(scope)) throw invalidCursor();
      } catch {
        throw invalidCursor();
      }
      const key = `private/offline/snapshots/${scope.actorId}/${cursor.snapshotId}.json`;
      let bytes: Buffer;
      try {
        bytes = await readStoredFile(key, MAX_SNAPSHOT_BYTES);
      } catch {
        throw new NotFoundException('La descarga ya no está disponible. Inicia una nueva.');
      }
      sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== cursor.documentHash)
        throw new GoneException({
          code: 'SNAPSHOT_CHANGED',
          message: 'El corte guardado cambió. Inicia una descarga nueva.',
        });
      document = SnapshotDocumentSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (document.snapshotId !== cursor.snapshotId || digest(document.scope) !== digest(scope))
        throw invalidCursor();
      if (Date.parse(document.expiresAt) <= Date.now())
        throw new GoneException({
          code: 'SNAPSHOT_EXPIRED',
          message: 'La descarga venció. Inicia una nueva para actualizar el corte.',
        });
      offset = cursor.offset;
      pageSize = cursor.pageSize;
      if (offset >= document.entities.length) throw invalidCursor();
    } else {
      document = await this.capture(request, query.deviceId);
      // Check no scope change slipped in between the initial authorization and the database snapshot.
      if (digest(document.scope) !== digest(scope)) throw invalidCursor();
      sha256 = digest(document);
      await writePrivateDocument(
        `private/offline/snapshots/${scope.actorId}/${document.snapshotId}.json`,
        document,
        MAX_SNAPSHOT_BYTES,
      );
    }
    const entities = document.entities.slice(offset, offset + pageSize),
      nextOffset = offset + entities.length;
    const payload =
      nextOffset < document.entities.length
        ? Buffer.from(
            canonicalJson({
              snapshotId: document.snapshotId,
              scopeHash: digest(document.scope),
              documentHash: sha256,
              offset: nextOffset,
              pageSize,
            }),
          ).toString('base64url')
        : null;
    return SnapshotPageSchema.parse({
      ...document,
      entities,
      sha256,
      pageHash: digest(entities),
      offset,
      pageSize,
      nextCursor: payload ? payload + '.' + signature(payload) : null,
    });
  }
}
