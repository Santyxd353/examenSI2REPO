import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { currentTenant } from './tenancy/context';
@Injectable()
export class Db extends PrismaClient implements OnModuleDestroy {
  private readonly primaryUrl = process.env.DATABASE_URL;
  private readonly tenantClients = new Map<string, PrismaClient>();

  constructor() {
    super();
    return new Proxy(this, {
      get: (target, property) => {
        const local =
          typeof property !== 'string' ||
          property === 'constructor' ||
          property === 'onModuleDestroy' ||
          property === 'primaryUrl' ||
          property === 'tenantClients';
        const url = currentTenant()?.databaseUrl;
        let client: PrismaClient = target;
        if (!local && url && url !== target.primaryUrl) {
          let selected = target.tenantClients.get(url);
          if (!selected) {
            if (target.tenantClients.size >= 24)
              throw new ServiceUnavailableException(
                'La capacidad de tiendas está ocupada. Intenta más tarde.',
              );
            selected = new PrismaClient({ datasources: { db: { url } } });
            target.tenantClients.set(url, selected);
          }
          client = selected;
        }
        const value = Reflect.get(client, property, client);
        return typeof value === 'function' ? value.bind(client) : value;
      },
    });
  }

  async onModuleDestroy() {
    await Promise.all([
      this.$disconnect(),
      ...[...this.tenantClients.values()].map((client) => client.$disconnect()),
    ]);
    this.tenantClients.clear();
  }
}
