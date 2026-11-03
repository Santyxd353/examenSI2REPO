import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { seed } from './seed';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/vestidor18_test';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  const exists = await client.query("SELECT to_regclass('public.usuario') AS name");
  if (!exists.rows[0].name) {
    await client.query(readFileSync('prisma/documented-schema.sql', 'utf8'));
  } else {
    const arColumns = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name='recurso_catalogo' AND column_name='uso'",
    );
    if (!arColumns.rowCount)
      await client.query(
        readFileSync('prisma/migrations/20260920000000_recursos_ar_catalogo/migration.sql', 'utf8'),
      );
    const arUnique = await client.query(
      "SELECT to_regclass('public.ux_recurso_catalogo_ar_publicado_variante') AS name",
    );
    if (!arUnique.rows[0].name)
      await client.query(
        readFileSync('prisma/migrations/20260920010000_ar_publicado_unico/migration.sql', 'utf8'),
      );
    const activeCartIndex = await client.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND indexname='carrito_activo'",
    );
    if (!activeCartIndex.rows[0]?.indexdef.includes('(usuario_id, canal)'))
      await client.query(
        readFileSync(
          'prisma/migrations/20260922000000_carrito_activo_por_canal/migration.sql',
          'utf8',
        ),
      );
  }
  await client.query(
    readFileSync('prisma/migrations/202611010001_saas_offline_analytics/migration.sql', 'utf8'),
  );
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  await seed(db);
  await db.$disconnect();
  await client.query(
    readFileSync(
      'prisma/migrations/20260920020000_catalogo_comun_ubicaciones/migration.sql',
      'utf8',
    ),
  );
  await client.end();
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
