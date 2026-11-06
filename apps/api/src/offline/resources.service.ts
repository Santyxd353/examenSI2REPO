import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lstat, mkdir, readdir, rename, unlink, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  canonicalJson,
  ResourceStageRequestSchema,
  ResourceStageResponseSchema,
  UuidSchema,
} from '@lumina/contracts';
import { Db } from '../db';
import { AuthRequest, AuthService, requirePermission } from '../auth';
import { TenantRegistry } from '../tenancy/platform';
import { currentTenant } from '../tenancy/context';
import { storedPath } from '../storage';
import { lockOperation } from '../commerce/idempotency';
import { DeviceKeysService } from './device-keys.service';
import { fileHash, invalidResource, ResourceReference, verifyResource } from './resource-integrity';
import { ValidatedCatalogResource } from '../catalog/catalog.service';
import { readStoredFile } from './private-files';
const prefix = 'offline-resource:';
const missing = () =>
  new ServiceUnavailableException({
    code: 'RESOURCE_NOT_STAGED',
    message: 'Sube y verifica el archivo pendiente antes de sincronizar la prenda.',
    retryable: true,
  });
const recordSchema = ResourceStageRequestSchema.extend({
  actorId: UuidSchema,
  expiresAt: z.iso.datetime(),
  validation: z.record(z.string(), z.union([z.string(), z.number()])),
});
type Staged = z.infer<typeof recordSchema>;
const extension = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'model/gltf-binary': 'glb',
};
const fileKey = (reference: ResourceReference) =>
  `private/offline/resources/${reference.clientResourceId}.${extension[reference.mime]}`;
