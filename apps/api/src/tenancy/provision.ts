import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { copyFile, mkdir, access } from 'fs/promises';
import { resolve } from 'path';
import { z } from 'zod';
import { TenantRegistry, validTenantSlug } from './platform';
import { seedTenantRoles } from './defaults';

const execute = promisify(execFile);
const registration = z
  .object({
    slug: z.string().refine(validTenantSlug),
    name: z.string().trim().min(2).max(120),
    ownerEmail: z.string().trim().toLowerCase().email().max(160),
    ownerPassword: z
      .string()
      .min(10)
      .max(72)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
    planCode: z.enum(['esencial', 'pro', 'negocio']).default('pro'),
  })
  .strict();

export async function provisionTenant(raw: unknown, registry: TenantRegistry) {
  const input = registration.parse(raw);
  if (input.slug === 'lumina') throw new ConflictException('Ese espacio ya está reservado.');
  await registry.initialize();
  const id = randomUUID();
  const databaseName = `store_${id.replaceAll('-', '')}`;
  const control = await registry.pool.connect();
  try {
    await control.query('BEGIN');
    await control.query(
      `INSERT INTO platform.tenant(id,slug,name,database_name,state) VALUES($1,$2,$3,$4,'PROVISIONING')`,
      [id, input.slug, input.name, databaseName],
    );
    await control.query(
      `INSERT INTO platform.subscription(tenant_id,plan_code,status,provider,trial_ends_at)
      VALUES($1,$2,'TRIALING','NONE',now()+interval '14 days')`,
      [id, input.planCode],
    );
    await control.query('COMMIT');
  } catch (error) {
    await control.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505')
      throw new ConflictException('El identificador de tienda ya está utilizado.');
    throw error;
  } finally {
    control.release();
  }

  const administration = new Client({ connectionString: registry.administrationUrl });
  const client = new PrismaClient({
    datasources: { db: { url: registry.databaseUrlFor(databaseName) } },
  });
  try {
    await administration.connect();
    await administration.query(`CREATE DATABASE "${databaseName}"`);
    await execute(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        resolve('prisma/schema.prisma'),
      ],
      {
        env: { ...process.env, DATABASE_URL: registry.databaseUrlFor(databaseName) },
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    await seedTenantRoles(client);
    const adminRole = await client.rol.findUniqueOrThrow({ where: { nombre: 'Administrador' } });
    await client.usuario.create({
      data: {
        nombres: 'Administradora',
        apellidos: input.name,
        correo: input.ownerEmail,
        clave_hash: await hash(input.ownerPassword, 12),
        estado: 'ACTIVO',
        preferencias: {},
        creado_en: new Date(),
        usuario_rol: { create: { rol_id: adminRole.id, asignado_en: new Date() } },
      },
    });
    await client.ubicacion.create({
      data: { nombre: 'Sucursal principal', tipo: 'TIENDA', activa: true },
    });
    await client.plantilla_corporal.create({
      data: {
        nombre: 'Cuerpo neutro G18',
        version: '1.0',
        clave_malla: 'public/reference.glb',
        esqueleto_version: 'g18-1',
        parametros: { unidad: 'metros', eje: 'Y', origen: 'suelo' },
        licencia: 'Geometría propia Grupo 18',
        activa: true,
      },
    });
    const storage = resolve(process.env.STORAGE_ROOT || '.local/storage');
    const destination = resolve(storage, 'tenants', id);
    await mkdir(resolve(destination, 'private'), { recursive: true });
    await mkdir(resolve(destination, 'public'), { recursive: true });
    for (const name of [
      'reference.glb',
      ...['dress', 'skirt'].flatMap((kind) => ['S', 'M', 'L'].map((size) => `${kind}-${size}.glb`)),
    ]) {
      const source = resolve(storage, 'public', name);
      if (
        await access(source).then(
          () => true,
          () => false,
        )
      )
        await copyFile(source, resolve(destination, 'public', name));
    }
    await registry.pool.query("UPDATE platform.tenant SET state='TRIAL' WHERE id=$1", [id]);
    return await registry.resolve(input.slug);
  } catch {
    await registry.pool.query("UPDATE platform.tenant SET state='FAILED' WHERE id=$1", [id]);
    throw new BadRequestException(
      'La tienda no terminó de prepararse. Su identificador quedó reservado para revisión del operador.',
    );
  } finally {
    await client.$disconnect();
    await administration.end().catch(() => {});
  }
}
