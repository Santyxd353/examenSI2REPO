import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, RotateCcw, Shirt, Trash2 } from 'lucide-react';
import { OutfitPreferencesSchema, type OutfitManifest } from '@lumina/contracts';
import { Viewer } from './Viewer';
import {
  downloadPackage,
  deletePackage,
  listPackages,
  newPackage,
  revalidateAvatars,
  verifiedAsset,
  type LocalPackage,
} from './offline/downloads';
import { sessionResponse } from './offline/session';
import type { OfflineSession } from './offline/scope';
import './downloads.css';

type Props = {
  session: OfflineSession | null;
  online: boolean;
  enable: (signal: AbortSignal) => Promise<OfflineSession>;
  products: { id: string; nombre: string }[];
  categories: { id: string; nombre: string }[];
};
const labels = {
  READY: 'Lista',
  DOWNLOADING: 'En descarga',
  PARTIAL: 'Parcial',
  ERROR: 'Requiere revisión',
  NOT_DOWNLOADED: 'Por descargar',
};
const megabytes = (bytes: number) =>
  new Intl.NumberFormat('es-BO', { maximumFractionDigits: 2 }).format(bytes / 1048576) + ' MiB';
const tokens = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export function Downloads({ session, online, enable, products, categories }: Props) {
  const [packages, setPackages] = useState<LocalPackage[]>([]);
  const [preview, setPreview] = useState<OutfitManifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<{
    body: string | null;
    garment: string;
    label: string;
    color?: string;
  } | null>(null);
  const active = useRef<AbortController | null>(null);
  const renderSequence = useRef(0);
  const refresh = async (owner: OfflineSession) => setPackages(await listPackages(owner));
  useEffect(() => {
    const controller = new AbortController();
    setView(null);
    if (session) {
      void (async () => {
        if (online) await revalidateAvatars(session, controller.signal).catch(() => {});
        if (!controller.signal.aborted) {
          const packages = await listPackages(session);
          if (!controller.signal.aborted) setPackages(packages);
        }
      })().catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    } else setPackages([]);
    return () => {
      controller.abort();
      renderSequence.current++;
    };
  }, [session?.leaseId, online]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(
    () => () => {
      if (view?.body) URL.revokeObjectURL(view.body);
      if (view?.garment) URL.revokeObjectURL(view.garment);
    },
    [view],
  );
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          (error as Error).name === 'QuotaExceededError'
            ? 'No hay espacio suficiente para completar la descarga.'
            : (error as Error).message,
        );
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async (signal) => {
      const owner = session ?? (await enable(signal));
      const preferences = OutfitPreferencesSchema.parse({
        brands: tokens(data.get('brands')),
        sizes: tokens(data.get('sizes')),
        colors: tokens(data.get('colors')),
        categoryIds: data.getAll('categoryIds'),
        favoriteProductIds: data.getAll('favorites'),
      });
      await sessionResponse(owner, '/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ preferences }),
        signal,
      });
      const manifest = await newPackage(owner, data.get('avatar') === 'on', signal);
      if (!signal.aborted) setPreview(manifest);
    });
  }
  function save(manifest: OutfitManifest) {
    if (!session) return;
    void run(async (signal) => {
      await downloadPackage(
        session,
        manifest,
        (item) =>
          setPackages((previous) => [
            item,
            ...previous.filter((saved) => saved.manifest.packageId !== manifest.packageId),
          ]),
        signal,
      );
      setPreview(null);
    });
  }
  async function openGarment(
    manifest: OutfitManifest,
    garment: OutfitManifest['garments'][number],
  ) {
    if (!session) return;
    const sequence = ++renderSequence.current;
    setView(null);
    setError('');
    try {
      const bytes = await verifiedAsset(session, manifest, garment.resourceId);
      const body = manifest.optionalOwnAvatar
        ? await verifiedAsset(session, manifest, manifest.optionalOwnAvatar.avatarId).catch(
            () => null,
          )
        : null;
      if (sequence !== renderSequence.current) return;
      setView({
        body: body && URL.createObjectURL(new Blob([body], { type: 'model/gltf-binary' })),
        garment: URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' })),
        label: garment.productName ?? 'Prenda',
        color: garment.colorHex ?? undefined,
      });
    } catch (error) {
      if (sequence !== renderSequence.current) return;
      setError((error as Error).message);
      setPackages((current) =>
        current.map((item) =>
          item.manifest.packageId === manifest.packageId
            ? {
                ...item,
                status: { ...item.status, state: 'PARTIAL' },
                failure: 'Verifica o vuelve a descargar el archivo.',
              }
            : item,
        ),
      );
    }
  }
  return (
    <section className="offline-downloads">
      <div className="section-title">
        <span className="eyebrow">TU VESTIDOR EN ESTE DISPOSITIVO</span>
        <h1>Descargas</h1>
        <p>Guarda hasta diez prendas compatibles para verlas sin conexión.</p>
      </div>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {online && (
        <form className="offline-card" onSubmit={prepare}>
          <h2>Prepara tu selección</h2>
          <div className="offline-fields">
            <label>
              Tallas preferidas
              <input name="sizes" placeholder="S, M" maxLength={120} />
            </label>
            <label>
              Marcas favoritas
              <input name="brands" placeholder="Nike, Adidas" maxLength={200} />
            </label>
            <label>
              Colores preferidos
              <input name="colors" placeholder="Negro, rosa" maxLength={200} />
            </label>
            {categories.length > 0 && (
              <label>
                Categorías
                <select name="categoryIds" multiple size={Math.min(3, categories.length)}>
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {products.length > 0 && (
              <label>
                Prendas favoritas
                <select name="favorites" multiple size={3}>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="offline-check">
            <input name="avatar" type="checkbox" /> Autorizo guardar mi avatar aprobado, cifrado en
            este dispositivo.
          </label>
          <button className="primary" disabled={busy}>
            Preparar paquete <Download size={17} />
          </button>
        </form>
      )}
      {preview && (
        <article className="offline-card">
          <h2>{preview.garmentCount} prendas disponibles</h2>
          <p>
            {preview.preferencesBasis}.{' '}
            {megabytes(
              preview.garments.reduce(
                (total, item) => total + item.bytes,
                preview.optionalOwnAvatar?.bytes ?? 0,
              ),
            )}
            .
          </p>
          {preview.limitations?.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <button
            className="primary"
            disabled={busy || !online || !preview.garmentCount}
            onClick={() => save(preview)}
          >
            Descargar paquete
          </button>
        </article>
      )}
      {view && (
        <article className="offline-card">
          <h2>{view.label}</h2>
          <Viewer
            bodyUrl={view.body}
            garmentUrl={view.garment}
            color={view.color}
            reference={false}
          />
        </article>
      )}
      {packages.length === 0 && (
        <p className="offline-card">Todavía no hay paquetes guardados en este dispositivo.</p>
      )}
      {packages.map(({ manifest, status, failure }) => (
        <article className="offline-card" key={manifest.packageId}>
          <h2>
            {status.readyItems} de {status.expectedItems} prendas ·{' '}
            {status.state === 'DOWNLOADING' && !busy ? 'Parcial' : labels[status.state]}
          </h2>
          <p>
            {new Date(manifest.createdAt).toLocaleString('es-BO')} ·{' '}
            {megabytes(status.bytesVerified)} verificados
          </p>
          {failure && <p role="status">{failure}</p>}
          {manifest.garments.map((garment) => (
            <button
              className="offline-garment"
              key={garment.resourceId}
              onClick={() => void openGarment(manifest, garment)}
            >
              <Shirt size={16} /> {garment.productName ?? 'Prenda'} · {garment.size} ·{' '}
              {garment.color}
            </button>
          ))}
          <div className="offline-actions">
            {status.state !== 'READY' && (
              <button disabled={!online || busy} onClick={() => save(manifest)}>
                <RotateCcw size={16} /> Reintentar
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!session) return;
                  renderSequence.current++;
                  setView(null);
                  await deletePackage(session, manifest);
                  await refresh(session);
                })
              }
            >
              <Trash2 size={16} /> Eliminar descarga
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
