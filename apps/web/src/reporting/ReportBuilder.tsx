import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChartNoAxesCombined, Download, Printer, WifiOff } from 'lucide-react';
import {
  ReportDatasetSchema,
  ReportDefinitionSchema,
  type CrossFilterSelection,
  type ReportDataset,
  type ReportDefinition,
} from '@lumina/contracts';
import { applyCrossFilter, boliviaDate, executeReport, exportReportCsv } from '@lumina/reporting';
import { ApiError, offlineResponse } from '../api';
import type { OfflineSession } from '../offline/scope';
import { putJson, readJson, removeLocal } from '../offline/vault';
import { Reports } from '../Reports';
import { Dashboard } from './Dashboard';
import { Filters } from './Filters';
import { defaultReport, ReportLayout } from './ReportLayout';
import {
  fetchReportDataset,
  fields,
  label,
  reportCopyKey,
  type LocalReport,
  type ReportIdentity,
} from './report-data';
import { SavedReports } from './SavedReports';
import { VoiceRequest } from './VoiceRequest';
import './reporting.css';

const today = () => boliviaDate(new Date().toISOString());
const firstDay = () => boliviaDate(new Date(Date.now() - 29 * 86_400_000).toISOString());
const readError = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.';

export function ReportBuilder({
  identity,
  online,
  session,
  enableOffline,
  readOnly,
  aiEnabled,
}: {
  identity: ReportIdentity;
  online: boolean;
  session: OfflineSession | null;
  enableOffline: (signal: AbortSignal) => Promise<OfflineSession>;
  readOnly: boolean;
  aiEnabled: boolean;
}) {
  const { slug, actorId, tenantId } = identity;
  const [source, setSource] = useState<ReportDataset['source']>('REAL');
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<ReportDataset | null>(null);
  const [draft, setDraft] = useState<ReportDefinition | null>(null);
  const [applied, setApplied] = useState<ReportDefinition | null>(null);
  const [cross, setCross] = useState<CrossFilterSelection>(null);
  const [savedCopyId, setSavedCopyId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const verifiedCut = useRef<string | null>(null);
  const prepared = useRef<{ key: string; data: ReportDataset } | null>(null);
  const preparationKey = source + ':' + (source === 'REAL' ? from + ':' + to : 'demo');

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
      lifecycle.current = null;
    };
  }, []);

  useEffect(() => {
    if (
      online ||
      !session ||
      (data && data.datasetId === savedCopyId) ||
      session.actorId !== actorId ||
      session.tenantId !== tenantId ||
      session.slug !== slug
    )
      return;
    let active = true;
    void readJson<LocalReport>(session, reportCopyKey)
      .then((row) => {
        if (!active || !row) return;
        const dataset = ReportDatasetSchema.parse(row.data.dataset);
        const definition = ReportDefinitionSchema.parse(row.data.definition);
        if (
          dataset.ownerId !== actorId ||
          dataset.tenantId !== tenantId ||
          dataset.datasetId !== definition.datasetId
        )
          throw new Error('La copia de reportes pertenece a otra sesión.');
        setData(dataset);
        setDraft(definition);
        setApplied(definition);
        setCross(null);
        setSavedCopyId(dataset.datasetId);
      })
      .catch((reason) => {
        if (active) setError(readError(reason));
      });
    return () => {
      active = false;
    };
  }, [online, session, data, savedCopyId, actorId, tenantId, slug]);

  useEffect(() => {
    if (!online) {
      verifiedCut.current = null;
      return;
    }
    if (!savedCopyId || data?.datasetId !== savedCopyId || verifiedCut.current === savedCopyId)
      return;
    const controller = new AbortController();
    setChecking(true);
    void offlineResponse({ slug, actorId }, '/api/reports/datasets/' + savedCopyId, {
      signal: controller.signal,
    })
      .then(() => {
        if (!controller.signal.aborted) verifiedCut.current = savedCopyId;
      })
      .catch(async (reason) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiError && [401, 403, 404, 410].includes(reason.status)) {
          setData(null);
          setDraft(null);
          setApplied(null);
          setSavedCopyId(null);
          setCross(null);
          if (session) await removeLocal(session, [reportCopyKey]).catch(() => {});
          setMessage('');
          setError('Actualiza el corte para seguir consultando este reporte. ' + reason.message);
        } else setError(readError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => {
      controller.abort();
      setChecking(false);
    };
  }, [online, savedCopyId, data?.datasetId, slug, actorId, session]);

  const output = useMemo(() => {
    if (!applied || !data) return null;
    try {
      const definition = applyCrossFilter(applied, cross);
      return { definition, result: executeReport(definition, data), error: '' };
    } catch (reason) {
      return { error: readError(reason), definition: null, result: null };
    }
  }, [applied, cross, data]);

  async function prepareDataset(signal: AbortSignal, reuse = false): Promise<ReportDataset> {
    if (reuse && prepared.current?.key === preparationKey) return prepared.current.data;
    if (!online) throw new Error('Necesitas conexión para consultar a la IA.');
    if (from > to || to > today())
      throw new Error('Selecciona un período válido antes de consultar.');
    setBusy('Preparando corte…');
    setError('');
    setMessage('');
    try {
      const dataset = await fetchReportDataset(
        identity,
        source === 'REAL' ? { source, period: { from, to } } : { source },
        signal,
        (loaded, total) => setBusy('Descargando hechos ' + loaded + ' de ' + total + '…'),
      );
      const definition = defaultReport(dataset);
      prepared.current = { key: preparationKey, data: dataset };
      verifiedCut.current = dataset.datasetId;
      setData(dataset);
      setDraft(definition);
      setApplied(definition);
      setCross(null);
      return dataset;
    } finally {
      if (!signal.aborted) setBusy('');
    }
  }

  async function prepare(event: FormEvent) {
    event.preventDefault();
    const signal = lifecycle.current?.signal;
    if (!signal || !online || busy || assistantBusy) return;
    try {
      await prepareDataset(signal);
    } catch (reason) {
      if (!signal.aborted) setError(readError(reason));
    }
  }

  function applyAssistant(definition: ReportDefinition) {
    if (definition.datasetId !== data?.datasetId) return;
    setDraft(definition);
    setApplied(definition);
    setCross(null);
  }

  async function saveOffline() {
    const signal = lifecycle.current?.signal;
    if (
      !signal ||
      !data ||
      !output?.definition ||
      busy ||
      (!online && savedCopyId !== data.datasetId)
    )
      return;
    setBusy('Guardando copia cifrada…');
    setError('');
    setMessage('');
    try {
      const authorized = session ?? (await enableOffline(signal));
      signal.throwIfAborted();
      if (
        authorized.actorId !== actorId ||
        authorized.tenantId !== tenantId ||
        authorized.slug !== slug
      )
        throw new Error('Cambió la sesión antes de guardar el reporte.');
      await putJson(authorized, reportCopyKey, {
        dataset: data,
        definition: output.definition,
      } satisfies LocalReport);
      signal.throwIfAborted();
      setSavedCopyId(data.datasetId);
      setMessage('Copia cifrada guardada en este dispositivo.');
    } catch (reason) {
      if (!signal.aborted) setError(readError(reason));
    } finally {
      if (!signal.aborted) setBusy('');
    }
  }

  function csv() {
    if (!output?.result) return;
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', exportReportCsv(output.result)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'lumina-reporte-' + output.result.source.toLowerCase() + '.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const visible = !checking && (online || savedCopyId === data?.datasetId);
  if (legacy && online)
    return (
      <>
        <button className="secondary" onClick={() => setLegacy(false)}>
          Volver a reportes personalizados
        </button>
        <Reports />
      </>
    );
  return (
    <section className="report-builder">
      <header className="report-builder-header">
        <div>
          <p className="report-kicker">
            <ChartNoAxesCombined size={16} /> ANÁLISIS DE LA TIENDA
          </p>
          <h1>Reportes personalizados</h1>
          <p>Explora ventas, devoluciones e inventario con los datos de tu espacio.</p>
        </div>
        {online && (
          <button className="secondary" onClick={() => setLegacy(true)}>
            Resumen de ventas
          </button>
        )}
      </header>
      {online ? (
        <form className="report-panel report-control" onSubmit={prepare}>
          <h2>Datos para tu reporte</h2>
          <p>
            Selecciona la fuente y el período. Puedes consultar a la IA o preparar el reporte
            manualmente.
          </p>
          <fieldset className="report-source-fields" disabled={Boolean(busy) || assistantBusy}>
            <div className="report-fields">
              <label>
                Fuente
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as ReportDataset['source'])}
                >
                  <option value="REAL">Datos de mi tienda</option>
                  <option value="DEMOSTRACION_SINTETICA">Demostración sintética</option>
                </select>
              </label>
              {source === 'REAL' && (
                <>
                  <label>
                    Inicio de descarga
                    <input
                      required
                      type="date"
                      max={today()}
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Fin de descarga
                    <input
                      required
                      type="date"
                      min={from}
                      max={today()}
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </>
              )}
              <button type="submit" className="primary" disabled={Boolean(busy)}>
                Preparar datos
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <p className="report-warning report-control">
          <WifiOff size={16} />{' '}
          {visible && data
            ? 'Sin conexión. Los filtros y gráficos usan el corte guardado en este dispositivo.'
            : 'Conéctate y guarda un corte cifrado para abrir reportes sin conexión.'}
        </p>
      )}
      {online &&
        (aiEnabled && !readOnly ? (
          <VoiceRequest
            key={'assistant:' + preparationKey}
            data={data}
            identity={identity}
            prepare={(signal) => prepareDataset(signal, true)}
            review={setDraft}
            apply={applyAssistant}
            onBusy={setAssistantBusy}
          />
        ) : (
          <p className="report-criteria report-control">
            Las consultas por IA y voz requieren un plan Profesional o Negocio activo. Puedes seguir
            usando los reportes manuales.
          </p>
        ))}
      {busy && (
        <p role="status" className="report-control">
          {busy}
        </p>
      )}
      {message && (
        <p role="status" className="report-control">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="report-warning report-control">
          {error}
        </p>
      )}
      {checking && <p role="status">Comprobando permisos del corte…</p>}
      {visible && data && draft && (
        <div className="report-content">
          <div className="report-cut">
            <strong>
              {data.source === 'REAL' ? 'Datos de mi tienda' : 'DEMOSTRACIÓN SINTÉTICA'}
            </strong>
            <span>
              Corte {new Date(data.asOf).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}{' '}
              (Bolivia)
            </span>
            <span>
              {data.periodFrom} a {data.periodTo} · {data.downloadedLocationIds.length} ubicaciones
              · {data.rowCount} hechos
            </span>
            {!data.complete && (
              <strong>Cobertura parcial. Consulta las advertencias del resultado.</strong>
            )}
          </div>
          {output?.error && (
            <p className="report-warning" role="alert">
              {output.error}
            </p>
          )}
          {output?.result && output.definition && (
            <>
              <div className="report-toolbar report-control">
                <a className="report-edit-link" href="#report-settings">
                  Editar filtros y diseño
                </a>
                {cross && (
                  <button type="button" className="secondary" onClick={() => setCross(null)}>
                    Quitar selección {fields[cross.dimension]} ·{' '}
                    {label(data, cross.dimension, cross.value)}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(busy)}
                  onClick={saveOffline}
                >
                  {online ? 'Guardar copia sin conexión' : 'Guardar diseño en la copia'}
                </button>
                <button type="button" className="secondary" onClick={csv}>
                  <Download size={16} /> Descargar CSV
                </button>
                <button type="button" className="secondary" onClick={() => window.print()}>
                  <Printer size={16} /> Imprimir / PDF
                </button>
              </div>
              <Dashboard
                data={data}
                definition={output.definition}
                result={output.result}
                select={
                  applied?.dashboard.crossFilter && applied.filters.length < 20
                    ? (dimension, value) => setCross({ dimension, value })
                    : undefined
                }
              />
            </>
          )}
          {online && (
            <SavedReports
              key={'saved:' + data.datasetId}
              identity={identity}
              data={data}
              draft={draft}
              readOnly={readOnly}
              load={(definition) => {
                setDraft(definition);
                setApplied(definition);
                setCross(null);
              }}
            />
          )}
          <form
            id="report-settings"
            className="report-panel report-control"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(draft);
              setCross(null);
            }}
          >
            <ReportLayout
              data={data}
              draft={draft}
              change={(update) => setDraft({ ...draft, ...update })}
            />
            <Filters
              key={data.datasetId + draft.fact}
              data={data}
              definition={draft}
              change={(filters) => setDraft({ ...draft, filters })}
            />
            <button type="submit" className="primary">
              Aplicar filtros y diseño
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
