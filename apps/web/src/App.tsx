import { useEffect, useState, useRef, FormEvent } from 'react';
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  Camera,
  User,
  LogOut,
  ScanLine,
  ShieldCheck,
  Layers3,
  X,
  LoaderCircle,
  Search,
  Shirt,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { api, privateModel, refresh, setToken, logoutSession } from './api';
import { Viewer } from './Viewer';
import { AdminWorkspace } from './admin/AdminWorkspace';
import { businessModules } from './admin/modules';
import { Commerce } from './Commerce';
import { tenantAsset, tenantSlug, selectTenant } from './tenant';
type CatalogLocation = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
  direccion?: string;
};
type LocationAvailability = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
  direccion?: string;
  disponible: number;
};
type Variant = {
  id: string;
  talla: string;
  color: string;
  color_hex: string;
  precio: number;
  disponible: number;
  ubicaciones: LocationAvailability[];
  modeloId?: string;
  plantillaId?: string;
};
type Product = {
  id: string;
  nombre: string;
  descripcion: string;
  material: string;
  marca?: string | null;
  imagenes?: { url: string; textoAlternativo: string }[];
  variantes: Variant[];
};
type CatalogFilters = { brands: string[]; colors: string[]; sizes: string[] };
type CatalogCategory = { id: string; nombre: string };
type Avatar = {
  id: string;
  estado: string;
  version: number;
  plantilla_id: string;
  medidas?: Record<string, { valor_cm: number }>;
};
type Job = { id: string; estado: string; error_codigo?: string };
const money = (n: number) =>
  new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'BOB',
    maximumFractionDigits: 0,
  }).format(n);
