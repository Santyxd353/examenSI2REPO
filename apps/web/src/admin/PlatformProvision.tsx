import { FormEvent, useState } from 'react';
import { Building2, LogOut, Plus, RefreshCw, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { PLAN_CATALOG } from '@lumina/contracts';
import './subscription.css';

type Store = {
  id: string;
  slug: string;
  name: string;
  state: string;
  planCode: string;
  status: string;
};
type Listing = { tenants: Store[]; hasMore: boolean; nextOffset: number | null };
type Created = { tenant: Store; webPath: string };
async function platformRequest<T>(path: string, token = '', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/platform/operator/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'omit',
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      'Se perdió la conexión. Conéctate y actualiza el listado antes de repetir una preparación.',
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      data.message || 'No se pudo completar la operación. Actualiza e intenta nuevamente.',
    );
  return data as T;
}
const stateNames: Record<string, string> = {
  ACTIVE: 'Activa',
  TRIAL: 'En prueba',
  PROVISIONING: 'Preparando',
  SUSPENDED: 'Suspendida',
  FAILED: 'Revisión requerida',
};
export function PlatformProvision() {
  const [token, setToken] = useState(''),
    [listing, setListing] = useState<Listing>({ tenants: [], hasMore: false, nextOffset: null });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState<Created | null>(null);
  async function load(access = token, offset = 0) {
    const result = await platformRequest<Listing>(`tenants?offset=${offset}`, access);
    setListing((previous) => ({
      ...result,
      tenants: offset
        ? [
            ...previous.tenants,
            ...result.tenants.filter((row) => !previous.tenants.some((p) => p.id === row.id)),
          ]
        : result.tenants,
    }));
  }
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError('');
    try {
      const response = await platformRequest<{ accessToken: string }>('login', '', {
        username: data.get('username'),
        password: data.get('password'),
      });
      await load(response.accessToken);
      setToken(response.accessToken);
      form.reset();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError('');
    setCreated(null);
    try {
      const response = await platformRequest<Created>('tenants', token, Object.fromEntries(data));
      setCreated(response);
      form.reset();
      await load();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh(more = false) {
    setBusy(true);
    setError('');
    try {
      await load(token, more ? listing.nextOffset || 0 : 0);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="platform-console">
      <header className="platform-top">
        <a className="platform-wordmark" href="/">
          LÚMINA<span>MODA QUE SE ADAPTA A TI</span>
        </a>
        <span className="platform-label">
          <ShieldCheck size={16} /> Plataforma
        </span>
        {token && (
          <button
            className="saas-secondary"
            onClick={() => {
              setToken('');
              setListing({ tenants: [], hasMore: false, nextOffset: null });
              setCreated(null);
              setError('');
            }}
          >
            <LogOut size={16} /> Salir de plataforma
          </button>
        )}
      </header>
      {!token ? (
        <section className="platform-login saas-surface">
          <div className="saas-icon">
            <Building2 size={26} />
          </div>
          <span className="eyebrow">GESTIÓN DE TIENDAS</span>
          <h1>Acceso de plataforma</h1>
          <p>
            Prepara y administra los espacios de cada negocio. Este acceso es independiente de las
            cuentas de las tiendas.
          </p>
          <form className="saas-form" onSubmit={login}>
            <label>
              Usuario de plataforma
              <input name="username" required autoComplete="username" maxLength={100} />
            </label>
            <label>
              Contraseña de plataforma
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                minLength={10}
                maxLength={72}
              />
            </label>
            {error && (
              <p role="alert" className="saas-alert">
                {error}
              </p>
            )}
            <button className="saas-primary" disabled={busy}>
              {busy ? 'Verificando…' : 'Entrar a plataforma'}
            </button>
          </form>
          <a className="saas-back" href="/">
            Volver a la tienda
          </a>
        </section>
      ) : (
        <>
          <div className="saas-heading">
            <div>
              <span className="eyebrow">ESPACIOS INDEPENDIENTES</span>
              <h1>Administrar tiendas</h1>
              <p>Cada negocio conserva su catálogo, equipo e inventario.</p>
            </div>
            <button className="saas-secondary" disabled={busy} onClick={() => void refresh()}>
              <RefreshCw size={16} /> Actualizar listado
            </button>
          </div>
          {error && (
            <p className="saas-alert" role="alert">
              {error}
            </p>
          )}
          {created && (
            <div className="saas-success" role="status">
              <strong>Tienda preparada</strong>
              <p>
                {created.tenant.name} ya tiene acceso con su administradora y un período de prueba.
              </p>
              <a href={created.webPath}>
                Abrir tienda <ArrowUpRight size={15} />
              </a>
            </div>
          )}
          <div className="platform-columns">
            <section className="saas-surface">
              <h2>
                <Plus size={20} /> Preparar un negocio
              </h2>
              <p>La administradora recibirá su propio espacio con el plan elegido.</p>
              <form className="saas-form" onSubmit={create}>
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
                  />
                </label>
                <small id="slug-help">
                  Usa letras minúsculas, números y guiones. Se utiliza para abrir la tienda e
                  iniciar sesión.
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
                <div className="saas-field">
                  <label htmlFor="platform-initial-plan">Plan inicial</label>
                  <select id="platform-initial-plan" name="planCode" defaultValue="pro">
                    {Object.values(PLAN_CATALOG).map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.name} · Bs {plan.priceMinor / 100}/mes
                      </option>
                    ))}
                  </select>
                </div>
                <small>
                  El espacio inicia con 14 días de prueba. No se realiza ningún cargo al prepararlo.
                </small>
                <button className="saas-primary" disabled={busy}>
                  {busy ? 'Preparando…' : 'Preparar tienda'}
                </button>
              </form>
            </section>
            <section className="saas-surface platform-store-list">
              <div className="saas-section-heading">
                <h2>Tiendas registradas</h2>
                <span>{listing.tenants.length} en la lista</span>
              </div>
              {!listing.tenants.length && (
                <p>No hay tiendas registradas todavía. Prepara el primer espacio para comenzar.</p>
              )}
              {listing.tenants.map((store) => (
                <article className="platform-store" key={store.id}>
                  <div>
                    <h3>{store.name}</h3>
                    <code>{store.slug}</code>
                    <p>
                      {PLAN_CATALOG[store.planCode as keyof typeof PLAN_CATALOG]?.name ||
                        'Espacio inicial'}
                    </p>
                  </div>
                  <span
                    className={'saas-state ' + (store.state === 'FAILED' ? 'saas-state-error' : '')}
                  >
                    {stateNames[store.state] || store.state}
                  </span>
                  {['ACTIVE', 'TRIAL'].includes(store.state) && (
                    <a href={`/?tienda=${encodeURIComponent(store.slug)}`}>
                      Abrir <ArrowUpRight size={15} />
                    </a>
                  )}
                  {store.state === 'FAILED' && (
                    <small>El identificador queda reservado hasta revisar la preparación.</small>
                  )}
                </article>
              ))}
              {listing.hasMore && (
                <button
                  className="saas-secondary"
                  disabled={busy}
                  onClick={() => void refresh(true)}
                >
                  Cargar más tiendas
                </button>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
