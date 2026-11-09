import { API_URL, api } from '../../api';
import { openOfflineDatabase } from '../../offline/db';
import type { OfflineScope } from '../../offline/scope';
import {
  cachedArUriForVariant,
  downloadVerifiedArResource,
  listCachedArResources,
  saveCachedArResource,
} from '../catalog/offlineArCache';
import { planOfflineArDownloads, type ArResourceManifest } from '../catalog/offlineArCatalog';

export async function prepareOfflineWardrobe(scope: OfflineScope) {
  const database = await openOfflineDatabase();
  const cached = await listCachedArResources(database, scope);
  const resources = await api<ArResourceManifest[]>('/catalog/ar-resources?offlineLimit=10');
  const plan = planOfflineArDownloads(API_URL, resources, new Set(cached.map((item) => item.resourceId)));
  const failures: string[] = [];
  for (const item of plan) {
    try {
      const downloaded = await downloadVerifiedArResource(item);
      await saveCachedArResource(database, scope, downloaded);
    } catch (reason) {
      failures.push((reason as Error).message);
    }
  }
  const completed = await listCachedArResources(database, scope);
  return { completed, failures };
}

export async function offlineArUri(scope: OfflineScope, variantId: string) {
  return cachedArUriForVariant(await openOfflineDatabase(), scope, variantId);
}
