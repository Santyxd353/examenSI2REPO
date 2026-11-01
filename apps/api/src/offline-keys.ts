import { Body, Controller, Inject, Injectable, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { z } from 'zod';
import { AuthGuard, AuthRequest } from './auth';
import { Db } from './db';

const requestSchema = z.object({ deviceId: z.string().uuid(), rotate: z.boolean().optional().default(false) }).strict();
type StoredKey = { ciphertext: string; iv: string; tag: string };

@Injectable()
export class OfflineKeyService {
  constructor(@Inject(Db) private readonly db: Db) {}

  private key() {
    const raw = process.env.OFFLINE_VAULT_SECRET;
    const key = raw ? Buffer.from(raw, 'base64') : null;
    if (!key || key.length !== 32)
      throw new ServiceUnavailableException('El vault offline no está configurado en el servidor.');
    return key;
  }
  private encrypt(value: string): StoredKey {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
  }
  private decrypt(row: StoredKey) {
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(row.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
  private async ensureTable() {
    await this.db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS offline_device_key (
      user_id uuid NOT NULL, device_id uuid NOT NULL, ciphertext text NOT NULL, iv text NOT NULL, tag text NOT NULL,
      version integer NOT NULL, created_at timestamptz NOT NULL, rotated_at timestamptz NOT NULL,
      PRIMARY KEY (user_id, device_id))`);
  }
  async bootstrap(userId: string, body: unknown) {
    const input = requestSchema.parse(body);
    await this.ensureTable();
    const rows = await this.db.$queryRaw<(StoredKey & { version: number })[]>`
      SELECT ciphertext,iv,tag,version FROM offline_device_key WHERE user_id=${userId}::uuid AND device_id=${input.deviceId}::uuid`;
    if (rows[0] && !input.rotate) {
      try { return { dek: this.decrypt(rows[0]), keyVersion: rows[0].version, rotated: false }; }
      catch { /* rotate corrupt ciphertext below */ }
    }
    const dek = randomBytes(32).toString('base64'), encrypted = this.encrypt(dek);
    const version = (rows[0]?.version || 0) + 1;
    await this.db.$executeRaw`
      INSERT INTO offline_device_key (user_id,device_id,ciphertext,iv,tag,version,created_at,rotated_at)
      VALUES (${userId}::uuid,${input.deviceId}::uuid,${encrypted.ciphertext},${encrypted.iv},${encrypted.tag},${version},now(),now())
      ON CONFLICT (user_id,device_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,tag=EXCLUDED.tag,version=EXCLUDED.version,rotated_at=now()`;
    return { dek, keyVersion: version, rotated: true };
  }
}

@Controller('offline/key')
@UseGuards(AuthGuard)
export class OfflineKeyController {
  constructor(@Inject(OfflineKeyService) private readonly keys: OfflineKeyService) {}
  @Post('bootstrap') bootstrap(@Req() request: AuthRequest, @Body() body: unknown) {
    return this.keys.bootstrap(request.user.id, body);
  }
}
