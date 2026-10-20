import 'dotenv/config';
import { parseArgs } from 'node:util';
import { TenantRegistry } from '../apps/api/src/tenancy/platform';
import { provisionTenant } from '../apps/api/src/tenancy/provision';

async function main() {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      plan: { type: 'string', default: 'pro' },
    },
  });
  const registry = new TenantRegistry();
  try {
    const tenant = await provisionTenant(
      {
        slug: values.slug,
        name: values.name,
        ownerEmail: values.email,
        ownerPassword: process.env.TENANT_ADMIN_PASSWORD,
        planCode: values.plan,
      },
      registry,
    );
    console.log(
      `Tienda preparada: ${tenant.name} (${tenant.slug}). Prueba de 14 días; el catálogo empieza vacío.`,
    );
    console.log(
      `Acceso web: ?tienda=${tenant.slug}. En Android selecciona el identificador ${tenant.slug}.`,
    );
  } finally {
    await registry.onModuleDestroy();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'No se pudo preparar la tienda.');
  process.exitCode = 1;
});
