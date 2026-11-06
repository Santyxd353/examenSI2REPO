import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { canonicalJson, UuidSchema } from '@lumina/contracts';
import { storedPath } from '../storage';

export async function writePrivateDocument(key: string, value: unknown, maxBytes = 65536) {
  const target = storedPath(key),
    temporary = target + '.tmp';
  const json = canonicalJson(value);
  if (Buffer.byteLength(json) > maxBytes)
    throw new ServiceUnavailableException({
      code: 'OFFLINE_DOCUMENT_TOO_LARGE',
      message: 'El archivo supera el límite de descarga. Reduce el alcance del conjunto.',
    });
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, json, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export async function purgePrivateDocuments(directory: 'snapshots' | 'outfits', now = new Date()) {
  const root = `private/offline/${directory}`;
  const list = (key: string) =>
    readdir(storedPath(key), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
  let removed = 0;
  for (const actor of await list(root)) {
    if (!actor.isDirectory() || !UuidSchema.safeParse(actor.name).success) continue;
    for (const entry of await list(root + '/' + actor.name)) {
      const name = /^([a-f0-9-]{36})\.json(\.tmp)?$/.exec(entry.name);
      if (!entry.isFile() || !name || !UuidSchema.safeParse(name[1]).success) continue;
      const path = storedPath(root + '/' + actor.name + '/' + entry.name);
      try {
        const info = await lstat(path),
          age = name[2] ? 3600000 : 24 * 3600000;
        if (info.isFile() && now.getTime() - info.mtimeMs >= age) {
          await unlink(path);
          removed++;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  return removed;
}

export async function readStoredFile(key: string, maxBytes: number) {
  const path = storedPath(key);
  const info = await lstat(path);
  if (!info.isFile() || info.size < 1 || info.size > maxBytes)
    throw new Error('Archivo no disponible.');
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('El archivo cambió durante la lectura.');
  return bytes;
}
