import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  CatalogMutationSchema,
  CatalogVariantSchema,
  ResourceReferenceSchema,
  UuidSchema,
} from '@lumina/contracts';
import { Identity, requirePermission } from '../auth';
import { requireCapacity } from '../tenancy/capacity';
import { lockOperation } from '../commerce/idempotency';
import { assignAssortment } from '../assortment';
import { publicAssetPath } from '../storage';

type Reference = z.infer<typeof ResourceReferenceSchema>;
export type ValidatedCatalogResource = {
  reference: Reference;
  key: string;
  model?: { templateId: string; triangles: number; adjustment: Prisma.InputJsonValue };
};
export type CatalogContext = {
  actor: Identity;
  operationId: string;
  resolveResource?: (reference: Reference) => Promise<ValidatedCatalogResource>;
};
function conflict(code: string, message: string, details?: object): never {
  throw new ConflictException({ code, message, ...(details ? { details } : {}) });
}

async function writePrices(
  tx: Prisma.TransactionClient,
  variant: z.infer<typeof CatalogVariantSchema>,
  now: Date,
) {
  // Future rules have never priced a sale; replace their schedule atomically. Historic rules remain.
  await tx.precio_canal.deleteMany({ where: { variante_id: variant.id, desde: { gte: now } } });
  await tx.precio_canal.updateMany({
    where: {
      variante_id: variant.id,
      desde: { lt: now },
      OR: [{ hasta: null }, { hasta: { gt: now } }],
    },
    data: { hasta: now },
  });
  for (const channel of ['WEB', 'APP', 'TIENDA'] as const) {
    const base = {
      variante_id: variant.id,
      canal: channel,
      moneda: 'BOB',
      importe: new Prisma.Decimal(variant.prices[channel]).div(100),
    };
    const promo = variant.discounts?.[channel];
    if (!promo) {
      await tx.precio_canal.create({ data: { ...base, descuento_pct: 0, desde: now } });
      continue;
    }
    const start = new Date(Math.max(new Date(promo.startsAt).getTime(), now.getTime())),
      end = new Date(promo.endsAt);
    if (end <= start) throw new BadRequestException('La promoción debe terminar en el futuro.');
    if (start > now)
      await tx.precio_canal.create({
        data: { ...base, descuento_pct: 0, desde: now, hasta: start },
      });
    await tx.precio_canal.create({
      data: {
        ...base,
        descuento_pct: new Prisma.Decimal(promo.basisPoints).div(100),
        desde: start,
        hasta: end,
      },
    });
    await tx.precio_canal.create({ data: { ...base, descuento_pct: 0, desde: end } });
  }
}

export async function catalogDetail(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.producto.findUniqueOrThrow({
    where: { id },
    include: {
      categoria: true,
      variante: {
        orderBy: { sku: 'asc' },
        include: { precio_canal: { orderBy: { desde: 'desc' } } },
      },
      recurso_catalogo: true,
    },
  });
  return {
    ...row,
    variantes: row.variante,
    recurso_catalogo: row.recurso_catalogo.map((resource) => ({
      ...resource,
      url: publicAssetPath(resource.clave_objeto),
    })),
  };
}

