import { GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  ArPlacementSchema,
  OutfitManifest,
  OutfitManifestSchema,
  OutfitPreferencesSchema,
  OutfitRequestSchema,
  TimestampSchema,
  UuidSchema,
} from '@lumina/contracts';
import { AuthRequest } from '../auth';
import { Db } from '../db';
import { storedPath } from '../storage';
import { currentTenant } from '../tenancy/context';
import { validatePersonalGlb } from '../avatars/validate-glb';
import { DeviceKeysService } from './device-keys.service';
import { fileHash, inspectGarmentGlb, inspectImage } from './resource-integrity';
import { readStoredFile, writePrivateDocument } from './private-files';

const MAX_MODEL = 50 * 1024 * 1024;
const MAX_PNG = 5 * 1024 * 1024;
const PACKAGE_LIMIT = 10;
const VALIDATION_LIMIT = 100;
const TTL = 24 * 3600000;
const savedPackage = z.strictObject({
  deviceId: UuidSchema,
  expiresAt: TimestampSchema,
  manifest: OutfitManifestSchema,
});
const downloadQuery = z.strictObject({ deviceId: UuidSchema });
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
const jsonRecord = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const packageKey = (actorId: string, packageId: string) =>
  `private/offline/outfits/${actorId}/${packageId}.json`;
const unavailable = () => new NotFoundException('Archivo o paquete offline no disponible.');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