@Injectable()
export class ResourcesService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(DeviceKeysService) private devices: DeviceKeysService,
    @Inject(AuthService) private auth: AuthService,
    @Inject(TenantRegistry) private registry: TenantRegistry,
  ) {}
  async stage(request: AuthRequest, raw: unknown, bytes: Buffer) {
    requirePermission(request.user, 'catalogo:gestionar');
    const input = ResourceStageRequestSchema.parse(raw);
    await this.devices.registered(request.user.id, input.deviceId);
    const validation = await verifyResource(bytes, input.reference);
    return this.registry.withWriteAccess(currentTenant()!, async () => {
      const actor = await this.auth.verify(request.headers.authorization?.replace(/^Bearer /, ''));
      requirePermission(actor, 'catalogo:gestionar');
      return this.db.$transaction(
        async (tx) => {
          await lockOperation(tx, 'offline-resource', input.reference.clientResourceId);
          const key = prefix + input.reference.clientResourceId;
          const old = await tx.configuracion.findUnique({
            where: { clave_version: { clave: key, version: 1 } },
          });
          let record: Staged;
          if (old) {
            record = recordSchema.parse(old.valor);
            if (record.actorId !== actor.id || record.deviceId !== input.deviceId)
              throw new NotFoundException('Recurso no disponible.');
            if (canonicalJson(record.reference) !== canonicalJson(input.reference))
              throw new ConflictException({
                code: 'RESOURCE_ID_REUSED',
                message:
                  'Ese UUID identifica otro contenido o licencia. Crea una referencia nueva.',
              });
          } else
            record = {
              ...input,
              actorId: actor.id,
              expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
              validation,
            };
          const directory = storedPath('private/offline/resources');
          await mkdir(directory, { recursive: true });
          const target = storedPath(fileKey(record.reference)),
            temporary = target + '.' + randomUUID() + '.tmp';
          try {
            await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
            await rename(temporary, target);
          } finally {
            await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'ENOENT') throw error;
            });
          }
          // An expired orphan may be re-uploaded with the exact immutable reference.
          if (Date.parse(record.expiresAt) <= Date.now())
            record.expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
          if (old)
            await tx.configuracion.update({ where: { id: old.id }, data: { valor: record } });
          else
            await tx.configuracion.create({
              data: {
                clave: key,
                version: 1,
                valor: record,
                autor_id: actor.id,
                desde: new Date(),
              },
            });
          return ResourceStageResponseSchema.parse({
            reference: record.reference,
            state: 'VERIFIED',
            expiresAt: record.expiresAt,
          });
        },
        { timeout: 15000 },
      );
    });
  }
  private async referenced(tx: Prisma.TransactionClient, key: string) {
    return (
      (await tx.recurso_catalogo.count({ where: { clave_objeto: key } })) +
      (await tx.modelo_prenda.count({ where: { clave_glb: key } }))
    );
  }
  async resolve(
    tx: Prisma.TransactionClient,
    actorId: string,
    deviceId: string,
    reference: ResourceReference,
  ): Promise<ValidatedCatalogResource> {
    await lockOperation(tx, 'offline-resource', reference.clientResourceId);
    const row = await tx.configuracion.findUnique({
      where: { clave_version: { clave: prefix + reference.clientResourceId, version: 1 } },
    });
    if (!row) throw missing();
    const record = recordSchema.parse(row.valor);
    if (record.actorId !== actorId || record.deviceId !== deviceId)
      throw new NotFoundException('Recurso no disponible.');
    if (canonicalJson(record.reference) !== canonicalJson(reference))
      throw new ConflictException({
        code: 'RESOURCE_MISMATCH',
        message: 'El recurso validado no coincide con la intención.',
      });
    const key = fileKey(reference);
    if (Date.parse(record.expiresAt) <= Date.now() && !(await this.referenced(tx, key)))
      throw missing();
    let bytes: Buffer;
    try {
      bytes = await readStoredFile(key, reference.bytes);
    } catch {
      throw missing();
    }
    if (bytes.length !== reference.bytes || fileHash(bytes) !== reference.sha256) throw missing();
    if (reference.usage !== 'WEB_3D') return { reference, key };
    const template = await tx.plantilla_corporal.findFirst({
      where: { esqueleto_version: 'g18-1', activa: true },
      orderBy: { id: 'asc' },
    });
    if (!template || typeof record.validation.triangles !== 'number') throw missing();
    return {
      reference,
      key,
      model: {
        templateId: template.id,
        triangles: record.validation.triangles,
        adjustment: {
          plantilla: 'g18-1',
          unidad: 'metros',
          representacion: 'aproximada',
          sha256: reference.sha256,
        },
      },
    };
  }
  async media(request: AuthRequest, id: string) {
    const resourceId = UuidSchema.parse(id);
    const product = { include: { categoria: true } } as const;
    const resource = await this.db.recurso_catalogo.findUnique({
      where: { id: resourceId },
      include: { producto: product, variante: { select: { activa: true } } },
    });
    const model = resource
      ? null
      : await this.db.modelo_prenda.findUnique({
          where: { id: resourceId },
          include: { variante: { include: { producto: product } } },
        });
    if (!resource && !model) throw new NotFoundException();
    const productRow = resource?.producto ?? model!.variante.producto;
    const published =
      productRow.estado === 'PUBLICADO' &&
      productRow.categoria.activa &&
      (resource
        ? resource.estado === 'PUBLICADO' && resource.variante?.activa !== false
        : model!.estado === 'PUBLICADO' && model!.variante.activa);
    if (!published) {
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      if (!token) throw new NotFoundException();
      const actor = await this.auth.verify(token);
      requirePermission(actor, 'catalogo:gestionar');
    }
    const row = await this.db.configuracion.findUnique({
      where: { clave_version: { clave: prefix + resourceId, version: 1 } },
    });
    if (!row) throw new NotFoundException();
    const record = recordSchema.parse(row.valor),
      key = fileKey(record.reference);
    if (key !== (resource?.clave_objeto ?? model?.clave_glb)) throw new NotFoundException();
    let bytes: Buffer;
    try {
      bytes = await readStoredFile(key, record.reference.bytes);
    } catch {
      throw new NotFoundException();
    }
    if (bytes.length !== record.reference.bytes || fileHash(bytes) !== record.reference.sha256)
      throw missing();
    return { bytes, mime: record.reference.mime };
  }
  async purgeExpired(now = new Date()) {
    const directory = 'private/offline/resources';
    const entries = await readdir(storedPath(directory), { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      },
    );
    let removed = 0;
    for (const entry of entries) {
      const id = UuidSchema.safeParse(entry.name.split('.')[0]);
      if (
        !entry.isFile() ||
        !id.success ||
        !/\.(png|jpg|webp|glb)(\.[a-f0-9-]{36}\.tmp)?$/.test(entry.name)
      )
        continue;
      await this.db.$transaction(async (tx) => {
        await lockOperation(tx, 'offline-resource', id.data);
        const key = directory + '/' + entry.name,
          path = storedPath(key);
        const row = await tx.configuracion.findUnique({
          where: { clave_version: { clave: prefix + id.data, version: 1 } },
        });
        const record = row ? recordSchema.safeParse(row.valor) : null;
        if (record && !record.success) return;
        if (record?.success && fileKey(record.data.reference) === key) {
          if (Date.parse(record.data.expiresAt) > now.getTime() || (await this.referenced(tx, key)))
            return;
        } else if (await this.referenced(tx, key)) return;
        else {
          const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
          });
          if (!info || now.getTime() - info.mtimeMs < 3600000) return;
        }
        try {
          await unlink(path);
          removed++;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        // Retain the small immutable ownership record: a deleted file does not release its UUID.
      });
    }
    return removed;
  }
}