export async function mutateCatalog(
  tx: Prisma.TransactionClient,
  context: CatalogContext,
  raw: unknown,
) {
  requirePermission(context.actor, 'catalogo:gestionar');
  const operationId = UuidSchema.parse(context.operationId);
  const input = CatalogMutationSchema.parse(raw);
  // Catalog-wide lock also serializes unique SKU/barcode checks, including absent rows.
  await lockOperation(tx, 'catalog', 'mutation');
  await tx.$queryRaw`SELECT id FROM producto WHERE id=${input.entityId}::uuid FOR UPDATE`;
  const previous = await tx.producto.findUnique({ where: { id: input.entityId } });
  const now = new Date();
  if (input.kind === 'CATALOG_CREATE') {
    if (input.baseVersion !== null || input.entityId !== input.payload.product.id)
      throw new BadRequestException('Alta requiere identidad coincidente y versión nula.');
    if (previous) conflict('ENTITY_EXISTS', 'El producto ya existe.');
    await requireCapacity(tx, 'products');
  } else {
    if (!previous) throw new NotFoundException('Producto no encontrado.');
    if (previous.version !== input.baseVersion)
      conflict(
        'VERSION_CONFLICT',
        'El producto cambió. Consulta la versión actual antes de editar.',
        { currentVersion: previous.version },
      );
  }
  if (input.kind === 'CATALOG_ARCHIVE') {
    await tx.producto.update({
      where: { id: input.entityId },
      data: { estado: 'RETIRADO', version: { increment: 1 }, actualizado_en: now },
    });
  } else {
    const patch = input.kind === 'CATALOG_CREATE' ? input.payload.product : input.payload.patch;
    if (
      patch.categoriaId &&
      !(await tx.categoria.findFirst({ where: { id: patch.categoriaId, activa: true } }))
    )
      throw new BadRequestException('Selecciona una categoría activa.');
    const values = {
      nombre: patch.nombre,
      descripcion: patch.descripcion,
      material: patch.material,
      marca: patch.marca,
      coleccion: patch.coleccion,
      categoria_id: patch.categoriaId,
    };
    if (input.kind === 'CATALOG_CREATE') {
      const p = input.payload.product;
      await tx.producto.create({
        data: {
          id: p.id,
          categoria_id: p.categoriaId,
          nombre: p.nombre,
          descripcion: p.descripcion,
          material: p.material,
          marca: p.marca,
          coleccion: p.coleccion,
          estado: 'BORRADOR',
          version: 1,
          creado_en: now,
          actualizado_en: now,
        },
      });
    } else
      await tx.producto.update({
        where: { id: input.entityId },
        data: {
          ...values,
          estado: input.payload.patch.estado,
          version: { increment: 1 },
          actualizado_en: now,
        },
      });
    if (patch.variants) {
      if (new Set(patch.variants.map((v) => v.id)).size !== patch.variants.length)
        throw new BadRequestException('No repitas variantes.');
      for (const variant of [...patch.variants].sort((a, b) => a.id.localeCompare(b.id))) {
        const existing = await tx.variante.findUnique({ where: { id: variant.id } });
        if (existing?.producto_id && existing.producto_id !== input.entityId)
          conflict('FOREIGN_VARIANT', 'La variante pertenece a otra prenda.');
        if (existing ? variant.baseVersion !== existing.version : variant.baseVersion !== null)
          conflict(
            'VERSION_CONFLICT',
            'La variante cambió o requiere una versión nula para el alta.',
            { variantId: variant.id, currentVersion: existing?.version ?? null },
          );
        const barcode = variant.barcode === undefined ? existing?.codigo_barras : variant.barcode;
        const duplicate = await tx.variante.findFirst({
          where: {
            id: { not: variant.id },
            OR: [{ sku: variant.sku }, ...(barcode ? [{ codigo_barras: barcode }] : [])],
          },
        });
        if (duplicate)
          conflict(
            'DUPLICATE_VARIANT_CODE',
            'El SKU o código de barras ya está asignado dentro de esta tienda.',
          );
        const data = {
          sku: variant.sku,
          codigo_barras: barcode,
          talla: variant.talla,
          color: variant.color,
          color_hex: variant.colorHex,
          activa: variant.active,
          actualizado_en: now,
        };
        if (existing)
          await tx.variante.update({
            where: { id: variant.id },
            data: { ...data, version: { increment: 1 } },
          });
        else
          await tx.variante.create({
            data: { ...data, id: variant.id, producto_id: input.entityId, version: 1 },
          });
        await writePrices(tx, variant, now);
        if (!existing) {
          const locations = await tx.ubicacion.findMany({
            where: { activa: true },
            select: { id: true },
          });
          await assignAssortment(
            tx,
            [variant.id],
            locations.map((location) => location.id),
          );
        }
      }
    }
    for (const reference of patch.resources ?? []) {
      if (!context.resolveResource)
        conflict(
          'RESOURCE_NOT_READY',
          'El archivo debe cargarse y validarse antes de guardar la prenda.',
        );
      const validated = await context.resolveResource!(reference);
      if (
        validated.reference.sha256 !== reference.sha256 ||
        validated.reference.bytes !== reference.bytes ||
        validated.reference.clientResourceId !== reference.clientResourceId ||
        validated.reference.mime !== reference.mime ||
        validated.reference.usage !== reference.usage ||
        validated.reference.variantId !== reference.variantId
      )
        conflict('RESOURCE_MISMATCH', 'El archivo no corresponde a la referencia de la operación.');
      if (
        reference.variantId &&
        !(await tx.variante.findFirst({
          where: { id: reference.variantId, producto_id: input.entityId },
        }))
      )
        conflict('FOREIGN_VARIANT', 'El recurso pertenece a otra variante.');
      if (reference.usage === 'WEB_3D') {
        if (!reference.variantId || reference.mime !== 'model/gltf-binary' || !validated.model)
          throw new BadRequestException('El modelo requiere variante y validación 3D.');
        const latest = await tx.modelo_prenda.aggregate({
          where: { variante_id: reference.variantId, plantilla_id: validated.model.templateId },
          _max: { version: true },
        });
        await tx.modelo_prenda.updateMany({
          where: { variante_id: reference.variantId, estado: 'PUBLICADO' },
          data: { estado: 'BORRADOR' },
        });
        await tx.modelo_prenda.create({
          data: {
            id: reference.clientResourceId,
            variante_id: reference.variantId,
            plantilla_id: validated.model.templateId,
            version: (latest._max.version ?? 0) + 1,
            clave_glb: validated.key,
            ajuste: validated.model.adjustment,
            bytes: reference.bytes,
            triangulos: validated.model.triangles,
            licencia: reference.license,
            estado: 'PUBLICADO',
            revisado_por: context.actor.id,
            creado_en: now,
          },
        });
      } else {
        if (
          reference.usage === 'ANDROID_AR' &&
          (!reference.variantId || reference.mime !== 'image/png')
        )
          throw new BadRequestException(
            'AR Android requiere PNG transparente validado y variante.',
          );
        if (reference.usage === 'GALLERY' && !reference.mime.startsWith('image/'))
          throw new BadRequestException('La galería requiere una imagen.');
        const existing = await tx.recurso_catalogo.findUnique({
          where: { id: reference.clientResourceId },
        });
        if (existing) {
          if (existing.producto_id !== input.entityId || existing.clave_objeto !== validated.key)
            conflict('RESOURCE_MISMATCH', 'La referencia ya está asignada.');
          continue;
        }
        if (reference.usage === 'ANDROID_AR')
          await tx.recurso_catalogo.updateMany({
            where: { variante_id: reference.variantId, uso: 'AR', estado: 'PUBLICADO' },
            data: { estado: 'BORRADOR' },
          });
        await tx.recurso_catalogo.create({
          data: {
            id: reference.clientResourceId,
            producto_id: input.entityId,
            variante_id: reference.variantId,
            clave_objeto: validated.key,
            tipo_mime: reference.mime,
            orden: 0,
            texto_alternativo: patch.nombre ?? previous?.nombre ?? 'Prenda femenina',
            licencia: reference.license,
            uso: reference.usage === 'GALLERY' ? 'GALERIA' : 'AR',
            estado: 'PUBLICADO',
          },
        });
      }
    }
    for (const variantId of new Set(
      (patch.resources ?? []).map((ref) => ref.variantId).filter((id): id is string => !!id),
    )) {
      if (!patch.variants?.some((variant) => variant.id === variantId))
        await tx.variante.update({
          where: { id: variantId },
          data: { version: { increment: 1 }, actualizado_en: now },
        });
    }
    const current = await tx.producto.findUniqueOrThrow({ where: { id: input.entityId } });
    if (current.estado === 'PUBLICADO') {
      const active = await tx.variante.findMany({
        where: { producto_id: input.entityId, activa: true },
        include: {
          precio_canal: {
            where: { desde: { lte: now }, OR: [{ hasta: null }, { hasta: { gt: now } }] },
          },
        },
      });
      if (
        !active.length ||
        active.some((v) =>
          ['WEB', 'APP', 'TIENDA'].some(
            (channel) => !v.precio_canal.some((p) => p.canal === channel),
          ),
        )
      )
        throw new BadRequestException(
          'Publicar requiere una variante activa con precios vigentes en los tres canales.',
        );
    }
  }
  await tx.auditoria.create({
    data: {
      actor_id: context.actor.id,
      accion: input.kind,
      entidad: 'producto',
      entidad_id: input.entityId,
      correlacion: operationId,
      cambios: JSON.parse(JSON.stringify(input)),
      motivo: input.kind === 'CATALOG_ARCHIVE' ? input.payload.reason : null,
      creado_en: now,
    },
  });
  return catalogDetail(tx, input.entityId);
}
