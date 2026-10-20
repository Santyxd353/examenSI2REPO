import 'dotenv/config';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { TenantRegistry } from '../apps/api/src/tenancy/platform';
import { seedTenantRoles } from '../apps/api/src/tenancy/defaults';

async function main() {
  const registry = new TenantRegistry();
  try {
    for (const tenant of await registry.listForMaintenance()) {
      if (tenant.slug === 'lumina') continue;
      console.log(`Aplicando migraciones: ${tenant.slug}`);
      await promisify(execFile)(
        process.execPath,
        [
          require.resolve('prisma/build/index.js'),
          'migrate',
          'deploy',
          '--schema',
          resolve('prisma/schema.prisma'),
        ],
        {
          env: { ...process.env, DATABASE_URL: tenant.databaseUrl },
          windowsHide: true,
          timeout: 120000,
        },
      );
      const client = new PrismaClient({ datasources: { db: { url: tenant.databaseUrl } } });
      try {
        await seedTenantRoles(client);
      } finally {
        await client.$disconnect();
      }
    }
  } finally {
    await registry.onModuleDestroy();
  }
}
main().catch(() => {
  console.error(
    'Una tienda no terminó de migrar. Revisa las migraciones antes de iniciar la nueva versión.',
  );
  process.exitCode = 1;
});
