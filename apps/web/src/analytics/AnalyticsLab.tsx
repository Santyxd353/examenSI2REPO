import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BrainCircuit, Download, RefreshCw } from 'lucide-react';
import {
  AnalysisJobViewSchema,
  AnalysisRequestSchema,
  canonicalJson,
  type AnalysisJobView,
  type AnalysisRequest,
} from '@lumina/contracts';
import { offlineResponse } from '../api';
import { putJson, readJson } from '../offline/vault';
import type { OfflineSession } from '../offline/scope';
import type { ReportIdentity } from '../reporting/report-data';
import { ModelResults } from './ModelResults';
import '../reporting/reporting.css';
import './analytics.css';

const titles: Record<AnalysisRequest['action'], string> = {
  GENERATE_DATASET: 'Preparar dataset de demostración',
  TRAIN_DEMAND: 'Entrenar demanda',
  TRAIN_ANOMALY: 'Entrenar anomalías',
  FORECAST: 'Generar pronóstico',
  SUGGEST_RESTOCK: 'Proponer reposición',
};
const states: Record<AnalysisJobView['status'], string> = {
  QUEUED: 'En cola',
  RUNNING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Falló',
  INSUFFICIENT_DATA: 'Historial insuficiente',
};
const cacheKey = 'analytics:last-result';
export function AnalyticsLab({
  identity,
  online,
  session,
  enableOffline,
  readOnly,
  features,
  multiLocation,
}: {
  identity: ReportIdentity;
  online: boolean;
  session: OfflineSession | null;
  enableOffline: (signal: AbortSignal) => Promise<OfflineSession>;
  readOnly: boolean;
  features: string[];
  multiLocation: boolean;
}) {
  const { actorId, tenantId, slug } = identity;
  const [jobs, setJobs] = useState<AnalysisJobView[]>([]);
  const [selected, setSelected] = useState('');
  const [source, setSource] = useState<AnalysisRequest['source']>('DEMOSTRACION_SINTETICA');
  const [action, setAction] = useState<AnalysisRequest['action']>('GENERATE_DATASET');
  const [dataset, setDataset] = useState('');
  const [model, setModel] = useState('');
  const [forecast, setForecast] = useState('');
  const [horizon, setHorizon] = useState<7 | 30>(7);
  const [channel, setChannel] = useState('WEB');
  const [locations, setLocations] = useState(['demo-ubicacion-01']);
  const [realLocation, setRealLocation] = useState('');
  const [realLocations, setRealLocations] = useState<{ id: string; nombre: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const intent = useRef<{ hash: string; id: string } | null>(null);
  const job = jobs.find((item) => item.id === selected);
  const ready = jobs.filter((item) => item.source === source && item.status === 'COMPLETED');
  const ml = features.includes('ml');
  const business = multiLocation;

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
      lifecycle.current = null;
    };
  }, [actorId, tenantId, slug]);
  async function load(signal: AbortSignal) {
    const response = await offlineResponse({ slug, actorId }, '/api/analytics/jobs', { signal });
    const body = await response.json();
    const list = (body.jobs as unknown[]).map((value) => AnalysisJobViewSchema.parse(value));
    signal.throwIfAborted();
    setJobs((previous) =>
      list.map((item) => ({
        ...item,
        result:
          previous.find((old) => old.id === item.id && old.status === item.status)?.result ?? null,
      })),
    );
    setSelected((old) => (list.some((item) => item.id === old) ? old : (list[0]?.id ?? '')));
  }
  useEffect(() => {
    if (!online || !job || job.status !== 'COMPLETED' || job.result) return;
    const controller = new AbortController();
    void offlineResponse({ slug, actorId }, '/api/analytics/jobs/' + job.id, {
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((raw) => {
        const detail = AnalysisJobViewSchema.parse(raw);
        if (!controller.signal.aborted)
          setJobs((old) => old.map((item) => (item.id === detail.id ? detail : item)));
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [online, job?.id, job?.status, Boolean(job?.result), slug, actorId]);
  useEffect(() => {
    if (!online || !ml) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let active = true;
    const refresh = () =>
      void load(signal).catch((reason) => {
        if (active && !signal.aborted) setError(reason.message);
      });
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [online, ml, actorId, tenantId, slug]);
  useEffect(() => {
    const signal = lifecycle.current?.signal;
    if (!online || !ml || !signal) return;
    void offlineResponse(identity, '/api/locations', { signal })
      .then((response) => response.json())
      .then((body) => {
        signal.throwIfAborted();
        const list = Array.isArray(body) ? body : body.locations;
        if (Array.isArray(list))
          setRealLocations(
            list.filter((row) => typeof row.id === 'string' && typeof row.nombre === 'string'),
          );
      })
      .catch(() => {});
  }, [online, ml, actorId, tenantId, slug]);
  useEffect(() => {
    if (online || !session || session.actorId !== actorId || session.tenantId !== tenantId) return;
    let active = true;
    void readJson<{ actorId: string; tenantId: string; job: AnalysisJobView }>(session, cacheKey)
      .then((row) => {
        if (!active || !row) return;
        if (row.data.actorId !== actorId || row.data.tenantId !== tenantId)
          throw new Error('La copia pertenece a otra sesión.');
        const local = AnalysisJobViewSchema.parse(row.data.job);
        setJobs([local]);
        setSelected(local.id);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [online, session, actorId, tenantId]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const signal = lifecycle.current?.signal;
    if (!signal || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        source,
        action,
        channel,
        ...(source === 'DEMOSTRACION_SINTETICA'
          ? { locationIds: locations }
          : { ...(realLocation ? { locationIds: [realLocation] } : {}) }),
        ...(action === 'TRAIN_DEMAND' || action === 'TRAIN_ANOMALY'
          ? { datasetJobId: dataset || undefined }
          : {}),
        ...(action === 'FORECAST' ? { modelJobId: model || undefined, horizonDays: horizon } : {}),
        ...(action === 'SUGGEST_RESTOCK' && source === 'DEMOSTRACION_SINTETICA'
          ? { forecastJobId: forecast || undefined }
          : {}),
      };
      const hash = canonicalJson(payload);
      if (intent.current?.hash !== hash) intent.current = { hash, id: crypto.randomUUID() };
      const body = AnalysisRequestSchema.parse({ ...payload, operationId: intent.current.id });
      const response = await offlineResponse(identity, '/api/analytics/jobs', {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      });
      const next = AnalysisJobViewSchema.parse(await response.json());
      signal.throwIfAborted();
      intent.current = null;
      setJobs((old) => [next, ...old.filter((value) => value.id !== next.id)]);
      setSelected(next.id);
      setMessage(
        next.status === 'QUEUED'
          ? 'El análisis quedó en cola. Puedes continuar trabajando.'
          : (next.message ?? 'Consulta preparada.'),
      );
    } catch (reason) {
      if (!signal.aborted)
        setError(reason instanceof Error ? reason.message : 'Revisa los datos de la solicitud.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  async function save() {
    const signal = lifecycle.current?.signal;
    if (!signal || !job?.result) return;
    setBusy(true);
    setError('');
    try {
      const local = session ?? (await enableOffline(signal));
      if (local.actorId !== actorId || local.tenantId !== tenantId)
        throw new Error('La sesión cambió.');
      await putJson(local, cacheKey, { actorId, tenantId, job });
      signal.throwIfAborted();
      setMessage('Resultado cifrado guardado para consultar sin conexión.');
    } catch (reason) {
      if (!signal.aborted) setError((reason as Error).message);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  function download() {
    if (!job) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(job, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lumina-analisis-' + job.source.toLowerCase() + '.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (online && !ml)
    return (
      <section className="report-builder">
        <h1>Análisis de datos</h1>
        <p className="report-warning">
          Demanda y reposición están disponibles en Profesional y Negocio. Negocio incluye anomalías
          y comparación entre ubicaciones.
        </p>
      </section>
    );
  return (
    <section className="report-builder analysis-lab">
      <header className="report-builder-header">
        <div>
          <p className="report-kicker">
            <BrainCircuit size={17} /> ANÁLISIS DE DATOS
          </p>
          <h1>Laboratorio de análisis</h1>
          <p>Entrena, evalúa y consulta propuestas con su fuente y sus limitaciones.</p>
        </div>
        {online && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void load(lifecycle.current!.signal).catch((reason) => setError(reason.message))
            }
          >
            <RefreshCw size={16} />
            Actualizar análisis
          </button>
        )}
      </header>
      {!online && (
        <p className="report-warning">
          Sin conexión. Los filtros exploran el resultado guardado en este dispositivo.
        </p>
      )}
      {error && (
        <p className="report-warning" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {online && (
        <form className="report-panel" onSubmit={create}>
          <h2>Preparar un análisis</h2>
          <div className="report-fields">
            <label>
              Fuente del análisis
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value as typeof source);
                  setAction(e.target.value === 'REAL' ? 'SUGGEST_RESTOCK' : 'GENERATE_DATASET');
                }}
              >
                <option value="DEMOSTRACION_SINTETICA">Demostración sintética</option>
                <option value="REAL">Datos de mi tienda</option>
              </select>
            </label>
            <label>
              Tipo de análisis
              <select value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
                {(Object.entries(titles) as [AnalysisRequest['action'], string][])
                  .filter(
                    ([key]) =>
                      source === 'DEMOSTRACION_SINTETICA' ||
                      key === 'SUGGEST_RESTOCK' ||
                      key === 'FORECAST',
                  )
                  .filter(([key]) => key !== 'TRAIN_ANOMALY' || business)
                  .map(([key, title]) => (
                    <option key={key} value={key}>
                      {title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Canal del análisis
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="WEB">Web</option>
                <option value="APP">App</option>
                <option value="TIENDA">Tienda</option>
              </select>
            </label>
            {source === 'REAL' && (
              <label>
                Ubicación para analizar
                <select value={realLocation} onChange={(e) => setRealLocation(e.target.value)}>
                  <option value="">Ubicación autorizada principal</option>
                  {realLocations.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {source === 'DEMOSTRACION_SINTETICA' && (
              <label>
                Ubicaciones de demostración
                <select
                  multiple={business}
                  value={business ? locations : locations[0]}
                  onChange={(e) =>
                    setLocations(
                      business
                        ? Array.from(e.target.selectedOptions, (option) => option.value)
                        : [e.target.value],
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map((i) => (
                    <option key={i} value={'demo-ubicacion-0' + i}>
                      Ubicación {i} · Demostración
                    </option>
                  ))}
                </select>
              </label>
            )}
            {source === 'DEMOSTRACION_SINTETICA' &&
              (action === 'TRAIN_DEMAND' || action === 'TRAIN_ANOMALY') && (
                <label>
                  Dataset generado
                  <select required value={dataset} onChange={(e) => setDataset(e.target.value)}>
                    <option value="">Seleccionar</option>
                    {ready
                      .filter((item) => item.action === 'GENERATE_DATASET')
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {new Date(item.createdAt).toLocaleString('es-BO')}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            {action === 'FORECAST' && (
              <>
                {source === 'DEMOSTRACION_SINTETICA' && (
                  <label>
                    Modelo de demanda
                    <select required value={model} onChange={(e) => setModel(e.target.value)}>
                      <option value="">Seleccionar</option>
                      {ready
                        .filter((item) => item.action === 'TRAIN_DEMAND')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.result?.model?.version} ·{' '}
                            {new Date(item.createdAt).toLocaleDateString('es-BO')}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <label>
                  Horizonte
                  <select
                    value={horizon}
                    onChange={(e) => setHorizon(Number(e.target.value) as 7 | 30)}
                  >
                    <option value={7}>7 días</option>
                    <option value={30}>30 días</option>
                  </select>
                </label>
              </>
            )}
            {action === 'SUGGEST_RESTOCK' && source === 'DEMOSTRACION_SINTETICA' && (
              <label>
                Pronóstico para reposición
                <select required value={forecast} onChange={(e) => setForecast(e.target.value)}>
                  <option value="">Seleccionar</option>
                  {ready
                    .filter((item) => item.action === 'FORECAST')
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.result?.period.from} a {item.result?.period.to}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button className="primary" type="submit" disabled={busy || readOnly}>
              {busy ? 'Guardando…' : 'Iniciar análisis'}
            </button>
          </div>
          {action === 'TRAIN_DEMAND' && (
            <p>
              El entrenamiento y la evaluación temporal pueden tardar varios minutos. El servidor
              conserva el trabajo mientras sigues usando la tienda.
            </p>
          )}
        </form>
      )}
      <article className="report-panel">
        <div className="report-fields">
          <label>
            Análisis guardado
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Seleccionar</option>
              {jobs.map((item) => (
                <option key={item.id} value={item.id}>
                  {titles[item.action]} · {states[item.status]} ·{' '}
                  {new Date(item.createdAt).toLocaleString('es-BO')}
                </option>
              ))}
            </select>
          </label>
        </div>
        {job && (
          <>
            <p
              className={'analysis-state analysis-state-' + job.status.toLowerCase()}
              role="status"
            >
              {states[job.status]}
            </p>
            {job.message && <p className="report-warning">{job.message}</p>}
            {job.status === 'RUNNING' && (
              <p>
                El servidor está procesando este análisis. La pantalla actualizará su estado
                automáticamente.
              </p>
            )}
            {job.result && (
              <div className="report-toolbar">
                {online && (
                  <button className="secondary" disabled={busy} onClick={save}>
                    Guardar análisis sin conexión
                  </button>
                )}
                <button className="secondary" onClick={download}>
                  <Download size={16} />
                  Descargar resultado
                </button>
              </div>
            )}
          </>
        )}
        {!jobs.length && (
          <p>
            {online
              ? 'Todavía no hay análisis guardados.'
              : 'No hay un resultado descargado para esta cuenta.'}
          </p>
        )}
      </article>
      {job?.result && <ModelResults key={job.id} result={job.result} />}
    </section>
  );
}
