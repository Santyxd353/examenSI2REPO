import { FormEvent, useEffect, useRef, useState } from 'react';
import { Archive, Pencil, Plus, Save, X } from 'lucide-react';
import { moneyToMinor } from '@lumina/contracts';
import { api } from '../api';
import './catalog-manager.css';

const channels = ['WEB', 'APP', 'TIENDA'] as const;
type Channel = (typeof channels)[number];
type Price = {
  canal: Channel;
  importe: string;
  descuento_pct: string;
  desde: string;
  hasta: string | null;
};
type Variant = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  talla: string;
  color: string;
  color_hex: string | null;
  activa: boolean;
  version: number;
  precio_canal: Price[];
};
type Photo = { id: string; uso: string; estado: string; url: string; texto_alternativo: string };
type Product = {
  id: string;
  nombre: string;
  descripcion: string;
  material: string;
  marca: string | null;
  coleccion: string | null;
  categoria_id: string;
  estado: string;
  version: number;
  variantes: Variant[];
  recurso_catalogo: Photo[];
};
type Promo = { percent: string; start: string; end: string };
type EditableVariant = {
  id: string;
  sku: string;
  barcode: string;
  talla: string;
  color: string;
  colorHex: string;
  active: boolean;
  baseVersion: number | null;
  prices: Record<Channel, string>;
  promos: Record<Channel, Promo>;
};
const localTime = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const emptyPromo = (): Promo => ({ percent: '', start: '', end: '' });
function editVariant(row?: Variant): EditableVariant {
  const now = Date.now();
  return {
    id: row?.id ?? crypto.randomUUID(),
    sku: row?.sku ?? '',
    barcode: row?.codigo_barras ?? '',
    talla: row?.talla ?? '',
    color: row?.color ?? '',
    colorHex: row?.color_hex ?? '#d3a7b1',
    active: row?.activa ?? true,
    baseVersion: row?.version ?? null,
    prices: Object.fromEntries(
      channels.map((channel) => {
        const current = row?.precio_canal.find(
          (p) =>
            p.canal === channel &&
            new Date(p.desde).getTime() <= now &&
            (!p.hasta || new Date(p.hasta).getTime() > now),
        );
        return [channel, current?.importe ?? '0'];
      }),
    ) as Record<Channel, string>,
    promos: Object.fromEntries(
      channels.map((channel) => {
        const promo = row?.precio_canal
          .filter(
            (p) =>
              p.canal === channel &&
              Number(p.descuento_pct) > 0 &&
              p.hasta &&
              new Date(p.hasta).getTime() > now,
          )
          .sort((a, b) => a.desde.localeCompare(b.desde))[0];
        return [
          channel,
          promo
            ? {
                percent: promo.descuento_pct,
                start: localTime(promo.desde),
                end: localTime(promo.hasta!),
              }
            : emptyPromo(),
        ];
      }),
    ) as Record<Channel, Promo>,
  };
}

