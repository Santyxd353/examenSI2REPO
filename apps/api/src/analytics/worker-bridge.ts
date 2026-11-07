import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  AnalyticsJobSchema,
  HashSchema,
  TimestampSchema,
  UuidSchema,
  type AnalyticsJobV1,
} from '@lumina/contracts';
import { z } from 'zod';

const defaultTimeoutMs = 5 * 60_000;
const demandTimeoutMs = 60 * 60_000;
const maxStdout = 64 * 1024;
const maxResult = 32 * 1024 * 1024;
const protocol = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    jobId: UuidSchema,
    resultPath: z.string().max(180),
    sha256: HashSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    jobId: UuidSchema.nullable(),
    error: z.strictObject({
      code: z.string().regex(/^[A-Z_]{3,80}$/),
      message: z.string().max(500),
    }),
  }),
]);
const resultEnvelope = z.looseObject({
  schemaVersion: z.literal('1.0'),
  jobId: UuidSchema,
  tenantId: UuidSchema,
  actorId: UuidSchema,
  source: z.enum(['REAL', 'DEMOSTRACION_SINTETICA']),
  action: z.string(),
  datasetId: z.string().nullable(),
  modelId: UuidSchema.nullable(),
  horizonDays: z.union([z.literal(7), z.literal(30)]).nullable(),
  generatedAt: TimestampSchema,
  limitations: z.array(z.string().max(1000)).max(100),
});

export class AnalyticsWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AnalyticsWorkerError';
  }
}
const invalid = () =>
  new AnalyticsWorkerError(
    'ANALYTICS_PROTOCOL_INVALID',
    'La salida del análisis no coincide con el protocolo.',
  );
const badPath = () =>
  new AnalyticsWorkerError(
    'ANALYTICS_PATH_INVALID',
    'El artefacto se encuentra fuera del espacio privado.',
  );

function within(root: string, path: string) {
  const tail = relative(root, path);
  return Boolean(tail) && tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail);
}

export async function readAnalyticsBytes(
  root: string,
  path: string,
  sha256: string | null,
  limit: number,
) {
  const target = resolve(root, path);
  if (!within(root, target)) throw badPath();
  const base = await realpath(root);
  const actual = await realpath(target);
  if (!within(base, actual)) throw badPath();
  const file = await open(actual, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit) throw invalid();
    const bytes = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw invalid();
      offset += bytesRead;
    }
    if (
      (await file.stat()).size !== bytes.length ||
      (sha256 !== null && createHash('sha256').update(bytes).digest('hex') !== sha256)
    )
      throw new AnalyticsWorkerError(
        'ANALYTICS_HASH_MISMATCH',
        'El archivo cambió desde la generación del análisis.',
      );
    return bytes;
  } finally {
    await file.close();
  }
}

export const verifiedAnalyticsBytes = readAnalyticsBytes;
export function analyticsRoot(tenant: string, actor: string) {
  return resolve('.local', 'analytics-private', UuidSchema.parse(tenant), UuidSchema.parse(actor));
}

export async function readAnalyticsOutput(root: string, job: AnalyticsJobV1, raw: unknown) {
  const parsed = protocol.safeParse(raw);
  if (!parsed.success || parsed.data.jobId !== job.jobId) throw invalid();
  const response = parsed.data;
  if (!response.ok)
    throw new AnalyticsWorkerError(response.error.code, 'El worker no pudo completar el análisis.');
  if (response.resultPath !== 'results/' + job.jobId + '.json') throw invalid();
  const bytes = await verifiedAnalyticsBytes(root, response.resultPath, response.sha256, maxResult);
  let body: unknown;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalid();
  }
  const result = resultEnvelope.safeParse(body);
  if (!result.success) throw invalid();
  const value = result.data;
  const modelId =
    job.action === 'TRAIN_DEMAND' || job.action === 'TRAIN_ANOMALY'
      ? job.jobId
      : (job.modelId ?? null);
  if (
    value.jobId !== job.jobId ||
    value.tenantId !== job.tenantId ||
    value.actorId !== job.actorId ||
    value.source !== job.source ||
    value.action !== job.action ||
    value.datasetId !== (job.datasetId ?? null) ||
    value.modelId !== modelId ||
    value.horizonDays !== (job.horizonDays ?? null)
  )
    throw new AnalyticsWorkerError(
      'ANALYTICS_SCOPE_MISMATCH',
      'El resultado pertenece a otro análisis.',
    );
  return value;
}

function executePython(
  executable: string,
  cwd: string,
  request: string,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<{ code: number | null; output: unknown }>((done, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|LANG)$/i.test(key),
      ),
    );
    const child = spawn(executable, ['-m', 'lumina_analytics.cli', '--job', request], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...env,
        PYTHONUTF8: '1',
        OPENBLAS_NUM_THREADS: '1',
        OMP_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
      },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const abort = () => {
      failure = new AnalyticsWorkerError(
        'ANALYTICS_INTERRUPTED',
        'El servidor interrumpió el análisis. Puedes iniciar uno nuevo.',
      );
      child.kill('SIGKILL');
    };
    let size = 0;
    let failure: AnalyticsWorkerError | undefined;
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      failure = new AnalyticsWorkerError(
        'ANALYTICS_TIMEOUT',
        'El análisis superó su tiempo máximo.',
      );
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (buffer: Buffer) => {
      size += buffer.length;
      if (size > maxStdout) {
        failure = invalid();
        child.kill('SIGKILL');
      } else chunks.push(buffer);
    });
    child.once('error', () => {
      clearTimeout(timer);
      reject(
        new AnalyticsWorkerError(
          'ANALYTICS_WORKER_UNAVAILABLE',
          'No se pudo iniciar el entorno de análisis.',
        ),
      );
    });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timer);
      if (failure) {
        reject(failure);
        return;
      }
      try {
        done({ code, output: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        reject(invalid());
      }
    });
  });
}

export class AnalyticsWorkerBridge {
  async run(input: Omit<AnalyticsJobV1, 'workDir'>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const executable = process.env.ANALYTICS_PYTHON_PATH;
    if (!executable || !isAbsolute(executable))
      throw new AnalyticsWorkerError(
        'ANALYTICS_WORKER_UNAVAILABLE',
        'Configura el entorno Python de análisis.',
      );
    const cwd = resolve('workers/analytics');
    const project = await realpath(resolve(cwd, '../..'));
    const tenant = UuidSchema.parse(input.tenantId);
    const actor = UuidSchema.parse(input.actorId);
    const jobId = UuidSchema.parse(input.jobId);
    const workDir = ['.local', 'analytics-private', tenant, actor].join('/');
    const job = AnalyticsJobSchema.parse({
      ...input,
      tenantId: tenant,
      actorId: actor,
      jobId,
      workDir,
    });
    const root = join(project, workDir);
    const requests = join(root, 'requests');
    await mkdir(requests, { recursive: true, mode: 0o700 });
    if (relative(requests, await realpath(requests))) throw badPath();
    const request = join(requests, randomUUID() + '.json');
    await writeFile(request, JSON.stringify(job), { mode: 0o600, flag: 'wx' });
    try {
      const timeout = job.action === 'TRAIN_DEMAND' ? demandTimeoutMs : defaultTimeoutMs;
      const child = await executePython(executable, cwd, request, timeout, signal);
      if (child.code !== 0 && protocol.safeParse(child.output).data?.ok !== false) throw invalid();
      return await readAnalyticsOutput(root, job, child.output);
    } finally {
      await unlink(request).catch(() => {});
    }
  }
}
