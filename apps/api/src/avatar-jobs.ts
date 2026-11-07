import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Db } from './db';
import { storedPath, removeStored } from './storage';
import { spawn, ChildProcess } from 'child_process';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { resolve } from 'path';
import { Prisma } from '@prisma/client';
import { TenantRegistry } from './tenancy/platform';
import { currentTenant, runForTenant } from './tenancy/context';
import { QuotaService } from './billing/quota.service';
import { retainedJobMetadata, releaseAvatarQuota, avatarAudit } from './avatars/lifecycle';
import {
  validatePersonalGlb,
  AvatarMeasuresSchema,
  AvatarParametersSchema,
} from './avatars/validate-glb';
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
    @Inject(QuotaService) private quota: QuotaService,
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
        { windowsHide: true, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] },
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
        if (this.child === child) this.child = undefined;
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
  private async fail(id: string, code: string, attempt?: number) {
    const safeCode = /^[A-Z_]{3,60}$/.test(code) ? code : 'PROCESAMIENTO_FALLIDO';
    return this.db.$transaction(async (tx) => {
      const job = await tx.trabajo_avatar.findUnique({ where: { id } });
      if (!job) return;
      const changed = await tx.trabajo_avatar.updateMany({
        where: {
          id,
          estado: { in: ['EN_COLA', 'PROCESANDO'] },
          ...(attempt === undefined ? {} : { intentos: attempt }),
        },
        data: {
          estado: 'FALLIDO',
          error_codigo: safeCode,
          terminado_en: new Date(),
          parametros: retainedJobMetadata(job.parametros),
        },
      });
      if (changed.count) {
        await releaseAvatarQuota(tx, this.quota, id);
        await avatarAudit(tx, job.usuario_id, id, 'AVATAR_FAILED', job.idempotencia, {
          jobId: id,
          code: safeCode,
        });
      }
    });
  }
  async tick(): Promise<void> {
    if (!currentTenant())
      return runForTenant(await this.registry.resolve('lumina'), () => this.tick());
    if (this.busy) return;
    this.busy = true;
    try {
      const expired = await this.db.captura_corporal.findMany({
        where: { purgada_en: null, purgar_antes_de: { lt: new Date() } },
      });
      for (const c of expired) {
        const pending = await this.db.trabajo_avatar.findMany({
          where: { captura_id: c.id, estado: { in: ['EN_COLA', 'PROCESANDO'] } },
          select: { id: true },
        });
        for (const job of pending) await this.fail(job.id, 'CAPTURA_VENCIDA');
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
      const exhausted = await this.db.trabajo_avatar.findMany({
        where: {
          intentos: { gte: 3 },
          OR: [
            { estado: 'EN_COLA' },
            { estado: 'PROCESANDO', iniciado_en: { lt: new Date(Date.now() - 10 * 60000) } },
          ],
        },
        select: { id: true, intentos: true, captura_id: true },
      });
      for (const job of exhausted) {
        await this.fail(job.id, 'INTENTOS_AGOTADOS', job.intentos);
        if (job.captura_id) await this.purgeCapture(job.captura_id);
      }
      // Already accepted jobs retain their reserved entitlement even if the plan expires.
      const rows = await this.db.$queryRaw<{ id: string }[]>`
        UPDATE trabajo_avatar SET estado='PROCESANDO',iniciado_en=now(),intentos=intentos+1
        WHERE id=(SELECT id FROM trabajo_avatar WHERE estado='EN_COLA' AND tipo='GENERAR' AND intentos<3
        ORDER BY creado_en FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`;
      if (rows.length) await this.process(rows[0].id);
      const deletions = await this.db.avatar.findMany({ where: { estado: 'ELIMINANDO' } });
      for (const a of deletions) {
        const related = await this.db.trabajo_avatar.findMany({
          where: {
            OR: [
              { avatar_id: a.id },
              {
                parametros: { path: ['sourceAvatarId'], equals: a.id },
                estado: { in: ['CANCELADO', 'FALLIDO'] },
              },
            ],
          },
        });
        for (const job of related) {
          if (job.captura_id) await this.purgeCapture(job.captura_id);
          await removeStored('private/jobs/' + job.id);
        }
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
          ...related.map((job) =>
            this.db.trabajo_avatar.update({
              where: { id: job.id },
              data: { parametros: retainedJobMetadata(job.parametros) },
            }),
          ),
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
    if (!job.captura_id) {
      await this.fail(id, 'CAPTURA_NO_DISPONIBLE', job.intentos);
      return;
    }
    const jobDirectory = `private/jobs/${id}/attempt-${job.intentos}`;
    const folder = storedPath(jobDirectory);
    await mkdir(folder, { recursive: true });
    const input = resolve(folder, 'input.json');
    try {
      const reserved = await this.db.consumo_cuota.findUnique({ where: { trabajo_avatar_id: id } });
      if (reserved?.estado !== 'RESERVADO') throw new Error('CUOTA_NO_RESERVADA');
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
      if (
        latest.estado !== 'PROCESANDO' ||
        latest.intentos !== job.intentos ||
        stillConsent.revocado_en
      ) {
        if (stillConsent.revocado_en) await this.fail(id, 'CONSENTIMIENTO_REVOCADO', job.intentos);
        await removeStored(jobDirectory);
        return;
      }
      if (!result.ok || !result.avatar_file || !result.medidas)
        throw new Error(result.error_code || 'PROCESAMIENTO_FALLIDO');
      const generated = resolve(result.avatar_file);
      if (generated !== resolve(folder, 'avatar.glb')) throw new Error('SALIDA_INVALIDA');
      const measures = AvatarMeasuresSchema.safeParse(result.medidas),
        parameters = AvatarParametersSchema.safeParse(result.parametros_malla);
      if (
        !measures.success ||
        !parameters.success ||
        Math.abs(measures.data.altura.valor_cm - Number(capture.altura_cm)) > 0.01 ||
        Math.abs(parameters.data.height - Number(capture.altura_cm) / 100) > 0.001
      )
        throw new Error('MEDIDAS_SALIDA_INVALIDAS');
      await validatePersonalGlb(generated, Number(capture.altura_cm));
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM usuario WHERE id=${job.usuario_id}::uuid FOR UPDATE`;
        const state = await tx.trabajo_avatar.findUniqueOrThrow({ where: { id } });
        if (state.estado !== 'PROCESANDO' || state.intentos !== job.intentos)
          throw new Error('CANCELADO');
        const consentNow = await tx.consentimiento.findUniqueOrThrow({ where: { id: consent.id } });
        if (consentNow.revocado_en) throw new Error('CONSENTIMIENTO_REVOCADO');
        if (capture.purgar_antes_de < new Date()) throw new Error('CAPTURA_VENCIDA');
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
            clave_glb: jobDirectory + '/avatar.glb',
            medidas: measures.data,
            parametros_malla: parameters.data,
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
            parametros: retainedJobMetadata(job.parametros),
          },
        });
        await this.quota.commit(tx, 'AVATAR_GENERACION', id);
        await avatarAudit(tx, job.usuario_id, avatar.id, 'AVATAR_GENERATED', job.idempotencia, {
          jobId: id,
          avatarId: avatar.id,
          version: avatar.version,
          state: 'EN_REVISION',
        });
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : 'PROCESAMIENTO_FALLIDO';
      await this.fail(id, code, job.intentos);
      await removeStored(jobDirectory);
    } finally {
      await unlink(input).catch(() => {});
      const finalJob = await this.db.trabajo_avatar.findUnique({ where: { id } });
      if (
        finalJob?.intentos === job.intentos &&
        !['EN_COLA', 'PROCESANDO'].includes(finalJob.estado)
      )
        await this.purgeCapture(job.captura_id);
    }
  }
}
