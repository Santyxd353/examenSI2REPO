import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PLAN_CATALOG } from '@lumina/contracts';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  Eye,
  EyeOff,
  QrCode,
  ShieldCheck,
  Store,
} from 'lucide-react';
import './commercial.css';
import './signup.css';

type Choice = 'demo' | 'esencial' | 'pro';
type View = {
  id: string;
  state: string;
  companyName: string;
  slug: string;
  planCode: Choice;
  billingInterval: 'DEMO' | 'MONTHLY' | 'YEARLY';
  amountMinor: number;
  currency: string;
  provider: string;
  expiresAt: string;
  checkoutUrl: string | null;
  webPath: string | null;
};
const money = (minor: number) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'USD' }).format(minor / 100);
const identifier = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
const storageKey = 'lumina.signup.pending';
function pending() {
  const params = new URLSearchParams(location.search);
  const id = params.get('alta');
  const fragmentToken = new URLSearchParams(location.hash.slice(1)).get('pago');
  try {
    if (id && fragmentToken && /^[a-f0-9]{64}$/.test(fragmentToken)) {
      sessionStorage.setItem(storageKey, JSON.stringify({ id, token: fragmentToken }));
      history.replaceState(null, '', location.pathname + location.search);
    }
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (
      saved &&
      (!id || id === saved.id) &&
      typeof saved.id === 'string' &&
      /^[a-f0-9]{64}$/.test(saved.token)
    )
      return saved as { id: string; token: string };
  } catch {
    /* The form explains unavailable session storage before it starts a registration. */
  }
  return null;
}
function assertView(value: unknown): View {
  const view = value as View;
  if (
    !view ||
    !['PENDING', 'PAID', 'PROVISIONING', 'ACTIVE', 'REVIEW', 'EXPIRED'].includes(view.state) ||
    !Number.isSafeInteger(view.amountMinor) ||
    view.amountMinor < 0 ||
    view.currency !== 'USD' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(view.slug)
  )
    throw new Error('La respuesta del registro no es válida.');
  if (view.checkoutUrl && new URL(view.checkoutUrl).origin !== 'https://checkout.stripe.com')
    throw new Error('El enlace de pago no pertenece a Stripe.');
  return view;
}
export function PublicSignup() {
  const params = new URLSearchParams(location.search);
  const selected = params.get('plan');
  const [plan, setPlan] = useState<Choice>(
    selected === 'demo' || selected === 'esencial' ? selected : 'pro',
  );
  const [yearly, setYearly] = useState(params.get('periodo') === 'YEARLY');
  const [provider, setProvider] = useState('STRIPE_TEST');
  const [company, setCompany] = useState('');
  const [slug, setSlug] = useState('');
  const slugEdited = useRef(false);
  const [visible, setVisible] = useState(false);
  const [access, setAccess] = useState(pending);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [qr, setQr] = useState<{ qrDataUrl: string; paymentUrl: string } | null>(null);
  const last = useRef<{ fingerprint: string; id: string; token: string } | null>(null);
  const lock = useRef(false);
  const current = plan === 'demo' ? null : PLAN_CATALOG[plan];
  const price = current ? (yearly ? current.yearlyPriceMinor! : current.priceMinor) : 0;
  const actualPlan = view?.planCode || plan;
  const name =
    actualPlan === 'demo' ? 'Demo' : actualPlan === 'esencial' ? 'Esencial' : 'Profesional';
  async function call(path: string, token: string, body?: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000);
    try {
      const response = await fetch('/api/public/signup' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Signup-Token': token },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) {
        setFields(
          Object.fromEntries(
            (Array.isArray(result.errors) ? result.errors : []).map(
              (e: { field: string; message: string }) => [e.field, e.message],
            ),
          ),
        );
        throw new Error(result.message || 'No se pudo completar la solicitud.');
      }
      return result;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError')
        throw new Error(
          'La preparación sigue pendiente. Pulsa Comprobar estado para recuperar el registro; no vuelvas a pagar.',
        );
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
  async function refresh(complete = false, simulatedPayment = false) {
    if (!access || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const next = assertView(
        await call(
          '/' + access.id + (complete ? '/complete' : ''),
          access.token,
          complete ? { simulatedPayment } : undefined,
        ),
      );
      setView(next);
      setQr(null);
      if (next.state === 'PENDING' && next.provider === 'QR_SIMULATED')
        setQr(await call('/' + access.id + '/qr', access.token, {}));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar el registro.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function changePaymentMethod(provider: 'STRIPE_TEST' | 'QR_SIMULATED') {
    if (!access || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    async function display(next: View) {
      setView(next);
      setQr(null);
      if (next.state === 'PENDING' && next.provider === 'QR_SIMULATED')
        setQr(await call('/' + access!.id + '/qr', access!.token, {}));
    }
    try {
      await display(
        assertView(await call('/' + access.id + '/payment-method', access.token, { provider })),
      );
    } catch (e) {
      // A creation request can have reached Stripe even when its reply is lost.
      // Recover the committed provider without discarding this registration.
      try {
        await display(assertView(await call('/' + access.id, access.token)));
      } catch {
        /* Retry remains available. */
      }
      setError(e instanceof Error ? e.message : 'No se pudo cambiar la forma de pago.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    document.title = 'Lúmina · Crea tu negocio';
    if (access) void refresh();
  }, []);
  // Poll only the authenticated status; provisioning/payment verification remains a POST action.
  useEffect(() => {
    if (!view || !['PENDING', 'PAID', 'PROVISIONING'].includes(view.state)) return;
    const timer = setInterval(() => {
      void refresh();
    }, 10000);
    return () => clearInterval(timer);
  }, [view?.state, access]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = new FormData(event.currentTarget);
    const input = {
      companyName: company,
      slug,
      firstName: String(form.get('firstName')),
      lastName: String(form.get('lastName')),
      ownerEmail: String(form.get('email')),
      password: String(form.get('password')),
      planCode: plan,
      billingInterval: yearly ? 'YEARLY' : 'MONTHLY',
      provider,
      acceptTerms: true,
    };
    if (new TextEncoder().encode(input.password).length > 72) {
      setError('La contraseña debe tener como máximo 72 bytes. Usa menos caracteres.');
      return;
    }
    const fingerprint = JSON.stringify(input);
    if (!last.current || last.current.fingerprint !== fingerprint) {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      last.current = {
        fingerprint,
        id: crypto.randomUUID(),
        token: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
      };
    }
    const credentials = { id: last.current.id, token: last.current.token };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(credentials));
    } catch {
      setError(
        'Activa el almacenamiento de esta pestaña para conservar el registro al volver de Stripe.',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setFields({});
    setAccess(credentials);
    try {
      const result = assertView(
        await call('', credentials.token, { ...input, operationId: credentials.id }),
      );
      setView(result);
      history.replaceState(null, '', '/?registro=1&alta=' + credentials.id);
      if (result.state === 'PENDING' && result.provider === 'QR_SIMULATED')
        setQr(await call('/' + credentials.id + '/qr', credentials.token, {}));
      if (result.state === 'PENDING' && result.checkoutUrl)
        window.location.assign(result.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el negocio.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function startOver() {
    sessionStorage.removeItem(storageKey);
    setAccess(null);
    setView(null);
    setQr(null);
    setError('');
    last.current = null;
    history.replaceState(null, '', '/?registro=1&plan=' + plan);
  }
  return (
    <div className="saas-home signup-page">
      <header className="signup-header">
        <a className="sh-brand" href="/">
          lúmina<span>°</span>
          <small>TU NEGOCIO. TU ESPACIO.</small>
        </a>
        <a href="/#planes">
          <ArrowLeft size={16} /> Volver a planes
        </a>
      </header>
      <main className="signup-layout">
        <aside className="signup-story">
          <span className="sh-eyebrow">UN NUEVO CAPÍTULO PARA TU MODA</span>
          <h1>
            Tu colección.
            <br />
            <em>Tu propia tienda.</em>
          </h1>
          <p>Organiza tu negocio, reúne a tu equipo y transforma tus datos en decisiones.</p>
          <ol className="signup-steps">
            {['Elige tu plan', 'Registra tu negocio', 'Activa tu espacio'].map((text, i) => (
              <li key={text} className={view && i === 2 ? 'current' : ''}>
                <span>
                  {view?.state === 'ACTIVE' ? <Check size={15} /> : String(i + 1).padStart(2, '0')}
                </span>
                {text}
              </li>
            ))}
          </ol>
          <div className="signup-summary">
            <Store size={25} />
            <span>PLAN {name.toUpperCase()}</span>
            <strong>
              {money(view?.amountMinor ?? price)}
              <small>
                {actualPlan === 'demo'
                  ? ' / 10 días'
                  : (view ? view.billingInterval === 'YEARLY' : yearly)
                    ? ' / año'
                    : ' / mes'}
              </small>
            </strong>
            <p>
              {actualPlan === 'demo'
                ? 'Prueba sin tarjeta durante 10 días. Una Demo por correo.'
                : 'Pago por el período elegido. La renovación se confirma desde Mi negocio; sin débito automático.'}
            </p>
          </div>
          <p className="signup-assurance">
            <ShieldCheck size={18} /> Entorno académico: Stripe TEST y QR simulado. No se cobra
            dinero real.
          </p>
        </aside>
        <section className="signup-card" aria-label="Registro de negocio">
          {error && (
            <div role="alert" className="signup-error">
              {error}
            </div>
          )}
          {view ? (
            <div className="signup-payment" aria-live="polite">
              <span className="sh-eyebrow">
                {view.state === 'ACTIVE' ? 'BIENVENIDO A LÚMINA' : 'TU REGISTRO ESTÁ GUARDADO'}
              </span>
              <h2>
                {view.state === 'ACTIVE'
                  ? 'Tu tienda está lista.'
                  : view.state === 'REVIEW'
                    ? 'Estamos revisando tu alta.'
                    : view.state === 'EXPIRED'
                      ? 'Este registro venció.'
                      : view.state === 'PROVISIONING' || view.state === 'PAID'
                        ? 'Preparando tu espacio…'
                        : 'Activa tu negocio.'}
              </h2>
              <p>
                <strong>{view.companyName}</strong> · {view.slug}
              </p>
              {view.state === 'ACTIVE' ? (
                <>
                  <p>
                    Entra a tu tienda e inicia sesión con el correo y la contraseña que registraste.
                    Puedes cargar tu catálogo e invitar a tu equipo.
                  </p>
                  <a
                    className="sh-button sh-button-primary"
                    href={'/?tienda=' + encodeURIComponent(view.slug)}
                  >
                    Entrar a mi tienda <ArrowRight size={17} />
                  </a>
                </>
              ) : view.state === 'REVIEW' ? (
                <p>
                  Tu confirmación de pago quedó registrada. Comunica al operador el identificador{' '}
                  <code>{view.id}</code>. No vuelvas a pagar.
                </p>
              ) : view.state === 'EXPIRED' ? (
                <>
                  <p>Vuelve a elegir tu plan para preparar un nuevo registro.</p>
                  <button className="sh-button sh-button-outline" onClick={startOver}>
                    Volver al registro
                  </button>
                </>
              ) : (
                <>
                  {view.state === 'PENDING' && (
                    <fieldset className="signup-payment-method" disabled={busy}>
                      <legend>Cambiar forma de pago</legend>
                      <p>Conservaremos los datos de tu negocio y el plan elegido.</p>
                      <div className="signup-methods">
                        <button
                          type="button"
                          className={view.provider === 'STRIPE_TEST' ? 'selected' : ''}
                          aria-pressed={view.provider === 'STRIPE_TEST'}
                          disabled={busy || view.provider === 'STRIPE_TEST'}
                          onClick={() => void changePaymentMethod('STRIPE_TEST')}
                        >
                          <CreditCard size={17} /> Usar Stripe TEST
                        </button>
                        <button
                          type="button"
                          className={view.provider === 'QR_SIMULATED' ? 'selected' : ''}
                          aria-pressed={view.provider === 'QR_SIMULATED'}
                          disabled={busy || view.provider === 'QR_SIMULATED'}
                          onClick={() => void changePaymentMethod('QR_SIMULATED')}
                        >
                          <QrCode size={17} /> Usar QR simulado
                        </button>
                      </div>
                    </fieldset>
                  )}
                  {view.state === 'PENDING' &&
                    view.provider === 'STRIPE_TEST' &&
                    view.checkoutUrl && (
                      <>
                        <p>
                          Completa el pago seguro en Stripe y vuelve aquí para activar tu tienda.
                        </p>
                        <a
                          className="sh-button sh-button-primary"
                          href={view.checkoutUrl}
                          aria-disabled={busy}
                          onClick={(event) => {
                            if (busy) event.preventDefault();
                          }}
                        >
                          <CreditCard size={17} /> Ir a Stripe TEST
                        </a>
                      </>
                    )}
                  {view.state === 'PENDING' && view.provider === 'QR_SIMULATED' && (
                    <>
                      <p>
                        Escanea el QR con otro teléfono o abre la simulación. El importe corresponde
                        al plan y período elegidos.
                      </p>
                      {qr && (
                        <>
                          <img
                            className="signup-qr"
                            src={qr.qrDataUrl}
                            alt={'QR de prueba por ' + money(view.amountMinor)}
                          />
                          <a href={qr.paymentUrl} target="_blank" rel="noreferrer">
                            Abrir simulación de pago
                          </a>
                        </>
                      )}
                      <button
                        disabled={busy}
                        className="sh-button sh-button-primary"
                        onClick={() => void refresh(true, true)}
                      >
                        <QrCode size={17} /> Confirmar pago simulado de {money(view.amountMinor)}
                      </button>
                    </>
                  )}
                  <button
                    disabled={busy}
                    className="sh-button sh-button-outline"
                    onClick={() => void refresh(true)}
                  >
                    {busy ? 'Preparando…' : 'Comprobar estado'}
                  </button>
                  <small>
                    No cierres esta pestaña hasta terminar. Puedes recuperar el registro en este
                    navegador.
                  </small>
                </>
              )}
            </div>
          ) : (
            <>
              <span className="sh-eyebrow">CREA TU NEGOCIO</span>
              <h2>Empecemos por lo tuyo.</h2>
              <p>Registra tu empresa y la cuenta de su propietario.</p>
              <form onSubmit={submit} className="signup-form">
                <div className="signup-plan-fields">
                  <label>
                    Plan
                    <select
                      value={plan}
                      disabled={busy}
                      onChange={(e) => setPlan(e.target.value as Choice)}
                    >
                      <option value="demo">Demo · 10 días gratis</option>
                      <option value="esencial">Esencial (Basic)</option>
                      <option value="pro">Profesional</option>
                    </select>
                  </label>
                  {plan !== 'demo' && (
                    <label>
                      Período
                      <select
                        value={yearly ? 'YEARLY' : 'MONTHLY'}
                        disabled={busy}
                        onChange={(e) => setYearly(e.target.value === 'YEARLY')}
                      >
                        <option value="MONTHLY">Mensual</option>
                        <option value="YEARLY">Anual</option>
                      </select>
                    </label>
                  )}
                </div>
                <fieldset disabled={busy}>
                  <legend>
                    <span>01</span> Tu negocio
                  </legend>
                  <label>
                    Nombre del negocio
                    <input
                      name="companyName"
                      autoComplete="organization"
                      minLength={2}
                      maxLength={120}
                      required
                      value={company}
                      onChange={(e) => {
                        setCompany(e.target.value);
                        if (!slugEdited.current) setSlug(identifier(e.target.value));
                      }}
                    />
                    {fields.companyName && (
                      <small className="signup-field-error">{fields.companyName}</small>
                    )}
                  </label>
                  <label>
                    Identificador de tu tienda
                    <input
                      name="slug"
                      autoCapitalize="none"
                      spellCheck={false}
                      pattern="[a-z0-9]+(-[a-z0-9]+)*"
                      maxLength={63}
                      required
                      value={slug}
                      onChange={(e) => {
                        slugEdited.current = true;
                        setSlug(e.target.value.toLowerCase());
                      }}
                    />
                    <small>
                      Tu acceso: /?tienda={slug || 'mi-tienda'} · letras, números y guiones.
                    </small>
                    {fields.slug && <small className="signup-field-error">{fields.slug}</small>}
                  </label>
                </fieldset>
                <fieldset disabled={busy}>
                  <legend>
                    <span>02</span> Cuenta del propietario
                  </legend>
                  <div className="signup-plan-fields">
                    <label>
                      Nombres
                      <input
                        name="firstName"
                        autoComplete="given-name"
                        minLength={2}
                        maxLength={100}
                        required
                      />
                    </label>
                    <label>
                      Apellidos
                      <input
                        name="lastName"
                        autoComplete="family-name"
                        minLength={2}
                        maxLength={120}
                        required
                      />
                    </label>
                  </div>
                  <label>
                    Correo electrónico
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      maxLength={160}
                      required
                    />
                    {fields.ownerEmail && (
                      <small className="signup-field-error">{fields.ownerEmail}</small>
                    )}
                  </label>
                  <label>
                    Contraseña
                    <div className="signup-password">
                      <input
                        name="password"
                        type={visible ? 'text' : 'password'}
                        autoComplete="new-password"
                        minLength={10}
                        maxLength={72}
                        required
                      />
                      <button
                        type="button"
                        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        onClick={() => setVisible(!visible)}
                      >
                        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    <small>Entre 10 y 72 caracteres. Usa una contraseña exclusiva.</small>
                    {fields.password && (
                      <small className="signup-field-error">{fields.password}</small>
                    )}
                  </label>
                </fieldset>
                {plan !== 'demo' && (
                  <fieldset disabled={busy}>
                    <legend>
                      <span>03</span> Forma de pago
                    </legend>
                    <div className="signup-methods">
                      <label className={provider === 'STRIPE_TEST' ? 'selected' : ''}>
                        <input
                          type="radio"
                          name="provider"
                          checked={provider === 'STRIPE_TEST'}
                          onChange={() => setProvider('STRIPE_TEST')}
                        />
                        <CreditCard size={19} /> Stripe TEST
                      </label>
                      <label className={provider === 'QR_SIMULATED' ? 'selected' : ''}>
                        <input
                          type="radio"
                          name="provider"
                          checked={provider === 'QR_SIMULATED'}
                          onChange={() => setProvider('QR_SIMULATED')}
                        />
                        <QrCode size={19} /> QR simulado
                      </label>
                    </div>
                  </fieldset>
                )}
                <label className="signup-consent">
                  <input type="checkbox" required disabled={busy} />{' '}
                  <span>
                    Acepto crear un negocio de prueba con estos datos y usar Stripe TEST o QR
                    simulado, sin dinero real.{' '}
                    {plan === 'demo'
                      ? 'La Demo dura 10 días.'
                      : `El período elegido cuesta ${money(price)}.`}
                  </span>
                </label>
                <button className="sh-button sh-button-primary" type="submit" disabled={busy}>
                  {busy
                    ? 'Preparando tu negocio…'
                    : plan === 'demo'
                      ? 'Crear Demo gratuita'
                      : 'Continuar al pago seguro'}
                  <ArrowRight size={17} />
                </button>
                {access && (
                  <button
                    type="button"
                    className="signup-recover"
                    disabled={busy}
                    onClick={() => void refresh(true)}
                  >
                    Recuperar estado de mi solicitud
                  </button>
                )}
              </form>
            </>
          )}
        </section>
      </main>
      <footer className="signup-footer">
        Lúmina · Tecnología para tu negocio de moda{' '}
        <a href="/?tienda=lumina">Visitar tienda de demostración</a>
      </footer>
    </div>
  );
}
