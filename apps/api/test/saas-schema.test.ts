import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = 'prisma/migrations/202611010001_saas_offline_analytics/migration.sql';
const spec = JSON.parse(readFileSync(resolve('docs/saas/iconix/especificacion.json'), 'utf8'));
const actor = randomUUID(),
  product = randomUUID(),
  variant = randomUUID(),
  category = randomUUID(),
  location = randomUUID();
const clients: Client[] = [];
const names: string[] = [];
let admin: Client;

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/vestidor18_test'
  )
    throw new Error('Migración de ensayo requiere PostgreSQL local y base de test.');
  admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  for (let i = 0; i < 2; i++) {
    const name = `lumina_schema_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    names.push(name);
    await admin.query(`CREATE DATABASE "${name}"`);
    const dbUrl = new URL(url);
    dbUrl.pathname = `/${name}`;
    const db = new Client({ connectionString: dbUrl.toString() });
    await db.connect();
    clients.push(db);
    await db.query(readFileSync(resolve('prisma/documented-schema.sql'), 'utf8'));
    await db.query(
      `INSERT INTO usuario(id,nombres,apellidos,correo,clave_hash,estado,preferencias,creado_en)
      VALUES($1,'Prueba','Migración','misma@qa.test','hash-solo-prueba-no-login','ACTIVO','{}',now())`,
      [actor],
    );
    await db.query(
      `INSERT INTO categoria(id,nombre,descripcion,activa) VALUES($1,'Vestidos','Ropa femenina',true)`,
      [category],
    );
    await db.query(
      `INSERT INTO producto(id,categoria_id,nombre,descripcion,material,estado,creado_en)
      VALUES($1,$2,'Vestido existente','Descripción conservada','Algodón','PUBLICADO',now())`,
      [product, category],
    );
    await db.query(
      `INSERT INTO variante(id,producto_id,sku,talla,color,activa) VALUES($1,$2,'MISMO-SKU-M','M','Negro',true)`,
      [variant, product],
    );
    await db.query(
      `INSERT INTO ubicacion(id,nombre,tipo,activa) VALUES($1,'Principal','TIENDA',true)`,
      [location],
    );
    await db.query(
      `INSERT INTO inventario(variante_id,ubicacion_id,fisico,reservado,comprometido,version) VALUES($1,$2,10,2,1,0)`,
      [variant, location],
    );
  }
}, 60000);

afterAll(async () => {
  for (const db of clients) await db.end();
  for (const name of names) {
    if (!/^lumina_schema_[a-f0-9]{20}$/.test(name))
      throw new Error('Nombre de limpieza no autorizado.');
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await admin?.end();
}, 30000);

test('upgrade de dos negocios poblados conserva datos e inventario y es repetible', async () => {
  const sql = readFileSync(resolve(migrationPath), 'utf8');
  for (const db of clients) {
    await db.query(sql);
    expect(
      (await db.query('SELECT nombre,version FROM producto WHERE id=$1', [product])).rows[0],
    ).toEqual({ nombre: 'Vestido existente', version: 1 });
    expect(
      (await db.query('SELECT fisico,reservado,comprometido,disponible,version FROM inventario'))
        .rows[0],
    ).toEqual({ fisico: 10, reservado: 2, comprometido: 1, disponible: 7, version: 1 });
    await db.query('UPDATE producto SET version=4 WHERE id=$1', [product]);
    await db.query(sql);
    expect(
      (await db.query('SELECT version FROM producto WHERE id=$1', [product])).rows[0].version,
    ).toBe(4);
  }
});

test('las seis tablas tienen campos, nulabilidad y FK del diccionario ICONIX', async () => {
  for (const table of spec.data.new_tables) {
    const columns = (
      await clients[0].query(
        `SELECT column_name,is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`,
        [table.name],
      )
    ).rows;
    expect(columns.map((c) => c.column_name).sort()).toEqual(
      table.fields.map((f: { name: string }) => f.name).sort(),
    );
    for (const field of table.fields)
      expect(columns.find((c) => c.column_name === field.name)?.is_nullable).toBe(
        field.nullable ? 'YES' : 'NO',
      );
  }
});

test('comprobante terminal es único y actor pertenece al negocio', async () => {
  const id = randomUUID();
  const insert = `INSERT INTO operacion_sincronizacion(id,actor_id,dispositivo_instalacion_id,tipo,entidad_tipo,
    entidad_id,version_base,hash_intencion,estado_resultado,resultado,recibida_en,confirmada_en)
    VALUES($1,$2,$3,'STOCK_DELTA','inventario',$4,1,$5,'APPLIED','{}',now(),now())`;
  const values = [id, actor, randomUUID(), randomUUID(), 'a'.repeat(64)];
  await clients[0].query(insert, values);
  await expect(clients[0].query(insert, values)).rejects.toMatchObject({ code: '23505' });
  await expect(
    clients[0].query(insert, [randomUUID(), randomUUID(), ...values.slice(2)]),
  ).rejects.toMatchObject({ code: '23503' });
  expect(
    (await clients[1].query('SELECT count(*) FROM operacion_sincronizacion')).rows[0].count,
  ).toBe('0');
});

test('cuota rechaza período vacío y referencias incorrectas sin guardar reserva inválida', async () => {
  await expect(
    clients[0].query(
      `INSERT INTO consumo_cuota(id,recurso,periodo_desde,periodo_hasta,idempotencia,
    actor_id,cantidad,estado,plan_codigo_snapshot,suscripcion_version_snapshot,limite_snapshot,creado_en,actualizado_en)
    VALUES($1,'AVATAR_GENERACION',now(),now(),$2,$3,1,'RESERVADO','esencial',1,30,now(),now())`,
      [randomUUID(), randomUUID(), actor],
    ),
  ).rejects.toMatchObject({ code: '23514' });
  expect((await clients[0].query('SELECT count(*) FROM consumo_cuota')).rows[0].count).toBe('0');
});

test('métrica sin denominador conserva N/A y exige motivo, nunca WAPE falso cero', async () => {
  const model = randomUUID(),
    dataset = randomUUID();
  await clients[0].query(
    `INSERT INTO conjunto_entrenamiento(id,nombre,version,origen,espacio_identificadores,esquema_version,
    desde,hasta,cortes_temporales,catalogo_referencia,ubicaciones_referencia,canales_referencia,clave_datos,sha256,filas,creado_por,creado_en)
    VALUES($1,'Demo','1','SINTETICO','demo',1,'2025-10-01','2026-09-30','{}','[]','[]','[]','private/demo.json',$2,0,$3,now())`,
    [dataset, 'b'.repeat(64), actor],
  );
  await clients[0].query(
    `INSERT INTO modelo_analitico(id,tipo,nombre,version,parametros,estado)
    VALUES($1,'DEMANDA','Modelo legado','1','{}','ACTIVO')`,
    [model],
  );
  const insert = `INSERT INTO metrica_modelo(id,modelo_id,conjunto_id,particion,nombre,valor,horizonte_dias,segmento,
    segmento_hash,observaciones,calculada_en,estado,motivo_no_aplica,denominador)
    VALUES($1,$2,$3,'PRUEBA','WAPE',$4,7,'{}',$5,10,now(),$6,$7,0)`;
  await clients[0].query(insert, [
    randomUUID(),
    model,
    dataset,
    null,
    'c'.repeat(64),
    'NO_APLICA',
    'Demanda total cero',
  ]);
  await expect(
    clients[0].query(insert, [randomUUID(), model, dataset, 0, 'd'.repeat(64), 'EVALUABLE', null]),
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await clients[0].query('SELECT valor,estado,motivo_no_aplica FROM metrica_modelo')).rows[0],
  ).toEqual({ valor: null, estado: 'NO_APLICA', motivo_no_aplica: 'Demanda total cero' });
  expect(
    (await clients[0].query('SELECT procedencia FROM modelo_analitico WHERE id=$1', [model]))
      .rows[0].procedencia,
  ).toBe('REGLA_LEGADA');
});

test('N/A sin motivo no pasa por el valor NULL de un CHECK SQL', async () => {
  await expect(
    clients[0].query(
      `INSERT INTO metrica_modelo(id,modelo_id,conjunto_id,particion,nombre,valor,
    horizonte_dias,segmento,segmento_hash,observaciones,calculada_en,estado,motivo_no_aplica,denominador)
    SELECT $1,modelo_id,conjunto_id,particion,nombre,NULL,horizonte_dias,segmento,$2,observaciones,now(),'NO_APLICA',NULL,0
    FROM metrica_modelo LIMIT 1`,
      [randomUUID(), '9'.repeat(64)],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

test('un modelo entrenado no puede omitir hash del artefacto', async () => {
  await expect(
    clients[0].query(
      `INSERT INTO modelo_analitico(id,tipo,nombre,version,parametros,estado,
    procedencia,conjunto_entrenamiento_id,algoritmo,clave_artefacto,entrenado_en)
    SELECT $1,'DEMANDA','Entrenado incompleto','1','{}','ACTIVO','DEMOSTRACION',conjunto_id,
      'RandomForest','private/model.joblib',now() FROM metrica_modelo LIMIT 1`,
      [randomUUID()],
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

test('control migra suscripciones/eventos una vez y detecta SQL alterado', async () => {
  const { applyControlMigrations } = require('../src/tenancy/migrations') as {
    applyControlMigrations(db: Client): Promise<void>;
  };
  const db = clients[1];
  await db.query(readFileSync(resolve('prisma/platform/schema.sql'), 'utf8'));
  await db.query(
    `INSERT INTO platform.plan(code,name,limits,features) VALUES('esencial','Esencial','{}','[]')`,
  );
  await db.query(
    `INSERT INTO platform.tenant(id,slug,name,database_name,state) VALUES($1,'qa-migracion','QA','qa_db','ACTIVE')`,
    [actor],
  );
  await db.query(
    `INSERT INTO platform.subscription(tenant_id,plan_code,status,provider,current_period_end)
    VALUES($1,'esencial','ACTIVE','NONE',now()+interval '1 month')`,
    [actor],
  );
  for (let i = 0; i < 2; i++) {
    await db.query('BEGIN');
    try {
      await applyControlMigrations(db);
      await db.query('COMMIT');
      if (i === 0) {
        // Reconstruct the deployed pre-change signup schema in this disposable DB.
        await db.query('ALTER TABLE platform.signup DROP COLUMN payment_attempt');
        await db.query(
          "DELETE FROM platform.schema_migration WHERE name='202611110002_signup_payment_attempt.sql'",
        );
        await db.query(
          `INSERT INTO platform.signup
          (id,capability_hash,request_hash,slug,company_name,owner_email,first_name,last_name,password_hash,
           plan_code,amount_minor,billing_interval,provider,state,expires_at,session_id,checkout_url)
          VALUES($1,repeat('a',64),repeat('b',64),'alta-existente','QA','qa@example.test','Ana','Prueba','hash-conservado',
          'esencial',999,'MONTHLY','STRIPE_TEST','PENDING',now()+interval '1 hour','cs_test_legacy','https://checkout.stripe.com/c/pay/cs_test_legacy')`,
          [actor],
        );
      }
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
  // A second application must be harmless, including after upgrading a real draft.
  await applyControlMigrations(db);
  expect(
    (await db.query('SELECT name FROM platform.schema_migration ORDER BY name')).rows.map(
      (row) => row.name,
    ),
  ).toEqual([
    '202611010001_billing.sql',
    '202611110001_public_signup.sql',
    '202611110002_signup_payment_attempt.sql',
  ]);
  expect(
    (
      await db.query(
        'SELECT payment_attempt,password_hash,session_id,provider FROM platform.signup WHERE id=$1',
        [actor],
      )
    ).rows[0],
  ).toEqual({
    payment_attempt: 0,
    password_hash: 'hash-conservado',
    session_id: 'cs_test_legacy',
    provider: 'STRIPE_TEST',
  });
  expect(
    (
      await db.query(
        'SELECT status,cancel_at_period_end FROM platform.subscription WHERE tenant_id=$1',
        [actor],
      )
    ).rows[0],
  ).toEqual({ status: 'ACTIVE', cancel_at_period_end: false });
  await db.query("UPDATE platform.schema_migration SET sha256=repeat('0',64)");
  await expect(applyControlMigrations(db)).rejects.toThrow('MIGRATION_CHECKSUM_MISMATCH');
});