function GarmentArt({ color = '#d5c6b0' }: { color?: string }) {
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true">
      <defs>
        <filter id="shadow">
          <feDropShadow dx="1" dy="10" stdDeviation="9" floodOpacity=".1" />
        </filter>
      </defs>
      <ellipse cx="150" cy="258" rx="78" ry="8" fill="#000" opacity=".04" />
      <path
        d="M110 55 L78 66 34 112 67 150 90 130 88 242 Q150 253 212 242 L210 130 233 150 266 112 222 66 190 55 Q150 77 110 55Z"
        fill={color}
        filter="url(#shadow)"
        stroke="#000"
        strokeOpacity=".12"
      />
      <path d="M110 55 Q118 91 150 91 Q182 91 190 55 Q150 74 110 55" fill="#000" opacity=".09" />
      <path
        d="M94 116L107 230M206 116L194 230M112 238Q150 244 189 238"
        fill="none"
        stroke="#000"
        strokeOpacity=".1"
      />
      <path d="M78 69L102 109M222 69L198 109" fill="none" stroke="#fff" strokeOpacity=".4" />
    </svg>
  );
}
export function App() {
  const accountEpoch = useRef(0),
    viewEpoch = useRef(0);
  const [page, setPage] = useState<'catalogo' | 'avatar' | 'admin' | 'commerce'>('catalogo'),
    [user, setUser] = useState<any>(null),
    [authOpen, setAuthOpen] = useState(false),
    [register, setRegister] = useState(false);
  const [products, setProducts] = useState<Product[]>([]),
    [visibleProducts, setVisibleProducts] = useState<Product[]>([]),
    [selected, setSelected] = useState<Variant | null>(null),
    [catalogLocations, setCatalogLocations] = useState<CatalogLocation[]>([]),
    [categories, setCategories] = useState<CatalogCategory[]>([]),
    [filterOptions, setFilterOptions] = useState<CatalogFilters>({
      brands: [],
      colors: [],
      sizes: [],
    }),
    [catalogLocation, setCatalogLocation] = useState(''),
    [query, setQuery] = useState(''),
    [brand, setBrand] = useState(''),
    [category, setCategory] = useState(''),
    [color, setColor] = useState(''),
    [size, setSize] = useState(''),
    [catalogVersion, setCatalogVersion] = useState(0),
    [catalogLoading, setCatalogLoading] = useState(true),
    [galleryIndex, setGalleryIndex] = useState<Record<string, number>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [stores, setStores] = useState<{ slug: string; name: string }[]>([]);
  const [avatars, setAvatars] = useState<Avatar[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [bodyUrl, setBodyUrl] = useState(tenantAsset('/assets/reference.glb')),
    [garmentUrl, setGarmentUrl] = useState<string | null>(tenantAsset('/assets/dress-M.glb'));
  const [current, setCurrent] = useState<Avatar | null>(null),
    [session, setSession] = useState<string | null>(null),
    [notice, setNotice] = useState('');
  async function loadCatalog() {
    const data = await api('/catalog');
    const normalized: Product[] = data.products;
    setProducts(normalized);
    setCatalogLocations(data.locations || []);
    setCategories(data.categories || []);
    setFilterOptions(data.filters || { brands: [], colors: [], sizes: [] });
    setSelected(normalized[0]?.variantes[1] || normalized[0]?.variantes[0] || null);
    setCatalogVersion((current) => current + 1);
  }
  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setVisibleProducts([]);
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams();
        if (catalogLocation) params.set('location', catalogLocation);
        if (query.trim()) params.set('search', query.trim());
        if (brand) params.set('brand', brand);
        if (category) params.set('category', category);
        if (color) params.set('color', color);
        if (size) params.set('size', size);
        void api(`/catalog${params.size ? `?${params}` : ''}`)
          .then((data) => {
            if (active) setVisibleProducts(data.products);
          })
          .catch((reason) => {
            if (active) setError(reason.message);
          })
          .finally(() => {
            if (active) setCatalogLoading(false);
          });
      },
      query ? 200 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [catalogLocation, query, brand, category, color, size, catalogVersion]);
  useEffect(() => {
    const epoch = accountEpoch.current;
    void api('/platform/stores')
      .then(setStores)
      .catch(() => {});
    refresh()
      .then((d) => {
        if (epoch === accountEpoch.current) setUser(d.user);
      })
      .catch(() => {});
    void loadCatalog().catch((e) => setError(e.message));
  }, []);
  const reload = async () => {
    const epoch = accountEpoch.current;
    const data = await api('/avatars');
    if (epoch !== accountEpoch.current) return;
    setAvatars(data.avatars);
    setJobs(data.jobs);
  };
  useEffect(() => {
    if (!user) return;
    void reload().catch(() => {});
    const t = setInterval(() => void reload().catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [user]);
  useEffect(
    () => () => {
      if (bodyUrl.startsWith('blob:')) URL.revokeObjectURL(bodyUrl);
    },
    [bodyUrl],
  );
  useEffect(
    () => () => {
      if (garmentUrl?.startsWith('blob:')) URL.revokeObjectURL(garmentUrl);
    },
    [garmentUrl],
  );
  useEffect(() => {
    if (!authOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAuthOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.auth-modal button:not(:disabled), .auth-modal input:not(:disabled)',
        ),
      );
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handle);
    return () => {
      document.removeEventListener('keydown', handle);
      previous?.focus();
    };
  }, [authOpen]);
  const openAvatar = () => {
    setPage('avatar');
    if (!user) setAuthOpen(true);
    setNotice('');
  };
  async function addToCart(variant: Variant) {
    if (!user) {
      setAuthOpen(true);
      setNotice('Inicia sesión para guardar prendas en tu carrito.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const cart = await api('/commerce/cart');
      const current = cart.item_carrito.find(
        (item: { variante_id: string }) => item.variante_id === variant.id,
      );
      await api('/commerce/cart/items', {
        method: 'POST',
        body: JSON.stringify({ variantId: variant.id, quantity: (current?.cantidad ?? 0) + 1 }),
      });
      setNotice('Prenda agregada al carrito.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    try {
      const data = await api('/auth/' + (register ? 'register' : 'login'), {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(f)),
      });
      accountEpoch.current++;
      viewEpoch.current++;
      setToken(data.accessToken);
      setUser(data.user);
      setAuthOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    const epoch = ++accountEpoch.current;
    viewEpoch.current++;
    setBusy(true);
    try {
      await logoutSession();
      if (epoch !== accountEpoch.current) return;
      accountEpoch.current++;
      setUser(null);
      setAvatars([]);
      setJobs([]);
      setSession(null);
      setNotice('');
      setError('');
      setCurrent(null);
      setBodyUrl(tenantAsset('/assets/reference.glb'));
      setGarmentUrl(tenantAsset('/assets/dress-M.glb'));
      setPage('catalogo');
    } catch (e) {
      if (epoch === accountEpoch.current) setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadPhotos(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const epoch = accountEpoch.current;
    const form = e.currentTarget;
    setBusy(true);
    setError('');
    try {
      const f = new FormData(form);
      f.set('idempotencia', crypto.randomUUID());
      await api('/avatars', { method: 'POST', body: f });
      if (epoch !== accountEpoch.current) return;
      setNotice('Fotos recibidas. Puedes consultar el progreso aquí.');
      form.reset();
      await reload();
    } catch (e) {
      if (epoch === accountEpoch.current) setError((e as Error).message);
    } finally {
      if (epoch === accountEpoch.current) setBusy(false);
    }
  }
  async function showAvatar(a: Avatar) {
    const epoch = ++viewEpoch.current;
    setBusy(true);
    setError('');
    let url: string | undefined,
      applied = false;
    try {
      url = await privateModel('/avatars/' + a.id + '/model');
      if (epoch !== viewEpoch.current) return;
      setBodyUrl(url);
      setGarmentUrl(null);
      setCurrent(a);
      setSession(null);
      applied = true;
      setNotice(
        a.estado === 'EN_REVISION'
          ? 'Revisa las proporciones antes de aprobar tu avatar.'
          : 'Avatar listo para probar prendas.',
      );
    } catch (e) {
      if (epoch === viewEpoch.current) setError((e as Error).message);
    } finally {
      if (url && !applied) URL.revokeObjectURL(url);
      if (epoch === viewEpoch.current) setBusy(false);
    }
  }
  async function approve() {
    if (!current) return;
    const epoch = ++viewEpoch.current;
    setBusy(true);
    try {
      await api('/avatars/' + current.id + '/approve', { method: 'POST' });
      if (epoch !== viewEpoch.current) return;
      setCurrent({ ...current, estado: 'APROBADO' });
      await reload();
      if (epoch !== viewEpoch.current) return;
      setNotice('Avatar aprobado. Elige una prenda en el catálogo.');
    } catch (e) {
      if (epoch === viewEpoch.current) setError((e as Error).message);
    } finally {
      if (epoch === viewEpoch.current) setBusy(false);
    }
  }
  async function removeAvatar(a: Avatar) {
    if (!window.confirm('¿Eliminar este avatar y sus medidas? Esta acción no se puede deshacer.'))
      return;
    const epoch = ++viewEpoch.current;
    setBusy(true);
    try {
      await api('/avatars/' + a.id, { method: 'DELETE' });
      if (epoch !== viewEpoch.current) return;
      if (current?.id === a.id) {
        setCurrent(null);
        setBodyUrl(tenantAsset('/assets/reference.glb'));
        setGarmentUrl(tenantAsset('/assets/dress-M.glb'));
      }
      await reload();
      if (epoch !== viewEpoch.current) return;
      setNotice('El avatar ya no puede abrirse. Se está completando el borrado de sus archivos.');
    } catch (e) {
      if (epoch === viewEpoch.current) setError((e as Error).message);
    } finally {
      if (epoch === viewEpoch.current) setBusy(false);
    }
  }
  async function tryGarment(v: Variant) {
    setSelected(v);
    setError('');
    if (!user) {
      setAuthOpen(true);
      return;
    }
    const approved =
      current?.estado === 'APROBADO' ? current : avatars.find((a) => a.estado === 'APROBADO');
    if (!approved) {
      openAvatar();
      setNotice('Primero crea y aprueba tu avatar para probar esta prenda.');
      return;
    }
    if (!v.modeloId) {
      setNotice('Esta variante todavía no tiene un recurso 3D publicado.');
      return;
    }
    const epoch = ++viewEpoch.current;
    setBusy(true);
    let nextBody: string | undefined,
      nextGarment: string | undefined,
      applied = false;
    try {
      if (current?.id !== approved.id)
        nextBody = await privateModel('/avatars/' + approved.id + '/model');
      if (epoch !== viewEpoch.current) return;
      const s =
        session && current?.id === approved.id
          ? { id: session }
          : await api('/fitting', {
              method: 'POST',
              body: JSON.stringify({ avatarId: approved.id }),
            });
      if (epoch !== viewEpoch.current) return;
      await api('/fitting/' + s.id + '/try', {
        method: 'POST',
        body: JSON.stringify({ modeloId: v.modeloId, eventoId: crypto.randomUUID() }),
      });
      if (epoch !== viewEpoch.current) return;
      nextGarment = await privateModel('/fitting/models/' + v.modeloId);
      if (epoch !== viewEpoch.current) return;
      if (nextBody) setBodyUrl(nextBody);
      setSession(s.id);
      setCurrent(approved);
      setGarmentUrl(nextGarment);
      applied = true;
      setNotice('Prenda cargada sobre tu avatar. La vista es aproximada.');
      setPage('catalogo');
    } catch (e) {
      if (epoch === viewEpoch.current) setError((e as Error).message);
    } finally {
      if (!applied) {
        if (nextBody) URL.revokeObjectURL(nextBody);
        if (nextGarment) URL.revokeObjectURL(nextGarment);
      }
      if (epoch === viewEpoch.current) setBusy(false);
    }
  }
  const filtered = visibleProducts;
  return (
    <>
      <a href="#contenido" className="skip-link">
        Saltar al contenido
      </a>
      <div className="announcement">
        MODA FEMENINA · VESTIDOR VIRTUAL <span>Lúmina · Grupo 18</span>
      </div>
      <header>
        <button className="wordmark" onClick={() => setPage('catalogo')}>
          lúmina<span>°</span>
          <small>MODA FEMENINA · VESTIDOR 3D</small>
        </button>
        <nav aria-label="Principal">
          <button
            className={page === 'catalogo' ? 'active' : ''}
            onClick={() => setPage('catalogo')}
          >
            Colección
          </button>
          <button className={page === 'avatar' ? 'active' : ''} onClick={openAvatar}>
            Mi avatar
          </button>
          {user && (
            <button
              className={page === 'commerce' ? 'active' : ''}
              onClick={() => setPage('commerce')}
            >
              <ShoppingBag size={16} /> Mi carrito
            </button>
          )}
          {businessModules.some(
            (module) => module.permission && user?.permissions?.includes(module.permission),
          ) && (
            <button className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>
              Administración
            </button>
          )}
        </nav>
        <div className="account">
          <select
            className="tenant-selector"
            aria-label="Tienda"
            value={tenantSlug()}
            onChange={(event) => selectTenant(event.target.value)}
          >
            {!stores.some((store) => store.slug === tenantSlug()) && (
              <option value={tenantSlug()}>{tenantSlug()}</option>
            )}
            {stores.map((store) => (
              <option key={store.slug} value={store.slug}>
                {store.name}
              </option>
            ))}
          </select>
          {user ? (
            <>
              <span>Hola, {user.nombres.split(' ')[0]}</span>
              <button onClick={logout} aria-label="Cerrar sesión">
                <LogOut size={18} />
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setRegister(false);
                setAuthOpen(true);
              }}
            >
              <User size={17} /> Iniciar sesión
            </button>
          )}
        </div>
      </header>
      <main id="contenido">
        <div className="breadcrumbs">
          Inicio <ChevronRight size={12} />{' '}
          {page === 'catalogo'
            ? 'Colección / Moda femenina'
            : page === 'avatar'
              ? 'Tu espacio / Mi avatar'
              : page === 'admin'
                ? 'Administración / Mi negocio'
                : 'Tienda / Carrito y pedidos'}
        </div>
        {error && !authOpen && (
          <div className="message error" role="alert">
            {error}
            <button aria-label="Cerrar aviso" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
            <button aria-label="Cerrar aviso" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {page === 'catalogo' ? (
          <>
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span /> VESTIDOS Y FALDAS PARA EXPRESAR TU ESTILO
                </div>
                <h1>
                  Primero imagínalo.
                  <br />
                  <em>Después, pruébatelo.</em>
                </h1>
                <p>
                  Explora vestidos y faldas de marcas reales. Crea tu avatar a partir de fotos de
                  cuerpo completo y descubre una vista 3D aproximada de cada prenda.
                </p>
                <button className="primary" onClick={openAvatar}>
                  Crear mi avatar <ArrowUpRight size={20} />
                </button>
                <div className="hero-benefits">
                  <span>
                    <ScanLine size={17} /> A partir de tus fotos
                  </span>
                  <span>
                    <ShieldCheck size={17} /> Solo tú tienes acceso
                  </span>
                </div>
                <div className="step-note">
                  <span>01 — 03</span>
                  <p>
                    Tres fotos. Tu altura.
                    <br />
                    Una nueva manera de verte.
                  </p>
                </div>
              </div>
              <div className="hero-model">
                <Viewer
                  bodyUrl={bodyUrl}
                  garmentUrl={garmentUrl}
                  color={selected?.color_hex}
                  reference={!current}
                />
                <div className="model-info">
                  <div>
                    <small>{current ? 'TU VESTIDOR' : 'EXPLORA EL VESTIDOR'}</small>
                    <b>
                      {current ? 'Avatar · versión ' + current.version : 'Vestido de referencia'}
                    </b>
                    <span>
                      {current
                        ? 'Representación corporal aproximada'
                        : 'Maniquí de referencia · aún no es tu avatar'}
                    </span>
                  </div>
                  <div className="round-icon">
                    <Layers3 size={21} />
                  </div>
                </div>
              </div>
            </section>
            <section className="collection">
              <div className="section-top">
                <div className="section-title">
                  <span className="eyebrow">LA COLECCIÓN LÚMINA</span>
                  <h2>
                    Vestidos y faldas para ti<span> ({filtered.length})</span>
                  </h2>
                </div>
                <div className="catalog-filters">
                  <label className="location-filter">
                    <span>Tipo de prenda</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value)}>
                      <option value="">Vestidos y faldas</option>
                      {categories.map((option) => (
                        <option value={option.id} key={option.id}>
                          {option.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="location-filter">
                    <span>Disponibilidad</span>
                    <select
                      value={catalogLocation}
                      onChange={(event) => {
                        setCatalogLocation(event.target.value);
                      }}
                    >
                      <option value="">Todas las sucursales y almacenes</option>
                      {catalogLocations.map((location) => (
                        <option value={location.id} key={location.id}>
                          {location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'} · {location.nombre}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="location-filter">
                    <span>Marca</span>
                    <select value={brand} onChange={(event) => setBrand(event.target.value)}>
                      <option value="">Todas las marcas</option>
                      {filterOptions.brands.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="location-filter">
                    <span>Color</span>
                    <select value={color} onChange={(event) => setColor(event.target.value)}>
                      <option value="">Todos los colores</option>
                      {filterOptions.colors.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="location-filter">
                    <span>Talla</span>
                    <select value={size} onChange={(event) => setSize(event.target.value)}>
                      <option value="">Todas las tallas</option>
                      {filterOptions.sizes.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  <label className="search">
                    <Search size={17} />
                    <input
                      aria-label="Buscar prendas"
                      placeholder="Buscar en la colección"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  {(catalogLocation || category || brand || color || size || query) && (
                    <button
                      className="clear-catalog-filters"
                      onClick={() => {
                        setCatalogLocation('');
                        setCategory('');
                        setBrand('');
                        setColor('');
                        setSize('');
                        setQuery('');
                      }}
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>
              </div>
              <div className="product-grid">
                {filtered.map((p, i) => {
                  const images = p.imagenes || [];
                  const activeImage = images[galleryIndex[p.id] || 0] || images[0];
                  const v =
                    selected && p.variantes.some((x) => x.id === selected.id)
                      ? selected
                      : p.variantes[1] || p.variantes[0];
                  return (
                    <article className="product" key={p.id}>
                      <div className={'product-image tone-' + i}>
                        <span className="product-badge">
                          <Shirt size={12} />{' '}
                          {v?.modeloId ? 'Vista 3D referencial' : 'Moda femenina'}
                        </span>
                        {activeImage ? (
                          <img
                            className="catalog-photo"
                            src={activeImage.url}
                            alt={activeImage.textoAlternativo}
                          />
                        ) : (
                          <GarmentArt color={v?.color_hex} />
                        )}
                        <button
                          aria-label={'Probar ' + p.nombre}
                          onClick={() => v && tryGarment(v)}
                          className="product-arrow"
                          disabled={busy}
                        >
                          <ArrowUpRight size={20} />
                        </button>
                      </div>
                      {images.length > 1 && (
                        <div className="catalog-thumbnails" aria-label={`Fotos de ${p.nombre}`}>
                          {images.map((image, index) => (
                            <button
                              key={image.url}
                              className={activeImage?.url === image.url ? 'active' : ''}
                              aria-label={`Ver foto ${index + 1} de ${p.nombre}`}
                              onClick={() =>
                                setGalleryIndex((current) => ({ ...current, [p.id]: index }))
                              }
                            >
                              <img src={image.url} alt="" />
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="product-title">
                        <h3>{p.nombre}</h3>
                        <b>{v ? money(v.precio) : '—'}</b>
                      </div>
                      <p>
                        {p.marca || 'Sin marca'} · {p.material} · {v?.color}
                      </p>
                      <div className="variant-row">
                        <div className="sizes">
                          {p.variantes.map((x) => (
                            <button
                              aria-label={p.nombre + ' talla ' + x.talla}
                              aria-pressed={v?.id === x.id}
                              className={v?.id === x.id ? 'chosen' : ''}
                              key={x.id}
                              onClick={() => setSelected(x)}
                            >
                              {x.talla}
                            </button>
                          ))}
                        </div>
                        <button
                          className="text-button"
                          disabled={busy || !v}
                          onClick={() => v && tryGarment(v)}
                        >
                          Probar en 3D <ArrowRight size={15} />
                        </button>
                      </div>
                      <small className="stock">
                        {v?.disponible} unidades de demostración · precio académico
                      </small>
                      <button
                        className="cart-add"
                        disabled={busy || !v || v.disponible < 1}
                        onClick={() => v && void addToCart(v)}
                      >
                        <ShoppingBag size={16} /> Agregar al carrito
                      </button>
                      {v?.ubicaciones?.length ? (
                        <div className="location-stock" aria-label="Disponibilidad por ubicación">
                          {v.ubicaciones.map((location) => (
                            <span key={location.id}>
                              <b>
                                {location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'}{' '}
                                {location.nombre}
                              </b>
                              {location.disponible} u.
                            </span>
                          ))}
                        </div>
                      ) : (
                        <small className="location-empty">
                          Sin existencias en sucursales o almacenes.
                        </small>
                      )}
                    </article>
                  );
                })}
              </div>
              {!catalogLoading && filtered.length === 0 && (
                <div className="empty">
                  No hay prendas para esa combinación de tipo, marca, color y talla.
                </div>
              )}
              <p className="catalog-disclaimer">
                Catálogo académico con referencias de marcas reales. Los precios y las existencias
                son de demostración; las siluetas 3D muestran una aproximación, no el ajuste exacto
                de la prenda. Imágenes de los fabricantes. Sin afiliación comercial.
              </p>
            </section>
            <section className="how">
              <div>
                <span className="eyebrow">ASÍ DE SENCILLO</span>
                <h2>Un vestidor que empieza contigo.</h2>
              </div>
              {[
                [
                  '01',
                  'Prepara tus fotos',
                  'Frente, perfil y espalda, con el cuerpo completo visible.',
                ],
                ['02', 'Revisa tu avatar', 'Comprueba las proporciones y aprueba el resultado.'],
                ['03', 'Explora las prendas', 'Gira la vista y prueba las variantes compatibles.'],
              ].map(([n, title, t]) => (
                <div key={n}>
                  <span className="step-number">{n}</span>
                  <h3>{title}</h3>
                  <p>{t}</p>
                </div>
              ))}
            </section>
          </>
        ) : page === 'admin' ? (
          <AdminWorkspace
            products={products}
            categories={categories}
            permissions={user?.permissions || []}
            onCatalogChanged={loadCatalog}
          />
        ) : page === 'commerce' ? (
          <Commerce locations={catalogLocations} onInventoryChanged={loadCatalog} />
        ) : (
          <section className="avatar-page">
            <div className="section-title">
              <span className="eyebrow">TU ESPACIO PERSONAL</span>
              <h1>
                Un avatar <em>hecho a partir de ti.</em>
              </h1>
              <p>
                Prepara tres fotos claras de cuerpo completo. Te mostraremos el resultado para que
                lo revises antes de probar ropa.
              </p>
            </div>
            {!user ? (
              <div className="empty">
                <User size={30} />
                <h2>Guarda tu avatar en tu cuenta</h2>
                <p>Inicia sesión o crea una cuenta para continuar.</p>
                <button className="primary" onClick={() => setAuthOpen(true)}>
                  Entrar a mi cuenta <ArrowRight size={18} />
                </button>
              </div>
            ) : (
              <div className="avatar-layout">
                <div>
                  <form className="capture-form" onSubmit={uploadPhotos}>
                    <h2>Crea tu avatar</h2>
                    <p>
                      Una sola persona, luz uniforme, ropa ajustada y brazos ligeramente separados.
                      Incluye cabeza y pies en las tres fotos.
                    </p>
                    <div className="photo-grid">
                      {[
                        ['frente', 'De frente'],
                        ['perfil', 'De perfil'],
                        ['espalda', 'De espalda'],
                      ].map(([name, title], i) => (
                        <label className="photo-slot" key={name}>
                          <span>0{i + 1}</span>
                          <Camera size={28} />
                          <b>{title}</b>
                          <input
                            required
                            type="file"
                            name={name}
                            accept="image/jpeg,image/png"
                            aria-label={'Foto ' + title.toLowerCase()}
                          />
                          <small>JPEG o PNG · hasta 10 MB</small>
                        </label>
                      ))}
                    </div>
                    <label className="height-field">
                      Tu altura real{' '}
                      <div>
                        <input
                          required
                          name="altura"
                          type="number"
                          min="100"
                          max="230"
                          step="0.1"
                          placeholder="170"
                        />
                        <span>cm</span>
                      </div>
                    </label>
                    <label className="check">
                      <input type="checkbox" required name="adulto" value="true" />
                      Confirmo que soy mayor de edad y que las fotografías son mías.
                    </label>
                    <label className="check">
                      <input type="checkbox" required name="consentimiento" value="true" />
                      Autorizo el uso temporal de mis fotos para generar mi avatar. Se eliminan al
                      terminar el procesamiento o antes de 24 horas.
                    </label>
                    <button disabled={busy} className="primary" type="submit">
                      {busy ? <LoaderCircle className="spin" size={18} /> : <ScanLine size={18} />}{' '}
                      Generar mi avatar <ArrowRight size={18} />
                    </button>
                    <p className="fineprint">
                      El avatar es una aproximación visual. No garantiza la talla ni el ajuste
                      físico de una prenda.
                    </p>
                  </form>
                  {jobs.length > 0 && (
                    <div className="jobs">
                      <h3>Actividad reciente</h3>
                      {jobs.slice(0, 3).map((j) => (
                        <div key={j.id}>
                          <span className={'status ' + j.estado}>
                            {j.estado.replaceAll('_', ' ')}
                          </span>
                          <span>
                            {j.error_codigo
                              ? (
                                  {
                                    FOTO_SIN_PERSONA:
                                      'No se detectó una persona. Revisa tus fotos.',
                                    FOTO_BORROSA: 'La foto está borrosa. Toma otra con más luz.',
                                    CUERPO_INCOMPLETO: 'Incluye cabeza y pies en las tres vistas.',
                                    VISTAS_REPETIDAS: 'Usa una foto diferente para cada vista.',
                                    PROCESADOR_NO_DISPONIBLE: 'El procesador no está disponible.',
                                  } as Record<string, string>
                                )[j.error_codigo] || 'Revisa las fotos y vuelve a intentarlo.'
                              : j.estado === 'COMPLETADO'
                                ? 'Avatar listo para revisar.'
                                : 'Procesando tu solicitud.'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="avatar-sidebar">
                  {current ? (
                    <>
                      <Viewer bodyUrl={bodyUrl} reference={false} />
                      <h3>Avatar · versión {current.version}</h3>
                      {current.medidas && (
                        <div className="measurements">
                          {Object.entries(current.medidas).map(([name, m]) => (
                            <div key={name}>
                              <span>{name}</span>
                              <b>{m.valor_cm.toFixed(1)} cm</b>
                            </div>
                          ))}
                        </div>
                      )}
                      {current.estado === 'EN_REVISION' && (
                        <button className="primary" disabled={busy} onClick={approve}>
                          <Check size={18} /> Aprobar este avatar
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="avatar-empty">
                      <ScanLine size={34} />
                      <h3>Aquí comienza tu vestidor.</h3>
                      <p>Cuando esté listo, selecciona tu avatar para revisarlo en 3D.</p>
                    </div>
                  )}
                  <h3>Mis avatares</h3>
                  {avatars.length === 0 ? (
                    <p className="fineprint">Todavía no has creado un avatar.</p>
                  ) : (
                    avatars.map((a) => (
                      <div className="avatar-item" key={a.id}>
                        <button
                          onClick={() => showAvatar(a)}
                          disabled={busy || a.estado === 'ELIMINANDO'}
                        >
                          <User size={17} />
                          <span>
                            Versión {a.version}
                            <small>{a.estado.replaceAll('_', ' ')}</small>
                          </span>
                          <ChevronRight size={16} />
                        </button>
                        <button
                          aria-label={'Eliminar avatar versión ' + a.version}
                          onClick={() => removeAvatar(a)}
                          disabled={busy || a.estado === 'ELIMINANDO'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
      <footer>
        <span className="footer-logo">lúmina°</span>
        <p>Moda femenina. Tu perspectiva.</p>
        <span>GRUPO 18 · PROYECTO ACADÉMICO</span>
      </footer>
      {authOpen && (
        <div className="modal-overlay" onClick={() => setAuthOpen(false)}>
          <section
            className="auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" aria-label="Cerrar" onClick={() => setAuthOpen(false)}>
              <X size={20} />
            </button>
            <span className="eyebrow">BIENVENIDA A LÚMINA</span>
            <h2 id="auth-title">{register ? 'Crea tu espacio.' : 'Qué bueno verte.'}</h2>
            <p>
              {register
                ? 'Guarda tu avatar y explora las prendas a tu manera.'
                : 'Entra para continuar con tu avatar y tu colección.'}
            </p>
            {error && (
              <div className="message error" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={authenticate}>
              {register && (
                <>
                  <label>
                    Nombres
                    <input
                      autoFocus
                      required
                      name="nombres"
                      autoComplete="given-name"
                      minLength={2}
                    />
                  </label>
                  <label>
                    Apellidos
                    <input required name="apellidos" autoComplete="family-name" minLength={2} />
                  </label>
                </>
              )}
              <label>
                Correo electrónico
                <input
                  autoFocus={!register}
                  required
                  type="email"
                  name="correo"
                  autoComplete="email"
                />
              </label>
              <label>
                Contraseña
                <input
                  required
                  type="password"
                  minLength={10}
                  maxLength={72}
                  name="clave"
                  autoComplete={register ? 'new-password' : 'current-password'}
                />
              </label>
              {register && <small>Usa al menos 10 caracteres.</small>}
              <button className="primary" disabled={busy} type="submit">
                {busy ? 'Un momento…' : register ? 'Crear cuenta' : 'Iniciar sesión'}
                <ArrowRight size={18} />
              </button>
            </form>
            <button
              className="switch-auth"
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Ya tengo una cuenta' : '¿Primera vez? Crea tu cuenta'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