export function CatalogManager({ onChanged }: { onChanged: () => Promise<void> }) {
  const [products, setProducts] = useState<Product[]>([]),
    [categories, setCategories] = useState<{ id: string; nombre: string }[]>([]);
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [editing, setEditing] = useState<Product | null>(null),
    [variants, setVariants] = useState<EditableVariant[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [photos, setPhotos] = useState<Product | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  async function reload() {
    const data = await api('/catalog/manage');
    setProducts(data.products);
    setCategories(data.categories);
  }
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (editing) title.current?.focus();
  }, [editing?.id]);
  function start(product: Product) {
    setPhotos(null);
    setEditing(product);
    setVariants(product.variantes.map((row) => editVariant(row)));
    setError('');
    setMessage('');
  }
  function variantChange(index: number, patch: Partial<EditableVariant>) {
    setVariants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const patch = {
        nombre: String(data.get('nombre')),
        descripcion: String(data.get('descripcion')),
        material: String(data.get('material')),
        marca: String(data.get('marca')),
        coleccion: String(data.get('coleccion')) || null,
        categoriaId: String(data.get('categoria')),
        estado: String(data.get('estado')),
        variants: variants.map((row) => ({
          id: row.id,
          sku: row.sku,
          barcode: row.barcode || null,
          talla: row.talla,
          color: row.color,
          colorHex: row.colorHex,
          active: row.active,
          baseVersion: row.baseVersion,
          prices: Object.fromEntries(
            channels.map((channel) => [channel, moneyToMinor(row.prices[channel])]),
          ),
          discounts: Object.fromEntries(
            channels
              .filter((channel) => Number(row.promos[channel].percent) > 0)
              .map((channel) => {
                const p = row.promos[channel];
                return [
                  channel,
                  {
                    basisPoints: Math.round(Number(p.percent) * 100),
                    startsAt: new Date(p.start).toISOString(),
                    endsAt: new Date(p.end).toISOString(),
                  },
                ];
              }),
          ),
        })),
      };
      await api(`/catalog/products/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ baseVersion: editing.version, patch }),
      });
      setEditing(null);
      setMessage('Prenda actualizada. Se conservaron las ventas y los precios anteriores.');
      await reload();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function archive(product: Product) {
    const reason = window.prompt(`Motivo para archivar «${product.nombre}» (mínimo 3 caracteres):`);
    if (!reason) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/catalog/products/${product.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({ baseVersion: product.version, reason }),
      });
      if (editing?.id === product.id) setEditing(null);
      await reload();
      await onChanged();
      setMessage('Prenda archivada. Su inventario e historial se conservan.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photos) return;
    const form = event.currentTarget,
      body = new FormData(form);
    body.set('baseVersion', String(photos.version));
    setBusy(true);
    setError('');
    try {
      setPhotos(await api(`/catalog/products/${photos.id}/photos`, { method: 'POST', body }));
      form.reset();
      await reload();
      await onChanged();
      setMessage('Fotos añadidas a la galería.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function photoVisibility(photo: Photo) {
    if (!photos) return;
    setBusy(true);
    setError('');
    try {
      setPhotos(
        await api(`/catalog/products/${photos.id}/photos/${photo.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            baseVersion: photos.version,
            visible: photo.estado !== 'PUBLICADO',
          }),
        }),
      );
      await reload();
      await onChanged();
      setMessage('Visibilidad de la foto actualizada.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visible = products.filter(
    (p) =>
      (!status || p.estado === status) &&
      `${p.nombre} ${p.marca ?? ''} ${p.coleccion ?? ''} ${p.variantes.map((v) => `${v.sku} ${v.codigo_barras ?? ''}`).join(' ')}`
        .toLocaleLowerCase('es')
        .includes(search.toLocaleLowerCase('es')),
  );
  return (
    <section className="catalog-manager" aria-label="Gestión de prendas">
      <div className="catalog-manager-title">
        <div>
          <span className="eyebrow">TU COLECCIÓN</span>
          <h2>Gestionar prendas</h2>
          <p>Edita tallas, colores, precios y promociones. Archivar conserva el historial.</p>
        </div>
        <button onClick={() => void reload().catch((e) => setError(e.message))} disabled={busy}>
          Actualizar lista
        </button>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}{' '}
          {editing && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void api('/catalog/manage')
                  .then((data) => {
                    setProducts(data.products);
                    const latest = data.products.find((p: Product) => p.id === editing.id);
                    if (latest) start(latest);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              Recargar versión guardada
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}
      {photos && (
        <section
          className="admin-card catalog-photo-editor"
          aria-label={`Fotos de ${photos.nombre}`}
        >
          <div className="catalog-manager-title">
            <h3>Fotos de {photos.nombre}</h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhotos(null)}
              aria-label="Cerrar fotos"
            >
              <X size={18} />
            </button>
          </div>
          <p>
            Puedes ocultar una foto y volver a mostrarla. Las referencias anteriores se conservan.
          </p>
          <div className="catalog-photo-grid">
            {photos.recurso_catalogo
              .filter((p) => p.uso === 'GALERIA')
              .map((photo) => (
                <figure key={photo.id}>
                  <img src={photo.url} alt={photo.texto_alternativo} loading="lazy" />
                  <figcaption>
                    {photo.estado === 'PUBLICADO' ? 'Visible' : 'Oculta'}
                    <button disabled={busy} onClick={() => void photoVisibility(photo)}>
                      {photo.estado === 'PUBLICADO' ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </figcaption>
                </figure>
              ))}
          </div>
          <form onSubmit={uploadPhotos}>
            <fieldset disabled={busy}>
              <legend>Añadir fotos</legend>
              <label>
                Fotos (hasta 8, máximo 5 MB cada una)
                <input
                  name="fotos"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  required
                />
              </label>
              <label>
                Licencia o autorización de las imágenes
                <input name="license" minLength={3} maxLength={255} required />
              </label>
              <button className="primary">Subir fotos</button>
            </fieldset>
          </form>
          <button
            disabled={busy}
            onClick={() =>
              void api('/catalog/manage')
                .then((data) => {
                  setProducts(data.products);
                  setPhotos(data.products.find((p: Product) => p.id === photos.id) ?? null);
                })
                .catch((e) => setError(e.message))
            }
          >
            Recargar fotos
          </button>
        </section>
      )}
      {editing && (
        <form
          className="admin-card catalog-editor"
          key={`${editing.id}-${editing.version}`}
          onSubmit={save}
        >
          <div className="catalog-manager-title">
            <h3 ref={title} tabIndex={-1}>
              Editar {editing.nombre}
            </h3>
            <button
              type="button"
              disabled={busy}
              aria-label="Cerrar edición"
              onClick={() => setEditing(null)}
            >
              <X size={18} />
            </button>
          </div>
          {editing.estado === 'RETIRADO' && (
            <p>
              Esta prenda está archivada. Al guardar elige si queda como borrador o vuelve a
              publicarse.
            </p>
          )}
          <fieldset disabled={busy}>
            <legend>Datos de la prenda</legend>
            <div className="two-fields">
              <label>
                Nombre
                <input
                  name="nombre"
                  defaultValue={editing.nombre}
                  required
                  minLength={2}
                  maxLength={160}
                />
              </label>
              <label>
                Categoría
                <select name="categoria" defaultValue={editing.categoria_id} required>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Marca
                <input
                  name="marca"
                  defaultValue={editing.marca ?? ''}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </label>
              <label>
                Colección
                <input name="coleccion" defaultValue={editing.coleccion ?? ''} maxLength={100} />
              </label>
              <label>
                Material
                <input
                  name="material"
                  defaultValue={editing.material}
                  minLength={2}
                  maxLength={150}
                  required
                />
              </label>
              <label>
                Estado
                <select
                  name="estado"
                  defaultValue={editing.estado === 'PUBLICADO' ? 'PUBLICADO' : 'BORRADOR'}
                >
                  <option value="BORRADOR">Borrador</option>
                  <option value="PUBLICADO">Publicado</option>
                </select>
              </label>
            </div>
            <label>
              Descripción
              <textarea
                name="descripcion"
                defaultValue={editing.descripcion}
                required
                maxLength={3000}
              />
            </label>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Variantes y precios</legend>
            {variants.map((row, index) => (
              <div className="catalog-variant-editor" key={row.id}>
                <div className="catalog-manager-title">
                  <h4>Variante {index + 1}</h4>
                  <label className="catalog-checkbox">
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(e) => variantChange(index, { active: e.target.checked })}
                    />{' '}
                    Activa
                  </label>
                </div>
                <div className="catalog-variant-fields">
                  <label>
                    SKU
                    <input
                      value={row.sku}
                      maxLength={60}
                      required
                      onChange={(e) => variantChange(index, { sku: e.target.value })}
                    />
                  </label>
                  <label>
                    Código de barras
                    <input
                      value={row.barcode}
                      maxLength={80}
                      onChange={(e) => variantChange(index, { barcode: e.target.value })}
                    />
                  </label>
                  <label>
                    Talla
                    <input
                      value={row.talla}
                      maxLength={20}
                      required
                      onChange={(e) => variantChange(index, { talla: e.target.value })}
                    />
                  </label>
                  <label>
                    Color
                    <input
                      value={row.color}
                      maxLength={50}
                      required
                      onChange={(e) => variantChange(index, { color: e.target.value })}
                    />
                  </label>
                  <label>
                    Muestra de color
                    <input
                      type="color"
                      value={row.colorHex}
                      onChange={(e) => variantChange(index, { colorHex: e.target.value })}
                    />
                  </label>
                </div>
                <div className="catalog-price-grid">
                  {channels.map((channel) => (
                    <div key={channel}>
                      <label>
                        Precio {channel === 'TIENDA' ? 'mostrador' : channel.toLowerCase()} (Bs)
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="1000000"
                          value={row.prices[channel]}
                          required
                          onChange={(e) =>
                            variantChange(index, {
                              prices: { ...row.prices, [channel]: e.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        Descuento (%)
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={row.promos[channel].percent}
                          onChange={(e) =>
                            variantChange(index, {
                              promos: {
                                ...row.promos,
                                [channel]: { ...row.promos[channel], percent: e.target.value },
                              },
                            })
                          }
                        />
                      </label>
                      {Number(row.promos[channel].percent) > 0 && (
                        <>
                          <label>
                            Desde
                            <input
                              type="datetime-local"
                              value={row.promos[channel].start}
                              required
                              onChange={(e) =>
                                variantChange(index, {
                                  promos: {
                                    ...row.promos,
                                    [channel]: { ...row.promos[channel], start: e.target.value },
                                  },
                                })
                              }
                            />
                          </label>
                          <label>
                            Hasta
                            <input
                              type="datetime-local"
                              value={row.promos[channel].end}
                              required
                              onChange={(e) =>
                                variantChange(index, {
                                  promos: {
                                    ...row.promos,
                                    [channel]: { ...row.promos[channel], end: e.target.value },
                                  },
                                })
                              }
                            />
                          </label>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setVariants((rows) => [...rows, editVariant()])}
              disabled={variants.length >= 100}
            >
              <Plus size={16} /> Añadir variante
            </button>
          </fieldset>
          <div className="catalog-manager-title">
            <small>
              Los precios usan bolivianos. Al finalizar una promoción vuelve el precio base.
            </small>
            <button className="primary" disabled={busy || !variants.length}>
              <Save size={17} /> Guardar prenda
            </button>
          </div>
        </form>
      )}
      <div className="catalog-search two-fields">
        <label>
          Buscar prenda, marca o código
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Vestido, colección, SKU…"
          />
        </label>
        <label>
          Estado del catálogo
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="PUBLICADO">Publicados</option>
            <option value="BORRADOR">Borradores</option>
            <option value="RETIRADO">Archivados</option>
          </select>
        </label>
      </div>
      <div className="catalog-management-list">
        {visible.map((product) => (
          <article className="admin-card" key={product.id}>
            <div>
              <span className="status">
                {product.estado === 'RETIRADO' ? 'ARCHIVADO' : product.estado}
              </span>
              <h3>{product.nombre}</h3>
              <p>
                {product.marca ?? 'Sin marca'}
                {product.coleccion ? ` · ${product.coleccion}` : ''}
              </p>
              <small>
                {product.variantes.length} variantes · versión {product.version}
              </small>
            </div>
            <div className="catalog-card-actions">
              <button disabled={busy} onClick={() => start(product)}>
                <Pencil size={16} /> Editar
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setPhotos(product);
                  setError('');
                  setMessage('');
                }}
              >
                Fotos
              </button>
              {product.estado !== 'RETIRADO' && (
                <button disabled={busy} onClick={() => void archive(product)}>
                  <Archive size={16} /> Archivar
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!visible.length && <p>No hay prendas que coincidan con estos filtros.</p>}
    </section>
  );
}
