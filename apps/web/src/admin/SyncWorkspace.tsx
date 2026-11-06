import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CloudDownload, RefreshCw } from 'lucide-react';
import {
  CatalogVariantSchema,
  ResourceReferenceSchema,
  moneyToMinor,
  type SnapshotDocument,
  type SnapshotEntity,
} from '@lumina/contracts';
import { downloadSnapshot } from '../offline/downloads';
import {
  enqueueIntent,
  listQueue,
  updateQueue,
  type IntentDraft,
  type QueueEntry,
} from '../offline/queue';
import type { OfflineSession } from '../offline/scope';
import { offlineChangesEvent, syncPending } from '../offline/sync';
import { readJson, sha256 } from '../offline/vault';
import '../downloads.css';

type Props = {
  session: OfflineSession | null;
  online: boolean;
  permissions: string[];
  enable: (signal: AbortSignal) => Promise<OfflineSession>;
};
type Row<K extends SnapshotEntity['kind']> = Extract<SnapshotEntity, { kind: K }>;
const openStates = ['PENDING', 'SENDING', 'BLOCKED'];
const pending = (row: QueueEntry) => !row.receipt && openStates.includes(row.status);
const labels = {
  PENDING: 'Pendiente',
  SENDING: 'Enviando',
  APPLIED: 'Confirmado',
  CONFLICT: 'Conflicto',
  BLOCKED: 'Bloqueado',
  DISCARDED: 'Descartado',
};
const kindLabels = {
  STOCK_DELTA: 'Ajuste de stock',
  STOCK_COUNT: 'Conteo',
  CATALOG_CREATE: 'Alta de prenda',
  CATALOG_UPDATE: 'Edición de prenda',
  CATALOG_ARCHIVE: 'Archivo de prenda',
};
const input = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export function SyncWorkspace({ session, online, permissions, enable }: Props) {
  const [snapshot, setSnapshot] = useState<SnapshotDocument | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [section, setSection] = useState<'queue' | 'stock' | 'catalog'>('queue');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [reconcile, setReconcile] = useState<QueueEntry | null>(null);
  const working = useRef<AbortController | null>(null);
  const inventory = permissions.includes('inventario:gestionar');
  const catalog = permissions.includes('catalogo:gestionar');
  async function readCopy(owner: OfflineSession) {
    const [copy, operations] = await Promise.all([
      readJson<SnapshotDocument>(owner, 'snapshot'),
      listQueue(owner),
    ]);
    return { snapshot: copy?.data ?? null, queue: operations };
  }
  async function reload(owner: OfflineSession) {
    const data = await readCopy(owner);
    setSnapshot(data.snapshot);
    setQueue(data.queue);
  }
  useEffect(() => {
    let active = true;
    function refresh() {
      if (!session) {
        setSnapshot(null);
        setQueue([]);
        return;
      }
      void readCopy(session)
        .then((data) => {
          if (active) {
            setSnapshot(data.snapshot);
            setQueue(data.queue);
            if (!data.queue.some(pending))
              setNotice((current) =>
                current.startsWith('Cambio guardado')
                  ? 'Envío completado. Revisa el registro de sincronización.'
                  : current,
              );
          }
        })
        .catch((reason) => {
          if (active) setError(reason.message);
        });
    }
    refresh();
    window.addEventListener(offlineChangesEvent, refresh);
    return () => {
      active = false;
      window.removeEventListener(offlineChangesEvent, refresh);
    };
  }, [session?.leaseId]);
  useEffect(() => () => working.current?.abort(), []);
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (working.current) return;
    const controller = new AbortController();
    working.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work(controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) setError((reason as Error).message);
    } finally {
      working.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const save = (
    draft: IntentDraft,
    assets?: { key: string; bytes: ArrayBuffer }[],
    previous?: string,
  ) =>
    run(async () => {
      if (!session) throw new Error('Prepara una copia de la tienda con conexión.');
      await enqueueIntent(session, draft, { assets, reconciles: previous });
      await reload(session);
      setNotice('Cambio guardado en este dispositivo, pendiente de confirmación.');
      setReconcile(null);
    });
  return (
    <section className="offline-downloads">
      <div className="business-page-heading">
        <div>
          <span className="eyebrow">CAMBIOS EN ESTE DISPOSITIVO</span>
          <h1>Sincronización</h1>
          <p>Prepara una copia de la tienda y consulta los cambios pendientes.</p>
        </div>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message" role="status">
          {notice}
        </p>
      )}
      <article className="offline-card">
        <h2>Copia de la tienda</h2>
        <p>
          {snapshot
            ? `Corte del ${new Date(snapshot.asOf).toLocaleString('es-BO')} · ${snapshot.coverage.rowCount} registros`
            : 'Descarga el catálogo y los saldos autorizados con conexión.'}
        </p>
        {snapshot?.coverage.omissions.map((note) => (
          <p key={note}>{note}</p>
        ))}
        <div className="offline-actions">
          <button
            disabled={!online || busy}
            onClick={() =>
              void run(async (signal) => {
                const owner = await enable(signal);
                setSnapshot(await downloadSnapshot(owner, signal));
                await reload(owner);
                setNotice('Copia verificada y guardada en este dispositivo.');
              })
            }
          >
            <CloudDownload size={17} /> Descargar copia
          </button>
          <button
            disabled={!online || busy || !session || !queue.some(pending)}
            onClick={() =>
              void run(async (signal) => {
                if (!session) return;
                const result = await syncPending(session, signal);
                if (result.running) {
                  setNotice('Otra pestaña está sincronizando.');
                  return;
                }
                if (result.applied || result.conflicts) await downloadSnapshot(session, signal);
                await reload(session);
                setNotice(
                  `${result.applied} confirmados, ${result.conflicts} conflictos y ${result.blocked} bloqueados.`,
                );
              })
            }
          >
            <RefreshCw size={17} /> Enviar pendientes
          </button>
        </div>
      </article>
      <nav className="offline-actions" aria-label="Funciones offline">
        <button aria-pressed={section === 'queue'} onClick={() => setSection('queue')}>
          Cambios ({queue.filter(pending).length})
        </button>
        {inventory && (
          <button aria-pressed={section === 'stock'} onClick={() => setSection('stock')}>
            Inventario offline
          </button>
        )}
        {catalog && (
          <button aria-pressed={section === 'catalog'} onClick={() => setSection('catalog')}>
            Catálogo offline
          </button>
        )}
      </nav>
      {section === 'queue' && (
        <div className="offline-card">
          <h2>Registro de sincronización</h2>
          {!queue.length && <p>Aún no hay cambios guardados.</p>}
          {queue.map((row) => (
            <article className="offline-intent" key={row.intent.operationId}>
              <strong>
                {kindLabels[row.intent.kind]} · {labels[row.status]}
              </strong>
              <small>
                {new Date(row.intent.createdAt).toLocaleString('es-BO')} · {row.intent.operationId}
              </small>
              {row.intent.kind === 'CATALOG_CREATE' && (
                <span>{row.intent.payload.product.nombre}</span>
              )}
              {row.reconciles && <small>Conciliación de {row.reconciles}</small>}
              {row.problem && <p>{row.problem.message}</p>}
              {typeof row.receipt?.result.message === 'string' && (
                <p>{row.receipt.result.message}</p>
              )}
              {row.status === 'CONFLICT' &&
                inventory &&
                snapshot &&
                ['STOCK_COUNT', 'STOCK_DELTA'].includes(row.intent.kind) && (
                  <button
                    onClick={() => {
                      setReconcile(row);
                      setSection('stock');
                    }}
                  >
                    Conciliar con el saldo del corte
                  </button>
                )}
              {pending(row) && row.status !== 'SENDING' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!session) return;
                      await updateQueue(session, row.intent.operationId, (current) =>
                        pending(current) && current.status !== 'SENDING'
                          ? { ...current, status: 'DISCARDED' }
                          : null,
                      );
                      await reload(session);
                    })
                  }
                >
                  Descartar pendiente
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {section !== 'queue' && (!snapshot || !session) && (
        <p className="offline-card">
          Prepara la copia de esta tienda antes de registrar cambios offline.
        </p>
      )}
      {section === 'stock' && inventory && snapshot && session && (
        <StockDraft
          key={reconcile?.intent.operationId ?? 'new'}
          snapshot={snapshot}
          queue={queue}
          busy={busy}
          previous={reconcile}
          save={save}
        />
      )}
      {section === 'catalog' && catalog && snapshot && session && (
        <CatalogDraft snapshot={snapshot} queue={queue} busy={busy} save={save} report={setError} />
      )}
    </section>
  );
}

