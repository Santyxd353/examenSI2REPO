import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  ForbiddenException,
} from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { canonicalJson, UuidSchema } from '@lumina/contracts';
import { Db } from '../db';
import { currentTenant } from '../tenancy/context';
import { lockOperation } from '../commerce/idempotency';

type WrappedKey = {
  schemaVersion: '1.0';
  keyVersion: number;
  wrapVersion: number;
  aad: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'OFFLINE_KEY_UNAVAILABLE',
    message: 'La clave offline no está disponible. Conserva tu copia local y vuelve a intentar.',
    retryable: true,
  });
function keyring() {
  try {
    const version = Number(process.env.OFFLINE_WRAP_KEY_VERSION || '1');
    const raw = process.env.OFFLINE_WRAP_KEYS
      ? JSON.parse(process.env.OFFLINE_WRAP_KEYS)
      : { '1': process.env.OFFLINE_MASTER_KEY };
    const keys = new Map<number, Buffer>();
    if (!Number.isSafeInteger(version) || version < 1 || !raw || Array.isArray(raw))
      throw unavailable();
    for (const [id, value] of Object.entries(raw)) {
      if (
        !/^[1-9][0-9]*$/.test(id) ||
        typeof value !== 'string' ||
        !/^[A-Za-z0-9+/]{43}=$/.test(value)
      )
        throw unavailable();
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value) throw unavailable();
      keys.set(Number(id), key);
    }
    if (!keys.has(version)) throw unavailable();
    return { keys, version };
  } catch {
    throw unavailable();
  }
}
function identity(actorId: string, deviceId: string) {
  const tenantId = currentTenant()!.id;
  const aad = canonicalJson({
    schemaVersion: '1.0',
    tenantId,
    actorId: UuidSchema.parse(actorId),
    deviceId: UuidSchema.parse(deviceId),
    resourceKey: 'offline-dek',
    keyVersion: 1,
  });
  return { aad, key: 'offline-device:' + createHash('sha256').update(aad).digest('hex') };
}
function wrap(dek: Buffer, aad: string, version: number, master: Buffer): WrappedKey {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', master, nonce);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    schemaVersion: '1.0',
    keyVersion: 1,
    wrapVersion: version,
    aad,
    nonce: nonce.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}
@Injectable()
export class DeviceKeysService {
  constructor(@Inject(Db) private db: Db) {}
  async registered(actorId: string, deviceId: string) {
    const scope = identity(actorId, deviceId);
    const row = await this.db.configuracion.findFirst({
      where: { clave: scope.key, autor_id: actorId, hasta: null },
    });
    if (!row)
      throw new ForbiddenException({
        code: 'DEVICE_NOT_REGISTERED',
        message: 'Conecta este dispositivo e inicia la preparación offline.',
      });
  }
  async recover(actorId: string, deviceId: string) {
    const { keys, version } = keyring(),
      scope = identity(actorId, deviceId);
    return this.db.$transaction(async (tx) => {
      await lockOperation(tx, 'offline-key', scope.key);
      const row = await tx.configuracion.findFirst({
        where: { clave: scope.key, hasta: null },
        orderBy: { version: 'desc' },
      });
      let dek: Buffer;
      if (row) {
        try {
          const value = row.valor as unknown as WrappedKey;
          if (
            row.autor_id !== actorId ||
            value.schemaVersion !== '1.0' ||
            value.keyVersion !== 1 ||
            value.aad !== scope.aad ||
            !keys.has(value.wrapVersion)
          )
            throw unavailable();
          const nonce = Buffer.from(value.nonce, 'base64'),
            tag = Buffer.from(value.tag, 'base64');
          if (nonce.length !== 12 || tag.length !== 16) throw unavailable();
          const decipher = createDecipheriv('aes-256-gcm', keys.get(value.wrapVersion)!, nonce);
          decipher.setAAD(Buffer.from(scope.aad));
          decipher.setAuthTag(tag);
          dek = Buffer.concat([
            decipher.update(Buffer.from(value.ciphertext, 'base64')),
            decipher.final(),
          ]);
          if (dek.length !== 32) throw unavailable();
          if (value.wrapVersion !== version) {
            await tx.configuracion.update({ where: { id: row.id }, data: { hasta: new Date() } });
            await tx.configuracion.create({
              data: {
                clave: scope.key,
                version: row.version + 1,
                autor_id: actorId,
                desde: new Date(),
                valor: wrap(
                  dek,
                  scope.aad,
                  version,
                  keys.get(version)!,
                ) as unknown as Prisma.InputJsonValue,
              },
            });
          }
        } catch {
          throw unavailable();
        } // Never replace an unreadable key: it would lose pending work.
      } else {
        dek = randomBytes(32);
        await tx.configuracion.create({
          data: {
            clave: scope.key,
            version: 1,
            autor_id: actorId,
            desde: new Date(),
            valor: wrap(
              dek,
              scope.aad,
              version,
              keys.get(version)!,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return { keyVersion: 1, keyBase64: dek.toString('base64') };
    });
  }
}
