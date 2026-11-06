import { useEffect, useRef, useState } from 'react';
import {
  canonicalJson,
  ReportDefinitionSchema,
  UuidSchema,
  type ReportDataset,
  type ReportDefinition,
} from '@lumina/contracts';
import { validateReport } from '@lumina/reporting';
import { offlineResponse } from '../api';
import type { ReportIdentity } from './report-data';

type SavedDefinition = {
  id: string;
  version: number;
  tenantId: string;
  ownerId: string;
  definition: ReportDefinition;
};

function checked(identity: ReportIdentity, row: SavedDefinition): SavedDefinition {
  if (
    row.tenantId !== identity.tenantId ||
    row.ownerId !== identity.actorId ||
    !Number.isSafeInteger(row.version) ||
    row.version < 1
  )
    throw new Error('La definición recibida no pertenece a esta sesión.');
  return {
    ...row,
    id: UuidSchema.parse(row.id),
    definition: ReportDefinitionSchema.parse(row.definition),
  };
}

const endpoint = '/api/reports/definitions';
export function SavedReports({
  identity,
  data,
  draft,
  readOnly,
  load,
}: {
  identity: ReportIdentity;
  data: ReportDataset;
  draft: ReportDefinition;
  readOnly: boolean;
  load: (definition: ReportDefinition) => void;
}) {
  const { slug, actorId, tenantId } = identity;
  const [items, setItems] = useState<SavedDefinition[]>([]);
  const [selected, setSelected] = useState('');
  const [opened, setOpened] = useState<SavedDefinition | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const lastCreate = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    void offlineResponse({ slug, actorId }, endpoint, { signal: abort.signal })
      .then((response) => response.json())
      .then((body) => {
        if (!abort.signal.aborted)
          setItems(
            body.definitions.map((row: SavedDefinition) =>
              checked({ slug, actorId, tenantId }, row),
            ),
          );
      })
      .catch((reason) => {
        if (!abort.signal.aborted) setError(reason.message);
      });
    return () => {
      abort.abort();
      controller.current = null;
    };
  }, [slug, actorId, tenantId]);

  const current = items.find((row) => row.id === selected);
  const editable = opened?.id === draft.id ? opened : null;
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    const signal = controller.current?.signal;
    if (!signal || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action(signal);
    } catch (reason) {
      if (!signal.aborted)
        setError(reason instanceof Error ? reason.message : 'No se pudo completar la operación.');
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  function open() {
    if (!current) return;
    void run(async (signal) => {
      const response = await offlineResponse(identity, endpoint + '/' + current.id, { signal });
      const row = checked(identity, await response.json());
      signal.throwIfAborted();
      const definition = { ...row.definition, datasetId: data.datasetId };
      const validation = validateReport(definition, data);
      if (!validation.ok) throw new Error(validation.problems[0].message);
      setOpened(row);
      load(definition);
      setMessage('Diseño abierto sobre el corte actual.');
    });
  }

  function save(copy: boolean) {
    if (readOnly) return;
    void run(async (signal) => {
      const validation = validateReport(draft, data);
      if (!validation.ok) throw new Error(validation.problems[0].message);
      const update = copy ? null : editable;
      const { id: _, ...definition } = draft;
      const payload = canonicalJson(definition);
      if (!update && lastCreate.current?.payload !== payload)
        lastCreate.current = { payload, id: crypto.randomUUID() };
      const response = await offlineResponse(
        identity,
        update ? endpoint + '/' + update.id : endpoint,
        {
          method: update ? 'PATCH' : 'POST',
          body: JSON.stringify(
            update
              ? { definition, expectedVersion: update.version }
              : { definition, operationId: lastCreate.current?.id },
          ),
          signal,
        },
      );
      const row = checked(identity, await response.json());
      signal.throwIfAborted();
      if (!update) lastCreate.current = null;
      setOpened(row);
      setSelected(row.id);
      setItems((old) => [row, ...old.filter((item) => item.id !== row.id)]);
      load(row.definition);
      setMessage('Diseño guardado.');
    });
  }

  function archive() {
    if (readOnly || !current) return;
    void run(async (signal) => {
      await offlineResponse(
        identity,
        endpoint + '/' + current.id + '?expectedVersion=' + current.version,
        { method: 'DELETE', signal },
      );
      signal.throwIfAborted();
      setItems((old) => old.filter((item) => item.id !== current.id));
      setSelected('');
      if (opened?.id === current.id) setOpened(null);
      setMessage('Diseño archivado.');
    });
  }

  return (
    <section className="report-panel report-control" aria-label="Diseños guardados">
      <h2>Diseños guardados</h2>
      <div className="report-fields">
        <label>
          Diseño
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Seleccionar un diseño</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.definition.title} · v{item.version}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary" disabled={busy || !current} onClick={open}>
          Abrir diseño
        </button>
        <button className="secondary" disabled={busy || readOnly} onClick={() => save(false)}>
          {editable ? 'Actualizar diseño' : 'Guardar diseño'}
        </button>
        {editable && (
          <button className="secondary" disabled={busy || readOnly} onClick={() => save(true)}>
            Guardar como nuevo
          </button>
        )}
        <button className="secondary" disabled={busy || readOnly || !current} onClick={archive}>
          Archivar diseño
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="report-warning">
          {error}
        </p>
      )}
    </section>
  );
}
