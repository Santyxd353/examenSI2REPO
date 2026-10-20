import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Db } from './db';
import { storedPath, removeStored } from './storage';
import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, stat, unlink } from 'fs/promises';
import { resolve, relative } from 'path';
import { Prisma } from '@prisma/client';
import { TenantRegistry } from './tenancy/platform';
import { currentTenant, runForTenant } from './tenancy/context';
type WorkerOutput = {
  ok: boolean;
  avatar_file?: string;
  medidas?: Prisma.InputJsonObject;
  parametros_malla?: Prisma.InputJsonObject;
  version_proceso?: string;
  error_code?: string;
};
@Injectable()
export class AvatarJobs implements OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private child?: ChildProcess;
  private sweeping = false;
  constructor(
    @Inject(Db) private db: Db,
    @Inject(TenantRegistry) private registry: TenantRegistry,
  ) {}
  start() {
    this.timer = setInterval(
      () =>
        void this.sweep().catch(() =>
          console.error('El procesador reintentará la revisión de la cola.'),
        ),
      3000,
    );
    this.timer.unref();
  }
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const tenant of await this.registry.listForMaintenance()) {
        try {
          await runForTenant(tenant, () => this.tick());
        } catch {
          console.error(
            `La cola de ${tenant.slug} requiere revisión; las otras tiendas continúan.`,
          );
        }
      }
    } finally {
      this.sweeping = false;
    }
  }
  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.child?.kill();
  }
  private run(input: string): Promise<WorkerOutput> {
    return new Promise((resolveResult) => {
      const child = spawn(
        resolve(process.env.PYTHON_PATH || 'workers/avatar/.venv/Scripts/python.exe'),
        [resolve('workers/avatar/process.py'), '--job', input],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      this.child = child;
      let data = '';
      const timeout = setTimeout(() => {
        child.kill();
        resolveResult({ ok: false, error_code: 'TIEMPO_AGOTADO' });
      }, 180000);
      child.stdout?.on('data', (buf) => {
        if (data.length < 100000) data += buf.toString();
      });
      child.stderr?.on('data', () => {}); // Fotos y medidas nunca van al registro del servidor.
      child.on('error', () => {
        clearTimeout(timeout);
        resolveResult({ ok: false, error_code: 'PROCESADOR_NO_DISPONIBLE' });
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        this.child = undefined;
        try {
          const parsed = JSON.parse(data);
          resolveResult(
            code === 0
              ? parsed
              : { ok: false, error_code: parsed.error_code || 'PROCESAMIENTO_FALLIDO' },
          );
        } catch {
          resolveResult({ ok: false, error_code: 'PROCESAMIENTO_FALLIDO' });
        }
      });
    });
  }
  async purgeCapture(id: string) {
    const capture = await this.db.captura_corporal.findUnique({ where: { id } });
    if (!capture || capture.purgada_en) return;
    const photos = await this.db.foto_temporal.findMany({ where: { captura_id: id } });
    for (const photo of photos) if (photo.clave_objeto) await removeStored(photo.clave_objeto);
    await this.db.$transaction([
      this.db.foto_temporal.updateMany({
        where: { captura_id: id },
        data: { clave_objeto: null, validacion: Prisma.DbNull, purgada_en: new Date() },
      }),
      this.db.captura_corporal.update({
        where: { id },
        data: { altura_cm: null, estado: 'PURGADA', purgada_en: new Date() },
      }),
    ]);
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const expired = await this.db.captura_corporal.findMany({
        where: { purgada_en: null, purgar_antes_de: { lt: new Date() } },
      });
      for (const c of expired) {
        await this.db.trabajo_avatar.updateMany({
          where: { captura_id: c.id, estado: { in: ['EN_COLA', 'PROCESANDO'] } },
          data: { estado: 'FALLIDO', error_codigo: 'CAPTURA_VENCIDA', terminado_en: new Date() },
        });
        await this.purgeCapture(c.id);
      }
      // Un proceso interrumpido recupera la cola; no hay espera indefinida.
      await this.db.trabajo_avatar.updateMany({
        where: {
          estado: 'PROCESANDO',
          iniciado_en: { lt: new Date(Date.now() - 10 * 60000) },
          intentos: { lt: 3 },
        },
        data: { estado: 'EN_COLA' },
      });
      await this.db.trabajo_avatar.updateMany({
        where: {
          estado: 'PROCESANDO',
          iniciado_en: { lt: new Date(Date.now() - 10 * 60000) },
          intentos: { gte: 3 },
        },
        data: { estado: 'FALLIDO', error_codigo: 'INTENTOS_AGOTADOS', terminado_en: new Date() },
      });
      const rows = currentTenant()?.readOnly
        ? []
        : await this.db.$queryRaw<{ id: string }[]>`
    UPDATE trabajo_avatar SET estado='PROCESANDO',iniciado_en=now(),intentos=intentos+1
    WHERE id=(SELECT id FROM trabajo_avatar WHERE estado='EN_COLA' AND tipo='GENERAR' AND intentos<3 ORDER BY creado_en FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
      if (rows.length) await this.process(rows[0].id);
      const deletions = await this.db.avatar.findMany({ where: { estado: 'ELIMINANDO' } });
      for (const a of deletions) {
        if (a.clave_glb) await removeStored(a.clave_glb);
        await this.db.$transaction([
          this.db.avatar.update({
            where: { id: a.id },
            data: {
              estado: 'ELIMINADO',
              clave_glb: null,
              medidas: Prisma.DbNull,
              parametros_malla: Prisma.DbNull,
              eliminado_en: new Date(),
            },
          }),
          this.db.trabajo_avatar.updateMany({
            where: { avatar_id: a.id },
            data: { parametros: Prisma.DbNull },
          }),
          this.db.sesion_vestidor.updateMany({
            where: { avatar_id: a.id },
            data: { avatar_id: null, finalizada_en: new Date() },
          }),
        ]);
      }
    } finally {
      this.busy = false;
    }
  }
  private async process(id: string) {
    const job = await this.db.trabajo_avatar.findUniqueOrThrow({ where: { id } });
    if (!job.captura_id) return;
    const folder = storedPath('private/jobs/' + id);
    await mkdir(folder, { recursive: true });
    const input = resolve(folder, 'input.json');
    try {
      const capture = await this.db.captura_corporal.findUniqueOrThrow({
        where: { id: job.captura_id },
      });
      const consent = await this.db.consentimiento.findUniqueOrThrow({
        where: { id: capture.consentimiento_id },
      });
      if (consent.revocado_en || capture.purgada_en || capture.purgar_antes_de < new Date())
        throw new Error('CAPTURA_VENCIDA');
      const photos = await this.db.foto_temporal.findMany({ where: { captura_id: capture.id } });
      const map = Object.fromEntries(photos.map((p) => [p.vista, storedPath(p.clave_objeto!)]));
      await writeFile(
        input,
        JSON.stringify({
          height_cm: Number(capture.altura_cm),
          photos: map,
          output_dir: folder,
          job_id: id,
        }),
      );
      const result = await this.run(input);
      await unlink(input).catch(() => {});
      const latest = await this.db.trabajo_avatar.findUniqueOrThrow({ where: { id } });
      const stillConsent = await this.db.consentimiento.findUniqueOrThrow({
        where: { id: consent.id },
      });
      if (latest.estado !== 'PROCESANDO' || stillConsent.revocado_en) {
        await removeStored('private/jobs/' + id);
        return;
      }
      if (!result.ok || !result.avatar_file || !result.medidas)
        throw new Error(result.error_code || 'PROCESAMIENTO_FALLIDO');
      const generated = resolve(result.avatar_file);
      if (generated !== resolve(folder, 'avatar.glb')) throw new Error('SALIDA_INVALIDA');
      await stat(generated);
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM usuario WHERE id=${job.usuario_id}::uuid FOR UPDATE`;
        const state = await tx.trabajo_avatar.findUniqueOrThrow({ where: { id } });
        if (state.estado !== 'PROCESANDO') throw new Error('CANCELADO');
        const template = await tx.plantilla_corporal.findUniqueOrThrow({
          where: { nombre_version: { nombre: 'Cuerpo neutro G18', version: '1.0' } },
        });
        const max = await tx.avatar.aggregate({
          where: { usuario_id: job.usuario_id },
          _max: { version: true },
        });
        const avatar = await tx.avatar.create({
          data: {
            usuario_id: job.usuario_id,
            plantilla_id: template.id,
            version: (max._max.version || 0) + 1,
            clave_glb: 'private/jobs/' + id + '/avatar.glb',
            medidas: result.medidas!,
            parametros_malla: result.parametros_malla || {},
            estado: 'EN_REVISION',
            creado_en: new Date(),
          },
        });
        await tx.trabajo_avatar.update({
          where: { id },
          data: {
            avatar_id: avatar.id,
            estado: 'COMPLETADO',
            terminado_en: new Date(),
            parametros: Prisma.DbNull,
          },
        });
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'PROCESAMIENTO_FALLIDO';
      await this.db.trabajo_avatar.updateMany({
        where: { id, estado: 'PROCESANDO' },
        data: {
          estado: 'FALLIDO',
          error_codigo: /^[A-Z_]{3,60}$/.test(code) ? code : 'PROCESAMIENTO_FALLIDO',
          terminado_en: new Date(),
          parametros: Prisma.DbNull,
        },
      });
      await removeStored('private/jobs/' + id);
    } finally {
      await unlink(input).catch(() => {});
      await this.purgeCapture(job.captura_id);
    }
  }
}
