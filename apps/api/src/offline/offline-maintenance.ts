import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { TenantRegistry } from '../tenancy/platform';
import { runForTenant } from '../tenancy/context';
import { purgePrivateDocuments } from './private-files';
import { ResourcesService } from './resources.service';

@Injectable()
export class OfflineMaintenance implements OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(
    @Inject(TenantRegistry) private registry: TenantRegistry,
    @Inject(ResourcesService) private resources: ResourcesService,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(
      () =>
        void this.sweep().catch(() =>
          console.error('No se pudo revisar la limpieza offline. Se reintentará.'),
        ),
      3600000,
    );
    this.timer.unref();
  }
  async sweep() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const tenant of await this.registry.listForMaintenance()) {
        try {
          await runForTenant(tenant, async () => {
            await purgePrivateDocuments('snapshots');
            await purgePrivateDocuments('outfits');
            await this.resources.purgeExpired();
          });
        } catch {
          console.error(`La limpieza offline de ${tenant.slug} se reintentará.`);
        }
      }
    } finally {
      this.busy = false;
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
