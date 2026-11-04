import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { copyFile, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { resolve, sep } from 'path';
import { commerceFixture } from './helpers/commerce';
import { AvatarJobs } from '../src/avatar-jobs';
import { storedPath } from '../src/storage';

let f: Awaited<ReturnType<typeof commerceFixture>>;
let jobs: AvatarJobs;
const folder = resolve('.local', `avatar-output-${randomUUID()}`);
const personal = resolve(folder, 'avatar.glb');
const measurements = {
  altura: { valor_cm: 185, origen: 'DECLARADA', confianza: 1 },
  pecho: { valor_cm: 110, origen: 'ESTIMADA', confianza: 0.5 },
  cintura: { valor_cm: 90, origen: 'ESTIMADA', confianza: 0.5 },
  cadera: { valor_cm: 112, origen: 'ESTIMADA', confianza: 0.5 },
};
const parameters = {
  height: 1.85,
  chest_width: 0.44,
  chest_depth: 0.29,
  waist_width: 0.35,
  hip_width: 0.42,
  plantilla: 'g18-1',
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
async function upload(height = '185') {
  return request(f.app.getHttpServer())
    .post('/api/avatars')
    .set('X-Tenant-Slug', f.tenant.slug)
    .auth(f.token, { type: 'bearer' })
    .field('altura', height)
    .field('consentimiento', 'true')
    .field('adulto', 'true')
    .field('idempotencia', randomUUID())
    .attach('frente', png, 'frente.png')
    .attach('perfil', png, 'perfil.png')
    .attach('espalda', png, 'espalda.png');
}
function workerFixture(produce: (target: string) => Promise<void>, result: object = {}) {
  // Only the worker transport is replaced. GLB is exported by real Blender, never inferred from these fixture photos.
  return jest.spyOn(jobs as any, 'run').mockImplementation(async (...args: unknown[]) => {
    const input = JSON.parse(await readFile(String(args[0]), 'utf8'));
    const file = resolve(input.output_dir, 'avatar.glb');
    await produce(file);
    return {
      ok: true,
      avatar_file: file,
      medidas: measurements,
      parametros_malla: parameters,
      version_proceso: 'fixture-export-real',
      ...result,
    };
  });
}
beforeAll(async () => {
  f = await commerceFixture();
  jobs = f.app.get(AvatarJobs);
  await mkdir(folder, { recursive: true });
  await promisify(execFile)(
    resolve(process.env.PYTHON_PATH || 'workers/avatar/.venv/Scripts/python.exe'),
    [
      '-c',
      'import sys,json;from pathlib import Path;from process import export;export(json.loads(sys.argv[1]),Path(sys.argv[2]))',
      JSON.stringify(parameters),
      folder,
    ],
    {
      cwd: resolve('workers/avatar'),
      env: { ...process.env },
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}, 150000);
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await f?.close();
  if (!folder.startsWith(resolve('.local') + sep)) throw new Error('Ruta de limpieza inválida.');
  await rm(folder, { recursive: true, force: true });
});

test('GLB exportado real confirma cuota una vez y conserva aprobado anterior hasta aprobación explícita', async () => {
  const old = await f.inStore(async () => {
    const template = await f.db.plantilla_corporal.findFirstOrThrow();
    const key = `private/fixtures/${randomUUID()}.glb`;
    await mkdir(storedPath('private/fixtures'), { recursive: true });
    await copyFile(personal, storedPath(key));
    return f.db.avatar.create({
      data: {
        usuario_id: f.actorId,
        plantilla_id: template.id,
        version: 1,
        estado: 'APROBADO',
        clave_glb: key,
        medidas: measurements,
        parametros_malla: parameters,
        creado_en: new Date(),
      },
    });
  });
  workerFixture((target) => copyFile(personal, target));
  const accepted = await upload();
  expect(accepted.status).toBe(201);
  await f.inStore(() => jobs.tick());
  await f.inStore(() => jobs.tick());
  const completed = await f.inStore(() =>
    f.db.trabajo_avatar.findUniqueOrThrow({
      where: { id: accepted.body.id },
      include: { avatar: true, consumo_cuota: true },
    }),
  );
  expect(completed).toMatchObject({
    estado: 'COMPLETADO',
    avatar: { version: 2, estado: 'EN_REVISION' },
    consumo_cuota: { estado: 'CONFIRMADO', cantidad: 1 },
  });
  expect(
    (await f.inStore(() => f.db.avatar.findUniqueOrThrow({ where: { id: old.id } }))).estado,
  ).toBe('APROBADO');
  expect((await f.http('post', `/avatars/${completed.avatar_id}/approve`)).status).toBe(201);
  expect((await f.http('post', `/avatars/${completed.avatar_id}/approve`)).status).toBe(201);
  expect(
    (await f.inStore(() => f.db.avatar.findUniqueOrThrow({ where: { id: old.id } }))).estado,
  ).toBe('SUSTITUIDO');
});

test.each(['corrupto', 'referencia', 'altura'] as const)(
  'salida %s no se publica ni consume cuota',
  async (kind) => {
    workerFixture(async (target) => {
      if (kind === 'corrupto') await writeFile(target, 'not a valid GLB');
      else
        await copyFile(
          kind === 'referencia' ? resolve('.local/storage/public/reference.glb') : personal,
          target,
        );
    });
    const accepted = await upload(kind === 'altura' ? '170' : '185');
    expect(accepted.status).toBe(201);
    await f.inStore(() => jobs.tick());
    const job = await f.inStore(() =>
      f.db.trabajo_avatar.findUniqueOrThrow({
        where: { id: accepted.body.id },
        include: { consumo_cuota: true },
      }),
    );
    expect(job).toMatchObject({
      estado: 'FALLIDO',
      avatar_id: null,
      consumo_cuota: { estado: 'LIBERADO' },
    });
  },
);

test('fallo de procesador se audita con código seguro, sin detalles privados', async () => {
  workerFixture((target) => writeFile(target, ''), {
    ok: false,
    error_code: 'detalle privado pecho 110',
  });
  const accepted = await upload();
  expect(accepted.status).toBe(201);
  await f.inStore(() => jobs.tick());
  const audit = await f.inStore(() =>
    f.db.auditoria.findMany({ where: { entidad_id: accepted.body.id } }),
  );
  expect(JSON.stringify(audit)).not.toContain('detalle privado');
  expect(audit.some((a) => (a.cambios as any).code === 'PROCESAMIENTO_FALLIDO')).toBe(true);
});