@Injectable()
export class OutfitsService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(DeviceKeysService) private devices: DeviceKeysService,
  ) {}

  private approvedAvatar(actorId: string) {
    return this.db.avatar.findFirst({
      where: {
        usuario_id: actorId,
        estado: 'APROBADO',
        clave_glb: { not: null },
        plantilla_corporal: { activa: true, esqueleto_version: 'g18-1' },
      },
      orderBy: [{ version: 'desc' }, { id: 'asc' }],
    });
  }

  async create(request: AuthRequest, raw: unknown) {
    const { deviceId, platform, includeOwnAvatar } = OutfitRequestSchema.parse(raw);
    const ownerId = request.user.id,
      tenantId = currentTenant()!.id;
    await this.devices.registered(ownerId, deviceId);
    const now = new Date(),
      web = platform === 'WEB_3D';
    const [user, history, avatar, template] = await Promise.all([
      this.db.usuario.findUniqueOrThrow({ where: { id: ownerId }, select: { preferencias: true } }),
      this.db.evento_vestidor.findMany({
        where: {
          tipo: 'PRUEBA',
          variante_id: { not: null },
          sesion_vestidor: { usuario_id: ownerId },
        },
        orderBy: [{ ocurrido_en: 'desc' }, { id: 'asc' }],
        take: 250,
        select: { variante_id: true },
      }),
      web ? this.approvedAvatar(ownerId) : null,
      web
        ? this.db.plantilla_corporal.findFirst({
            where: { activa: true, esqueleto_version: 'g18-1' },
            orderBy: { id: 'asc' },
            select: { id: true },
          })
        : null,
    ]);
    const parsedPreferences = OutfitPreferencesSchema.safeParse(
      jsonRecord(user.preferencias).vestidor ?? {},
    );
    const preferences = parsedPreferences.success
      ? parsedPreferences.data
      : OutfitPreferencesSchema.parse({});
    const brands = new Set(preferences.brands.map(normalized)),
      sizes = new Set(preferences.sizes.map(normalized)),
      colors = new Set(preferences.colors.map(normalized));
    const categoryIds = new Set(preferences.categoryIds);
    const favorites = new Set(preferences.favoriteProductIds);
    const interactions = new Map<string, number>();
    for (const event of history)
      if (event.variante_id)
        interactions.set(event.variante_id, (interactions.get(event.variante_id) ?? 0) + 1);
    const channel = web ? 'WEB' : 'APP';
    const modelFilter = {
      estado: 'PUBLICADO',
      plantilla_id: avatar?.plantilla_id ?? template?.id ?? '00000000-0000-0000-0000-000000000000',
    };
    const arFilter = { uso: 'AR', estado: 'PUBLICADO', tipo_mime: 'image/png' };
    const eligible: Prisma.varianteWhereInput = {
      activa: true,
      producto: { estado: 'PUBLICADO', categoria: { activa: true } },
      precio_canal: {
        some: {
          canal: channel,
          desde: { lte: now },
          OR: [{ hasta: null }, { hasta: { gt: now } }],
        },
      },
      disponibilidad_canal: {
        some: { canal: channel, habilitada: true, ubicacion: { activa: true } },
      },
      ...(web
        ? { modelo_prenda: { some: modelFilter } }
        : { recurso_catalogo: { some: arFilter } }),
    };
    const candidates = await this.db.variante.findMany({
      where: eligible,
      orderBy: [{ producto_id: 'asc' }, { id: 'asc' }],
      take: 50001,
      select: {
        id: true,
        talla: true,
        color: true,
        color_hex: true,
        version: true,
        producto: {
          select: {
            id: true,
            nombre: true,
            version: true,
            marca: true,
            categoria_id: true,
            categoria: { select: { nombre: true } },
          },
        },
        modelo_prenda: {
          where: modelFilter,
          orderBy: [{ version: 'desc' }, { id: 'asc' }],
          take: web ? 1 : 0,
        },
        recurso_catalogo: {
          where: arFilter,
          orderBy: [{ orden: 'asc' }, { id: 'asc' }],
          take: web ? 0 : 1,
        },
      },
    });
    const score = (variant: (typeof candidates)[number]) =>
      (sizes.has(normalized(variant.talla)) ? 1000 : normalized(variant.talla) === 'm' ? 1 : 0) +
      (favorites.has(variant.producto.id) ? 500 : 0) +
      (brands.has(normalized(variant.producto.marca ?? '')) ? 120 : 0) +
      (categoryIds.has(variant.producto.categoria_id) ? 100 : 0) +
      (colors.has(normalized(variant.color)) ? 60 : 0) +
      Math.min(30, (interactions.get(variant.id) ?? 0) * 3);
    const ranked = candidates
      .slice(0, 50000)
      .map((variant) => ({ variant, score: score(variant) }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          compare(a.variant.producto.id, b.variant.producto.id) ||
          compare(a.variant.id, b.variant.id),
      );
    const packageId = randomUUID(),
      expiresAt = new Date(now.getTime() + TTL).toISOString();
    const url = (id: string) =>
      `/api/offline/outfits/${packageId}/files/${id}?deviceId=${deviceId}`;
    const garments: OutfitManifest['garments'] = [];
    const chosen = new Set<string>();
    const inspected = new Map<string, { bytes: number; sha256: string } | null>();
    let invalid = 0,
      attempts = 0;
    for (const { variant } of ranked) {
      if (garments.length === PACKAGE_LIMIT || attempts === VALIDATION_LIMIT) break;
      const product = variant.producto;
      if (chosen.has(product.id)) continue;
      attempts++;
      const model = variant.modelo_prenda[0],
        image = variant.recurso_catalogo[0];
      const resource = web ? model : image,
        key = web ? model?.clave_glb : image?.clave_objeto;
      if (!resource || !key || resource.licencia.trim().length < 3) {
        invalid++;
        continue;
      }
      const cacheKey = key + ':' + platform;
      if (!inspected.has(cacheKey)) {
        try {
          const bytes = await readStoredFile(key, web ? MAX_MODEL : MAX_PNG);
          if (web) await inspectGarmentGlb(bytes);
          else await inspectImage(bytes, 'image/png', true);
          inspected.set(cacheKey, { bytes: bytes.length, sha256: fileHash(bytes) });
        } catch {
          inspected.set(cacheKey, null);
        }
      }
      const integrity = inspected.get(cacheKey);
      const approvedHash = jsonRecord(model?.ajuste).sha256;
      if (
        !integrity ||
        (web &&
          (integrity.bytes !== model.bytes || (approvedHash && integrity.sha256 !== approvedHash)))
      ) {
        invalid++;
        continue;
      }
      const placement = web ? undefined : this.placement(image.embedding, product.categoria.nombre);
      if (!web && !placement) {
        invalid++;
        continue;
      }
      chosen.add(product.id);
      garments.push({
        productId: product.id,
        variantId: variant.id,
        catalogVersion: product.version,
        resourceId: resource.id,
        resourceVersion: web ? model.version : variant.version,
        format: web ? 'GLB' : 'PNG',
        privateDownloadUrl: url(resource.id),
        ...integrity,
        compatibility: web ? 'g18-1 · silueta aproximada' : 'torso-v1 · superposición AR',
        license: resource.licencia,
        required: true,
        ...(placement ? { placement } : {}),
        productName: product.nombre,
        size: variant.talla,
        color: variant.color,
        colorHex: variant.color_hex,
      });
    }
    const limitations: string[] = [];
    if (garments.length < PACKAGE_LIMIT)
      limitations.push(
        `Se encontraron ${garments.length} prendas compatibles verificadas de hasta ${PACKAGE_LIMIT}.`,
      );
    if (invalid)
      limitations.push('Se omitieron recursos faltantes, dañados o sin compatibilidad verificada.');
    if (
      candidates.length > 50000 ||
      (attempts === VALIDATION_LIMIT && garments.length < PACKAGE_LIMIT)
    )
      limitations.push(
        'Se alcanzó el límite de búsqueda. Actualiza el catálogo y genera otra descarga.',
      );
    let optionalOwnAvatar: OutfitManifest['optionalOwnAvatar'] = null;
    if (includeOwnAvatar && avatar?.clave_glb) {
      try {
        const height = z
          .number()
          .min(100)
          .max(230)
          .parse(jsonRecord(jsonRecord(avatar.medidas).altura).valor_cm);
        await validatePersonalGlb(storedPath(avatar.clave_glb), height);
        const bytes = await readStoredFile(avatar.clave_glb, MAX_MODEL);
        optionalOwnAvatar = {
          avatarId: avatar.id,
          version: avatar.version,
          sha256: fileHash(bytes),
          bytes: bytes.length,
          privateDownloadUrl: url(avatar.id),
          consented: true,
        };
      } catch {
        /* An unavailable personal model must never be replaced with a reference model. */
      }
    }
    if (includeOwnAvatar && !optionalOwnAvatar)
      limitations.push('No hay un avatar personal aprobado que se pueda descargar.');
    const personalized =
      brands.size || sizes.size || colors.size || categoryIds.size || favorites.size;
    const preferencesBasis = [
      personalized
        ? 'Gustos, tallas y favoritos indicados en el perfil'
        : 'Reglas de compatibilidad y talla disponible',
      interactions.size ? 'historial de pruebas de esta cuenta' : 'sin historial de pruebas',
    ].join(' · ');
    const manifest = OutfitManifestSchema.parse({
      packageId,
      tenantId,
      ownerId,
      platform,
      createdAt: now.toISOString(),
      expiresAt,
      manifestVersion: '1.0',
      preferencesBasis,
      garmentCount: garments.length,
      state: garments.length ? 'COMPLETO' : 'PARCIAL',
      garments,
      optionalOwnAvatar,
      limitations,
    });
    await writePrivateDocument(packageKey(ownerId, packageId), { deviceId, expiresAt, manifest });
    return manifest;
  }

  private placement(embedding: unknown, categoryName: string) {
    const metadata = ArPlacementSchema.safeParse(jsonRecord(embedding).placement);
    if (metadata.success) return metadata.data;
    const name = normalized(categoryName);
    const kind = /^(vestidos?|dresses?)\b/.test(name)
      ? 'dress'
      : /^(faldas?|skirts?)\b/.test(name)
        ? 'skirt'
        : /^(tops?|blusas?|camisetas?)\b/.test(name)
          ? 'top'
          : null;
    return kind ? { algorithm: 'torso-v1' as const, kind } : undefined;
  }

  async load(request: AuthRequest, id: string, raw: unknown) {
    const packageId = UuidSchema.parse(id),
      { deviceId } = downloadQuery.parse(raw);
    await this.devices.registered(request.user.id, deviceId);
    let saved: z.infer<typeof savedPackage>;
    try {
      saved = savedPackage.parse(
        JSON.parse(
          (await readStoredFile(packageKey(request.user.id, packageId), 65536)).toString('utf8'),
        ),
      );
    } catch {
      throw unavailable();
    }
    const { manifest } = saved;
    if (
      saved.deviceId !== deviceId ||
      manifest.ownerId !== request.user.id ||
      manifest.tenantId !== currentTenant()!.id ||
      manifest.packageId !== packageId
    )
      throw unavailable();
    if (Date.parse(saved.expiresAt) <= Date.now())
      throw new GoneException({
        code: 'OUTFIT_EXPIRED',
        message: 'El plazo de descarga venció. Genera un paquete nuevo.',
      });
    return manifest;
  }

  async status(request: AuthRequest, id: string, raw: unknown) {
    const manifest = await this.load(request, id, raw),
      saved = manifest.optionalOwnAvatar;
    const avatar = saved ? await this.approvedAvatar(request.user.id) : null;
    if (saved && (!avatar || avatar.id !== saved.avatarId || avatar.version !== saved.version)) {
      return {
        ...manifest,
        optionalOwnAvatar: null,
        limitations: [
          ...(manifest.limitations ?? []),
          'El avatar anterior ya no está disponible. Elimina su copia local.',
        ],
      };
    }
    return manifest;
  }

  async file(request: AuthRequest, packageId: string, rawId: string, raw: unknown) {
    const id = UuidSchema.parse(rawId),
      manifest = await this.load(request, packageId, raw);
    const model = manifest.optionalOwnAvatar;
    const expected =
      model?.avatarId === id ? model : manifest.garments.find((g) => g.resourceId === id);
    if (!expected) throw unavailable();
    let key: string | null | undefined;
    const web = manifest.platform === 'WEB_3D';
    if ('avatarId' in expected) {
      const avatar = await this.approvedAvatar(request.user.id);
      if (avatar?.id === id && avatar.version === expected.version) key = avatar.clave_glb;
    } else {
      const publishedVariant = {
        id: expected.variantId,
        activa: true,
        producto: { id: expected.productId, estado: 'PUBLICADO', categoria: { activa: true } },
      };
      if (web)
        key = (
          await this.db.modelo_prenda.findFirst({
            where: {
              id,
              version: expected.resourceVersion,
              estado: 'PUBLICADO',
              variante: publishedVariant,
              plantilla_corporal: { activa: true, esqueleto_version: 'g18-1' },
            },
          })
        )?.clave_glb;
      else
        key = (
          await this.db.recurso_catalogo.findFirst({
            where: {
              id,
              producto_id: expected.productId,
              uso: 'AR',
              estado: 'PUBLICADO',
              tipo_mime: 'image/png',
              variante: publishedVariant,
            },
          })
        )?.clave_objeto;
    }
    if (!key) throw unavailable();
    let bytes: Buffer;
    try {
      bytes = await readStoredFile(key, web ? MAX_MODEL : MAX_PNG);
    } catch {
      throw unavailable();
    }
    if (bytes.length !== expected.bytes || fileHash(bytes) !== expected.sha256)
      throw new GoneException({
        code: 'OUTFIT_RESOURCE_CHANGED',
        message: 'El archivo cambió. Descarga un paquete actualizado.',
      });
    return { bytes, mime: web ? 'model/gltf-binary' : 'image/png' };
  }
}
