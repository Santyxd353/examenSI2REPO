import { resolve, sep } from 'path';
import { mkdir, rm } from 'fs/promises';
import { currentTenant, currentTenantSlug } from './tenancy/context';
export const storageRoot = () =>
  resolve(currentTenant()?.storageDirectory || process.env.STORAGE_ROOT || '.local/storage');
export function publicAssetPath(key: string) {
  const asset = key.replace(/^public\//, '');
  const slug = currentTenantSlug();
  return slug === 'lumina' ? `/assets/${asset}` : `/stores/${slug}/assets/${asset}`;
}
export function storedPath(key: string) {
  const root = storageRoot(),
    path = resolve(root, key);
  if (!path.startsWith(root + sep)) throw new Error('Ruta privada inválida');
  return path;
}
export async function ensureStorage() {
  await mkdir(storedPath('private'), { recursive: true });
  await mkdir(storedPath('public'), { recursive: true });
}
export async function removeStored(key: string) {
  await rm(storedPath(key), { recursive: true, force: true });
}