type SaveDraft = (
  draft: IntentDraft,
  assets?: { key: string; bytes: ArrayBuffer }[],
  previous?: string,
) => Promise<void>;
function StockDraft({
  snapshot,
  queue,
  busy,
  previous,
  save,
}: {
  snapshot: SnapshotDocument;
  queue: QueueEntry[];
  busy: boolean;
  previous: QueueEntry | null;
  save: SaveDraft;
}) {
  const products = new Map(
    snapshot.entities
      .filter((row): row is Row<'PRODUCT'> => row.kind === 'PRODUCT')
      .map((row) => [row.id, row.name]),
  );
  const variants = snapshot.entities.filter(
    (row): row is Row<'VARIANT'> => row.kind === 'VARIANT' && row.active,
  );
  const locations = snapshot.entities.filter(
    (row): row is Row<'LOCATION'> => row.kind === 'LOCATION' && row.active,
  );
  const prior =
    previous?.intent.kind === 'STOCK_COUNT' || previous?.intent.kind === 'STOCK_DELTA'
      ? previous.intent
      : null;
  const [variantId, setVariantId] = useState(prior?.payload.variantId ?? variants[0]?.id ?? '');
  const [locationId, setLocationId] = useState(prior?.payload.locationId ?? locations[0]?.id ?? '');
  const [mode, setMode] = useState<'STOCK_DELTA' | 'STOCK_COUNT'>(prior?.kind ?? 'STOCK_DELTA');
  const current = snapshot.entities.find(
    (row): row is Row<'STOCK'> =>
      row.kind === 'STOCK' && row.variantId === variantId && row.locationId === locationId,
  );
  const related = queue
    .filter(pending)
    .map((row) => row.intent)
    .filter(
      (intent) =>
        (intent.kind === 'STOCK_COUNT' || intent.kind === 'STOCK_DELTA') &&
        intent.payload.variantId === variantId &&
        intent.payload.locationId === locationId,
    );
  const provisional = related.reduce(
    (physical, intent) =>
      intent.kind === 'STOCK_COUNT'
        ? intent.payload.observedPhysical
        : intent.kind === 'STOCK_DELTA'
          ? physical + intent.payload.deltaFisico
          : physical,
    current?.physical ?? 0,
  );
  const known = current || snapshot.coverage.complete;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      quantity = Number(input(data, 'quantity')),
      reason = input(data, 'reason');
    if (!known || !variantId || !locationId) return;
    const entityId = current?.id ?? related[0]?.entityId ?? crypto.randomUUID();
    const common = { entityId, dependsOn: [], baseVersion: current?.version ?? null };
    if (mode === 'STOCK_COUNT') {
      if (!current) return;
      void save(
        {
          ...common,
          kind: mode,
          payload: { variantId, locationId, observedPhysical: quantity, reason },
        },
        undefined,
        prior?.operationId,
      );
    } else
      void save(
        {
          ...common,
          kind: mode,
          payload: { variantId, locationId, deltaFisico: quantity, reason },
        },
        undefined,
        prior?.operationId,
      );
  }
  return (
    <form className="offline-card" onSubmit={submit}>
      <h2>{prior ? 'Conciliar inventario' : 'Registrar inventario'}</h2>
      <div className="offline-fields">
        <label>
          Variante
          <select
            aria-label="Variante"
            value={variantId}
            onChange={(event) => setVariantId(event.target.value)}
            required
          >
            <option value="">Selecciona una variante</option>
            {variants.map((item) => (
              <option key={item.id} value={item.id}>
                {products.get(item.productId)} · {item.size} · {item.color} · {item.sku}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ubicación
          <select
            aria-label="Ubicación"
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            required
          >
            <option value="">Selecciona una ubicación</option>
            {locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Operación
          <select
            aria-label="Operación"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="STOCK_DELTA">Aumentar o disminuir</option>
            <option value="STOCK_COUNT">Registrar conteo físico</option>
          </select>
        </label>
        <label>
          {mode === 'STOCK_DELTA' ? 'Cambio de unidades' : 'Unidades contadas'}
          <input
            name="quantity"
            type="number"
            step="1"
            min={mode === 'STOCK_COUNT' ? 0 : -1000000}
            max="1000000"
            required
            defaultValue={
              prior?.kind === 'STOCK_COUNT'
                ? prior.payload.observedPhysical
                : prior?.payload.deltaFisico
            }
          />
        </label>
        <label>
          Motivo
          <input
            name="reason"
            minLength={3}
            maxLength={400}
            required
            defaultValue={prior?.payload.reason}
          />
        </label>
      </div>
      <p>
        {known
          ? `Físico en el corte: ${current?.physical ?? 0}. Proyección pendiente: ${provisional}.`
          : 'El corte parcial no contiene este saldo. Actualiza la copia antes de editarlo.'}
      </p>
      {current && (
        <p>
          Versión {current.version} · {current.reserved} reservadas · {current.committed}{' '}
          comprometidas
        </p>
      )}
      {mode === 'STOCK_COUNT' && !current && <p>Un conteo necesita un saldo confirmado.</p>}
      <button
        className="primary"
        disabled={
          busy || !known || !variantId || !locationId || (mode === 'STOCK_COUNT' && !current)
        }
      >
        Guardar inventario pendiente
      </button>
    </form>
  );
}

function CatalogDraft({
  snapshot,
  queue,
  busy,
  save,
  report,
}: {
  snapshot: SnapshotDocument;
  queue: QueueEntry[];
  busy: boolean;
  save: SaveDraft;
  report: (message: string) => void;
}) {
  const [id, setId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [archive, setArchive] = useState(false);
  const categories = snapshot.entities.filter(
    (row): row is Row<'CATEGORY'> => row.kind === 'CATEGORY' && row.active,
  );
  const products = snapshot.entities.filter(
    (row): row is Row<'PRODUCT'> => row.kind === 'PRODUCT' && row.state !== 'RETIRADO',
  );
  const creates = queue.filter((row) => pending(row) && row.intent.kind === 'CATALOG_CREATE');
  const created = creates.find((row) => row.intent.entityId === id)?.intent;
  const draft = created?.kind === 'CATALOG_CREATE' ? created.payload.product : null;
  const item = products.find((row) => row.id === id);
  useEffect(() => {
    if (id && !item && !draft) {
      setId('');
      setVariantId('');
      setArchive(false);
    }
  }, [id, item, draft]);
  const variants = snapshot.entities.filter(
    (row): row is Row<'VARIANT'> => row.kind === 'VARIANT' && row.productId === id,
  );
  const existing = variants.find((row) => row.id === variantId);
  const draftVariant = draft?.variants.find((row) => row.id === variantId);
  const selected = existing ?? draftVariant;
  const busyEntity = queue.some(
    (row) => pending(row) && row.intent.entityId === id && row.intent.kind !== 'CATALOG_CREATE',
  );
  function price(channel: 'WEB' | 'APP' | 'TIENDA') {
    if (draftVariant) return (draftVariant.prices[channel] / 100).toFixed(2);
    const value = existing?.prices.find(
      (rule) =>
        rule.channel === channel &&
        rule.startsAt <= snapshot.asOf &&
        (!rule.endsAt || rule.endsAt > snapshot.asOf),
    );
    return value ? (value.baseMinor / 100).toFixed(2) : undefined;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget),
      entityId = id || crypto.randomUUID();
    const common = {
      entityId,
      baseVersion: item?.version ?? null,
      dependsOn: created ? [created.operationId] : [],
    };
    try {
      if (archive) {
        await save({
          ...common,
          kind: 'CATALOG_ARCHIVE',
          payload: { reason: input(data, 'reason') },
        });
        return;
      }
      const variant = CatalogVariantSchema.parse({
        id: selected?.id ?? crypto.randomUUID(),
        sku: input(data, 'sku'),
        talla: input(data, 'size'),
        color: input(data, 'color'),
        prices: {
          WEB: moneyToMinor(input(data, 'WEB')),
          APP: moneyToMinor(input(data, 'APP')),
          TIENDA: moneyToMinor(input(data, 'TIENDA')),
        },
        active: data.get('active') === 'on',
        baseVersion: existing?.version ?? (draftVariant ? 1 : null),
      });
      const file = data.get('file');
      const assets = [],
        resources = [];
      if (file instanceof File && file.size) {
        if (file.size > 50 * 1024 * 1024) throw new Error('El archivo supera los 50 MiB.');
        const bytes = await file.arrayBuffer(),
          usage = input(data, 'usage');
        const reference = ResourceReferenceSchema.parse({
          clientResourceId: crypto.randomUUID(),
          variantId: variant.id,
          sha256: await sha256(bytes),
          bytes: bytes.byteLength,
          mime: file.type || (file.name.toLowerCase().endsWith('.glb') ? 'model/gltf-binary' : ''),
          license: input(data, 'license'),
          usage,
          ...(usage === 'ANDROID_AR'
            ? { placement: { algorithm: 'torso-v1', kind: input(data, 'placement') } }
            : {}),
        });
        resources.push(reference);
        assets.push({ key: 'resource:' + reference.clientResourceId, bytes });
      }
      const fields = {
        nombre: input(data, 'name'),
        descripcion: input(data, 'description'),
        material: input(data, 'material'),
        marca: input(data, 'brand'),
        categoriaId: input(data, 'category'),
        variants: [variant],
        resources,
      };
      await save(
        id
          ? { ...common, kind: 'CATALOG_UPDATE', payload: { patch: fields } }
          : {
              ...common,
              kind: 'CATALOG_CREATE',
              payload: { product: { id: entityId, ...fields } },
            },
        assets,
      );
    } catch (error) {
      report((error as Error).message);
    }
  }
  return (
    <article className="offline-card">
      <h2>Catálogo offline</h2>
      <div className="offline-fields">
        <label>
          Prenda
          <select
            aria-label="Prenda"
            value={id}
            onChange={(event) => {
              const selected = event.target.value;
              setId(selected);
              setArchive(false);
              const saved = creates.find((row) => row.intent.entityId === selected)?.intent;
              setVariantId(
                variants.find((row) => row.productId === selected)?.id ??
                  snapshot.entities.find(
                    (row): row is Row<'VARIANT'> =>
                      row.kind === 'VARIANT' && row.productId === selected,
                  )?.id ??
                  (saved?.kind === 'CATALOG_CREATE' ? saved.payload.product.variants[0]?.id : '') ??
                  '',
              );
            }}
          >
            <option value="">Crear prenda</option>
            {products.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
            {creates.map(
              (row) =>
                row.intent.kind === 'CATALOG_CREATE' && (
                  <option key={row.intent.entityId} value={row.intent.entityId}>
                    {row.intent.payload.product.nombre} · Pendiente
                  </option>
                ),
            )}
          </select>
        </label>
        {id && (
          <label className="offline-check">
            <input
              type="checkbox"
              checked={archive}
              onChange={(event) => setArchive(event.target.checked)}
            />{' '}
            Archivar prenda
          </label>
        )}
        {id && !archive && (
          <label>
            Variante
            <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
              <option value="">Añadir variante</option>
              {variants.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.size} · {row.color} · {row.sku}
                </option>
              ))}
              {draft?.variants.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.talla} · {row.color} · {row.sku}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {busyEntity && (
        <p>
          La prenda tiene una edición pendiente. Confírmala o descártala antes de editarla de nuevo.
        </p>
      )}
      <form
        key={id + ':' + variantId + ':' + archive}
        className="offline-form"
        onSubmit={(event) => void submit(event)}
      >
        {archive ? (
          <label>
            Motivo de archivo
            <input name="reason" minLength={3} maxLength={400} required />
          </label>
        ) : (
          <>
            <div className="offline-fields">
              <label>
                Nombre
                <input
                  name="name"
                  required
                  minLength={2}
                  maxLength={160}
                  defaultValue={item?.name ?? draft?.nombre}
                />
              </label>
              <label>
                Descripción
                <input
                  name="description"
                  required
                  maxLength={3000}
                  defaultValue={item?.description ?? draft?.descripcion}
                />
              </label>
              <label>
                Material
                <input
                  name="material"
                  required
                  minLength={2}
                  maxLength={150}
                  defaultValue={item?.material ?? draft?.material}
                />
              </label>
              <label>
                Marca
                <input
                  name="brand"
                  required
                  minLength={2}
                  maxLength={100}
                  defaultValue={item?.brand ?? draft?.marca}
                />
              </label>
              <label>
                Categoría
                <select
                  aria-label="Categoría"
                  name="category"
                  required
                  defaultValue={item?.categoryId ?? draft?.categoriaId ?? ''}
                >
                  <option value="">Selecciona una categoría</option>
                  {categories.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                SKU
                <input name="sku" required maxLength={60} defaultValue={selected?.sku} />
              </label>
              <label>
                Talla
                <input
                  name="size"
                  required
                  maxLength={20}
                  defaultValue={existing?.size ?? draftVariant?.talla}
                />
              </label>
              <label>
                Color
                <input name="color" required maxLength={50} defaultValue={selected?.color} />
              </label>
              {(['WEB', 'APP', 'TIENDA'] as const).map((channel) => (
                <label key={channel}>
                  Precio {channel} (Bs)
                  <input
                    name={channel}
                    type="number"
                    step=".01"
                    min=".01"
                    required
                    defaultValue={price(channel)}
                  />
                </label>
              ))}
            </div>
            <label className="offline-check">
              <input name="active" type="checkbox" defaultChecked={selected?.active ?? true} />{' '}
              Variante activa
            </label>
            <details>
              <summary>Adjuntar recurso local</summary>
              <div className="offline-fields">
                <label>
                  Archivo
                  <input name="file" type="file" accept="image/png,image/jpeg,image/webp,.glb" />
                </label>
                <label>
                  Uso
                  <select name="usage">
                    <option value="GALLERY">Galería</option>
                    <option value="ANDROID_AR">AR Android</option>
                    <option value="WEB_3D">Modelo web GLB</option>
                  </select>
                </label>
                <label>
                  Colocación AR
                  <select name="placement">
                    <option value="dress">Vestido</option>
                    <option value="skirt">Falda</option>
                    <option value="top">Parte superior</option>
                  </select>
                </label>
                <label>
                  Licencia o autorización
                  <input name="license" maxLength={255} />
                </label>
              </div>
            </details>
          </>
        )}
        <button className="primary" disabled={busy || busyEntity}>
          Guardar catálogo pendiente
        </button>
      </form>
    </article>
  );
}
