import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  Building2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  ArrowUpRight,
  LayoutDashboard,
  Search,
  Copy,
  BookOpen,
  Eye,
  EyeOff,
} from 'lucide-react';
import { PLAN_CATALOG } from '@lumina/contracts';
import { PlatformOverview } from './PlatformOverview';
import { PlatformStoreDetails } from './PlatformStoreDetails';
import {
  platformDate,
  stateNames,
  subscriptionNames,
  type Store,
  type StoreDetails,
  type PlatformSummary,
} from './platform-model';
import './subscription.css';
import './platform-console.css';

type Listing = { tenants: Store[]; hasMore: boolean; nextOffset: number | null; total: number };
type Created = { tenant: Store; webPath: string; ownerEmail?: string };
class PlatformError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function platformRequest<T>(path: string, token = '', body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), body === undefined ? 25000 : 180000);
  try {
    const response = await fetch('/api/platform/operator/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new PlatformError(
        data.message || 'No se pudo completar la operación. Actualiza e intenta nuevamente.',
        response.status,
      );
    return data as T;
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    throw new Error(
      'Se perdió la conexión o venció la espera. Actualiza el listado antes de repetir un alta: el servidor pudo haberla terminado.',
    );
  } finally {
    clearTimeout(timer);
  }
}
const empty: Listing = { tenants: [], hasMore: false, nextOffset: null, total: 0 };
export function PlatformProvision() {
  const requestedPlan = new URLSearchParams(location.search).get('plan');
  const initialPlan =
    Object.values(PLAN_CATALOG).find((p) => p.code === requestedPlan)?.code || 'pro';
  const [token, setToken] = useState(''),
    [listing, setListing] = useState<Listing>(empty);
  const [summary, setSummary] = useState<PlatformSummary | null>(null),
    [detail, setDetail] = useState<StoreDetails | null>(null);
  const [section, setSection] = useState<'overview' | 'stores' | 'create' | 'guide'>(
    requestedPlan ? 'create' : 'overview',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [created, setCreated] = useState<Created | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [search, setSearch] = useState(''),
    [state, setState] = useState('ALL'),
    [plan, setPlan] = useState('ALL');
  const applied = useRef({ search: '', state: 'ALL', plan: 'ALL' });
  const epoch = useRef(0),
    busyRef = useRef(false);
  const [expiresAt, setExpiresAt] = useState(0);
  function exit(message = '') {
    epoch.current++;
    setToken('');
    setListing(empty);
    setSummary(null);
    setDetail(null);
    setCreated(null);
    setError(message);
    setNotice('');
    setExpiresAt(0);
    setPasswordVisible(false);
  }
  function failure(error: unknown) {
    if (error instanceof PlatformError && error.status === 401)
      exit('La sesión del operador venció. Vuelve a ingresar.');
    else setError((error as Error).message);
  }
  useEffect(() => {
    if (!token || !expiresAt) return;
    const timer = setTimeout(
      () => exit('La sesión del operador venció. Vuelve a ingresar.'),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [token, expiresAt]);
  async function load(access = token, offset = 0) {
    const currentEpoch = epoch.current;
    const query = new URLSearchParams({ ...applied.current, offset: String(offset) });
    const [rows, overview] = await Promise.all([
      platformRequest<Listing>('tenants?' + query, access),
      platformRequest<PlatformSummary>('dashboard', access),
    ]);
    if (currentEpoch !== epoch.current) throw new PlatformError('La sesión cambió.', 401);
    setSummary(overview);
    setListing((previous) => ({
      ...rows,
      tenants: offset
        ? [
            ...previous.tenants,
            ...rows.tenants.filter((s) => !previous.tenants.some((p) => p.id === s.id)),
          ]
        : rows.tenants,
    }));
  }
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (error) {
      failure(error);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    await run(async () => {
      const response = await platformRequest<{ accessToken: string; expiresIn: number }>(
        'login',
        '',
        { username: data.get('username'), password: data.get('password') },
      );
      applied.current = { search: '', state: 'ALL', plan: 'ALL' };
      setSearch('');
      setState('ALL');
      setPlan('ALL');
      await load(response.accessToken);
      setToken(response.accessToken);
      setExpiresAt(Date.now() + response.expiresIn * 1000);
      form.reset();
    });
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    if (new TextEncoder().encode(String(data.get('ownerPassword'))).length > 72) {
      setError('La contraseña supera el límite de 72 bytes. Usa menos caracteres.');
      return;
    }
    setCreated(null);
    setNotice('');
    await run(async () => {
      const generation = epoch.current;
      const response = await platformRequest<Created>('tenants', token, Object.fromEntries(data));
      if (generation !== epoch.current) return;
      setCreated({ ...response, ownerEmail: String(data.get('ownerEmail')).trim().toLowerCase() });
      form.reset();
      await load();
    });
  }
  async function inspect(id: string) {
    await run(async () => {
      const generation = epoch.current;
      const data = await platformRequest<StoreDetails>('tenants/' + encodeURIComponent(id), token);
      if (generation === epoch.current) setDetail(data);
    });
  }
  function filter(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    applied.current = { search: search.trim(), state, plan };
    void run(() => load());
  }
  function handoff() {
    if (!created) return;
    const text = `Negocio: ${created.tenant.name}\nIdentificador: ${created.tenant.slug}\nURL: ${location.origin + created.webPath}\nCorreo administrador: ${created.ownerEmail}\nContraseña inicial: entregada por separado\nPlan: ${PLAN_CATALOG[created.tenant.planCode as keyof typeof PLAN_CATALOG]?.name || created.tenant.planCode}\nFin de prueba: ${platformDate(created.tenant.trialEndsAt)}`;
    void navigator.clipboard.writeText(text).then(
      () =>
        setNotice(
          'Ficha copiada sin contraseña. Entrega la contraseña inicial por un canal privado.',
        ),
      () => setNotice('No se pudo copiar. Los datos de entrega siguen visibles en esta ficha.'),
    );
  }
  return (
    <main className="platform-console operator-console">
      <header className="platform-top">
        <a className="platform-wordmark" href="/">
          LÚMINA<span>PLATAFORMA PARA NEGOCIOS DE MODA</span>
        </a>
        <span className="platform-label">
          <ShieldCheck size={16} /> Superadministración
        </span>
        {token && (
          <button className="saas-secondary" disabled={busy} onClick={() => exit()}>
            <LogOut size={16} /> Salir de plataforma
          </button>
        )}
      </header>
      {!token ? (
        <div className="operator-entry">
          <aside className="operator-entry-aside">
            <span className="operator-entry-emblem">
              <ShieldCheck size={35} />
            </span>
            <span className="eyebrow">CONSOLA GLOBAL DE LÚMINA</span>
            <h2>
              Cada negocio,
              <br />
              en su propio espacio.
            </h2>
            <p>Acompaña a las tiendas de la plataforma desde un acceso reservado al operador.</p>
            <ul>
              <li>
                <LayoutDashboard size={18} />
                <div>
                  <strong>Una visión de la plataforma</strong>
                  <span>Consulta los negocios, sus planes y su vigencia.</span>
                </div>
              </li>
              <li>
                <Building2 size={18} />
                <div>
                  <strong>Un comienzo independiente</strong>
                  <span>Prepara cada tienda con su administradora y sus propios datos.</span>
                </div>
              </li>
              <li>
                <ShieldCheck size={18} />
                <div>
                  <strong>Accesos separados</strong>
                  <span>Cada equipo trabaja dentro de su negocio.</span>
                </div>
              </li>
            </ul>
            <small>Superadministración · Operador de plataforma</small>
          </aside>
          <section className="platform-login saas-surface">
            <div className="saas-icon">
              <Building2 size={26} />
            </div>
            <span className="eyebrow">ACCESO DE SUPERADMINISTRADOR</span>
            <h1>Acceso de plataforma</h1>
            <p>
              Bienvenido de vuelta. Ingresa con tu cuenta del operador para abrir la consola global.
            </p>
            <form className="saas-form" onSubmit={login}>
              <label>
                Usuario de plataforma
                <input
                  name="username"
                  required
                  autoComplete="username"
                  maxLength={100}
                  disabled={busy}
                />
              </label>
              <div className="saas-field">
                <label htmlFor="operator-password">Contraseña de plataforma</label>
                <div className="operator-password">
                  <input
                    id="operator-password"
                    name="password"
                    type={passwordVisible ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    minLength={10}
                    maxLength={72}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={passwordVisible}
                    onClick={() => setPasswordVisible((value) => !value)}
                  >
                    {passwordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
              {error && (
                <p role="alert" className="saas-alert">
                  {error}
                </p>
              )}
              <button className="saas-primary" disabled={busy}>
                {busy ? 'Verificando…' : 'Entrar a plataforma'}
              </button>
            </form>
            <p className="operator-caption">
              Acceso separado de las cuentas comerciales. Sesión de 15 minutos, conservada solo en
              esta página.
            </p>
            <div className="operator-entry-links">
              <a href="/">← Volver al inicio</a>
              <a href="/#tiendas">
                Entrar a mi negocio <ArrowUpRight size={13} />
              </a>
            </div>
            <a className="saas-back" href="/?tienda=lumina">
              Ver tienda de demostración
            </a>
          </section>
        </div>
      ) : (
        <>
          <div className="saas-heading">
            <div>
              <span className="eyebrow">CONTROL DE PLATAFORMA</span>
              <h1>Administrar tiendas</h1>
              <p>Una plataforma compartida. Cada negocio con sus propios datos.</p>
            </div>
            <button
              className="saas-secondary"
              disabled={busy}
              onClick={() => void run(() => load())}
            >
              <RefreshCw size={16} /> Actualizar listado
            </button>
          </div>
          <nav className="operator-navigation" aria-label="Secciones de plataforma">
            {(
              [
                { id: 'overview', label: 'Resumen', icon: LayoutDashboard },
                { id: 'stores', label: 'Tiendas registradas', icon: Building2 },
                { id: 'create', label: 'Preparar un negocio', icon: Plus },
                { id: 'guide', label: 'Guía de entrega', icon: BookOpen },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={section === id}
                disabled={busy}
                onClick={() => setSection(id)}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </nav>
          {busy && (
            <p role="status" className="operator-loading">
              Consultando o preparando el negocio…
            </p>
          )}
          {error && (
            <p role="alert" className="saas-alert">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="saas-success">
              {notice}
            </p>
          )}
          {section === 'overview' && summary && (
            <PlatformOverview
              data={summary}
              onInspect={(id) => void inspect(id)}
              onList={() => setSection('stores')}
            />
          )}
          {section === 'create' && (
            <section className="operator-create-grid">
              <section className="saas-surface">
                <h2>
                  <Plus size={20} /> Preparar un negocio
                </h2>
                <p className="operator-caption">
                  Alta manual conforme al manual: 14 días de prueba, catálogo vacío y una sucursal
                  principal. No se cobra por prepararla.
                </p>
                <form className="saas-form" onSubmit={create}>
                  <fieldset disabled={busy} className="operator-form-fields">
                    <label>
                      Nombre de la tienda
                      <input
                        name="name"
                        required
                        minLength={2}
                        maxLength={120}
                        autoComplete="organization"
                      />
                    </label>
                    <label>
                      Identificador de tienda
                      <input
                        name="slug"
                        required
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        maxLength={63}
                        aria-describedby="slug-help"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    <small id="slug-help">
                      Minúsculas, números y guiones. Único en la plataforma; lumina está reservado.
                    </small>
                    <label>
                      Correo de la administradora
                      <input
                        name="ownerEmail"
                        type="email"
                        required
                        maxLength={160}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      Contraseña inicial
                      <input
                        name="ownerPassword"
                        type="password"
                        required
                        minLength={10}
                        maxLength={72}
                        autoComplete="new-password"
                      />
                    </label>
                    <small>
                      Entre 10 y 72 caracteres y máximo 72 bytes. Se entrega por separado; no se
                      puede recuperar desde el listado.
                    </small>
                    <label htmlFor="platform-initial-plan">
                      Plan inicial
                      <select id="platform-initial-plan" name="planCode" defaultValue={initialPlan}>
                        {Object.values(PLAN_CATALOG).map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.name} ·{' '}
                            {p.contactSales
                              ? 'A medida'
                              : `USD ${(p.priceMinor / 100).toFixed(2)}/mes`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button className="saas-primary" disabled={busy}>
                      {busy ? 'Preparando…' : 'Preparar tienda'}
                    </button>
                  </fieldset>
                </form>
              </section>
              <aside className="saas-surface operator-create-notes">
                <span className="eyebrow">ANTES DE ENTREGAR</span>
                <h2>Una tienda lista para empezar.</h2>
                <ol>
                  <li>Confirma nombre, identificador y plan con la propietaria.</li>
                  <li>
                    Espera el mensaje Tienda preparada. Si se pierde la conexión, consulta el
                    listado antes de repetir.
                  </li>
                  <li>
                    Entrega el enlace explícito, correo, contraseña inicial, plan y fin de prueba.
                  </li>
                  <li>
                    La administradora inicia sesión en su tienda, verifica Sucursal principal y
                    carga su catálogo.
                  </li>
                </ol>
                <p className="operator-caption">
                  Crear una cuenta de clienta no crea un negocio. Agregar una sucursal o renovar el
                  plan se realiza dentro de la tienda existente.
                </p>
              </aside>
              {created && (
                <section className="saas-surface operator-handoff" role="status">
                  <span className="eyebrow">TIENDA PREPARADA</span>
                  <h2>{created.tenant.name}</h2>
                  <dl>
                    <div>
                      <dt>Identificador</dt>
                      <dd>{created.tenant.slug}</dd>
                    </div>
                    <div>
                      <dt>Correo administrador</dt>
                      <dd>{created.ownerEmail}</dd>
                    </div>
                    <div>
                      <dt>Plan</dt>
                      <dd>
                        {PLAN_CATALOG[created.tenant.planCode as keyof typeof PLAN_CATALOG]?.name ||
                          created.tenant.planCode}
                      </dd>
                    </div>
                    <div>
                      <dt>Fin de prueba</dt>
                      <dd>{platformDate(created.tenant.trialEndsAt)}</dd>
                    </div>
                  </dl>
                  <p>
                    La contraseña inicial se entrega por un canal privado. Esta ficha no la
                    almacena.
                  </p>
                  <div className="operator-actions">
                    <a
                      className="saas-primary"
                      href={created.webPath}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir tienda <ArrowUpRight size={15} />
                    </a>
                    <button className="saas-secondary" onClick={handoff}>
                      <Copy size={15} /> Copiar ficha de entrega
                    </button>
                    <button
                      className="saas-secondary"
                      disabled={busy}
                      onClick={() => void inspect(created.tenant.id)}
                    >
                      Ver ficha
                    </button>
                  </div>
                </section>
              )}
            </section>
          )}
          {section === 'stores' && (
            <section className="saas-surface platform-store-list">
              <div className="saas-section-heading">
                <h2>Tiendas registradas</h2>
                <span>
                  {listing.tenants.length} de {listing.total}
                </span>
              </div>
              <form className="operator-filters" onSubmit={filter}>
                <label>
                  Buscar por nombre o identificador
                  <input
                    value={search}
                    maxLength={100}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Ej. universidad"
                  />
                </label>
                <label>
                  Estado del negocio
                  <select value={state} onChange={(e) => setState(e.target.value)}>
                    <option value="ALL">Todos los estados</option>
                    {Object.entries(stateNames).map(([code, name]) => (
                      <option key={code} value={code}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Plan
                  <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                    <option value="ALL">Todos los planes</option>
                    <option value="piloto">Espacio inicial</option>
                    {Object.values(PLAN_CATALOG).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="saas-secondary" disabled={busy}>
                  <Search size={16} /> Buscar
                </button>
              </form>
              {!listing.tenants.length && (
                <p className="operator-empty">No hay negocios que coincidan con esta búsqueda.</p>
              )}
              <div className="operator-stores">
                {listing.tenants.map((store) => (
                  <article key={store.id} className="platform-store">
                    <div>
                      <h3>{store.name}</h3>
                      <code>{store.slug}</code>
                      <p>
                        {PLAN_CATALOG[store.planCode as keyof typeof PLAN_CATALOG]?.name ||
                          'Espacio inicial'}{' '}
                        · {subscriptionNames[store.effectiveStatus || store.status] || store.status}
                      </p>
                      <small>
                        {store.status === 'TRIALING'
                          ? 'Fin de prueba: ' + platformDate(store.trialEndsAt)
                          : store.paidThrough
                            ? 'Vigencia: ' + platformDate(store.paidThrough)
                            : 'Espacio sin vencimiento comercial registrado'}
                      </small>
                    </div>
                    <div className="operator-store-actions">
                      <span
                        className={
                          'saas-state ' +
                          (['FAILED', 'SUSPENDED'].includes(store.state) ? 'saas-state-error' : '')
                        }
                      >
                        {stateNames[store.state] || store.state}
                      </span>
                      <button
                        className="operator-text-button"
                        disabled={busy}
                        onClick={() => void inspect(store.id)}
                      >
                        Ver ficha <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {listing.hasMore && (
                <button
                  className="saas-secondary"
                  disabled={busy}
                  onClick={() => void run(() => load(token, listing.nextOffset || 0))}
                >
                  Cargar más tiendas
                </button>
              )}
            </section>
          )}
          {section === 'guide' && (
            <section className="saas-surface operator-guide">
              <span className="eyebrow">MANUAL DE CREACIÓN DE TENANTS</span>
              <h2>Del alta a la entrega.</h2>
              <ol>
                <li>
                  <strong>Preparar.</strong> Nombre, slug único, correo, contraseña inicial y plan.
                  Espera Tienda preparada.
                </li>
                <li>
                  <strong>Comprobar.</strong> La ficha debe mostrar En prueba, su plan y fecha de
                  fin. La tienda empieza sin productos ni stock.
                </li>
                <li>
                  <strong>Entregar.</strong> URL con ?tienda=identificador, correo, contraseña por
                  separado, plan y fin de prueba. No se envía un correo de bienvenida
                  automáticamente.
                </li>
                <li>
                  <strong>Iniciar.</strong> La administradora comprueba Sucursal principal, registra
                  prendas y variantes, carga stock y agrega su equipo.
                </li>
              </ol>
              <h3>Web y Android</h3>
              <p>
                En web utiliza siempre el enlace explícito de la tienda. En Android introduce su
                Identificador de tienda y las credenciales de su administradora.
              </p>
              <h3>Prueba y suscripción</h3>
              <p>
                El alta manual inicia una prueba de 14 días, sin cargo. La administradora gestiona
                después su plan desde Mi negocio y plan. La Demo pública de 10 días y los pagos
                Stripe TEST/QR ya desarrollados conservan su flujo propio.
              </p>
              <h3>Si la preparación falla</h3>
              <p>
                Consulta el listado antes de repetir. Los estados Preparando y Revisión requerida
                necesitan diagnóstico técnico; el identificador queda reservado. La ficha global no
                elimina datos ni reintenta automáticamente una provisión.
              </p>
            </section>
          )}
          <PlatformStoreDetails data={detail} onClose={() => setDetail(null)} />
        </>
      )}
    </main>
  );
}
