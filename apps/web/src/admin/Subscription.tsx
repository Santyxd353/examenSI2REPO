import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Check, CalendarDays, Building2 } from 'lucide-react';
import {
  EntitlementsSchema,
  PLAN_CATALOG,
  SubscriptionCheckoutViewSchema,
  type Entitlements,
  type PlanCode,
  type SubscriptionCheckoutView,
} from '@lumina/contracts';
import { api } from '../api';
import './subscription.css';
const money = (minor: number, currency = 'USD') =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency }).format(minor / 100);
const date = (stamp: string) =>
  new Date(stamp).toLocaleString('es-BO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/La_Paz',
  });
const labels = {
  ACTIVE: 'Activo',
  TRIAL: 'Período de prueba',
  EXPIRED: 'Vencido',
  SUSPENDED: 'Suspendido',
};
function Usage({
  label,
  used,
  limit,
  detail,
}: {
  label: string;
  used: number;
  limit: number;
  detail?: string;
}) {
  const unlimited = limit === Number.MAX_SAFE_INTEGER;
  return (
    <article className="subscription-usage">
      <span>{label}</span>
      <strong>
        {used.toLocaleString('es-BO')}{' '}
        <small>/ {unlimited ? 'Sin cuota comercial' : limit.toLocaleString('es-BO')}</small>
      </strong>
      {!unlimited && (
        <progress
          max={Math.max(1, limit)}
          value={Math.min(used, Math.max(1, limit))}
          aria-label={label}
        />
      )}
      <small>{limit === 0 ? 'No incluido en tu plan' : detail || 'Capacidad de tu tienda'}</small>
    </article>
  );
}
export function SubscriptionPanel() {
  const [chosen, setChosen] = useState<PlanCode | null>(null),
    [accepted, setAccepted] = useState(false),
    [checkout, setCheckout] = useState<SubscriptionCheckoutView | null>(null),
    [paying, setPaying] = useState(false),
    [notice, setNotice] = useState('');
  const intentKey = useRef<{ planCode: PlanCode; provider: string; operationId: string } | null>(
    null,
  );
  const active = useRef(true);
  const [data, setData] = useState<Entitlements | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const [subscription, recent] = await Promise.all([
        api('/tenant/subscription'),
        api('/tenant/subscription/checkouts'),
      ]);
      const checked = EntitlementsSchema.safeParse(subscription);
      if (!checked.success)
        throw new Error(
          'No se pudo interpretar el estado del plan. Actualiza e intenta nuevamente.',
        );
      if (!active.current) return;
      setData(checked.data);
      const returnedId = new URLSearchParams(window.location.search).get('checkout');
      const candidate =
        recent.items.find((item: SubscriptionCheckoutView) => item.id === returnedId) ||
        recent.items[0];
      if (candidate) setCheckout(SubscriptionCheckoutViewSchema.parse(candidate));
    } catch (failure) {
      setError(
        failure instanceof TypeError
          ? 'Necesitas conexión para actualizar la vigencia y el consumo del plan.'
          : (failure as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
    };
  }, []);
  async function pay(provider: 'STRIPE_TEST' | 'QR_SIMULATED', retry = false) {
    const planCode = retry ? checkout?.planCode : chosen;
    if (!planCode || (!accepted && !retry)) return;
    if (retry && checkout)
      intentKey.current = { planCode, provider, operationId: checkout.operationId };
    if (
      !intentKey.current ||
      intentKey.current.planCode !== planCode ||
      intentKey.current.provider !== provider
    )
      intentKey.current = { planCode, provider, operationId: crypto.randomUUID() };
    setPaying(true);
    setError('');
    setNotice('');
    try {
      const result = SubscriptionCheckoutViewSchema.parse(
        await api('/tenant/subscription/checkout', {
          method: 'POST',
          body: JSON.stringify({ ...intentKey.current, acceptCycleTerms: true }),
        }),
      );
      if (active.current) {
        setCheckout(result);
        setChosen(null);
        setAccepted(false);
      }
    } catch (failure) {
      if (active.current) {
        setError(
          failure instanceof TypeError
            ? 'Se perdió la conexión. Actualiza para recuperar la intención antes de reintentar.'
            : (failure as Error).message,
        );
      }
    } finally {
      if (active.current) setPaying(false);
    }
  }
  async function confirmQr() {
    if (!checkout) return;
    setPaying(true);
    setError('');
    try {
      const result = SubscriptionCheckoutViewSchema.parse(
        await api(`/tenant/subscription/qr/${checkout.id}/confirm`, {
          method: 'POST',
          body: JSON.stringify({ simulatedPayment: true }),
        }),
      );
      if (active.current) {
        setCheckout(result);
        setNotice('Suscripción confirmada mediante simulación académica.');
        await load();
      }
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof TypeError
            ? 'Se perdió la respuesta. Actualiza el estado; la confirmación no se repetirá.'
            : (failure as Error).message,
        );
    } finally {
      if (active.current) setPaying(false);
    }
  }
  const cancelKey = useRef<string | null>(null);
  async function cancel() {
    cancelKey.current ??= crypto.randomUUID();
    setPaying(true);
    setError('');
    try {
      await api('/tenant/subscription/cancel-renewal', {
        method: 'POST',
        body: JSON.stringify({ operationId: cancelKey.current }),
      });
      cancelKey.current = null;
      await load();
    } catch (failure) {
      if (active.current) setError((failure as Error).message);
    } finally {
      if (active.current) setPaying(false);
    }
  }
  const pending = checkout && ['INITIALIZING', 'PENDING'].includes(checkout.status);
  return (
    <section className="subscription-panel">
      <div className="saas-heading">
        <div>
          <span className="eyebrow">TU ESPACIO LÚMINA</span>
          <h1>Mi negocio y plan</h1>
          <p>Consulta la vigencia, las capacidades y el consumo de tu tienda.</p>
        </div>
        <button className="saas-secondary" disabled={loading} onClick={() => void load()}>
          <RefreshCw size={16} /> {loading ? 'Actualizando…' : 'Actualizar plan'}
        </button>
      </div>
      {error && (
        <p className="saas-alert" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p role="status">Consultando el plan…</p>}
      {notice && (
        <p role="status" className="saas-alert">
          {notice}
        </p>
      )}
      {checkout && (
        <section
          className="saas-surface subscription-payment"
          aria-label="Estado de suscripción solicitada"
        >
          <h2>
            {checkout.simulated
              ? 'QR simulado · demostración académica'
              : 'Stripe TEST · demostración académica'}
          </h2>
          <p>
            {PLAN_CATALOG[checkout.planCode].name} ·{' '}
            <strong>{money(checkout.amountMinor, checkout.currency)}</strong>
          </p>
          <p className="billing-reference">Referencia: {checkout.id}</p>
          <p>
            Estado:{' '}
            <strong>
              {
                {
                  PENDING: 'Pendiente de confirmación',
                  INITIALIZING: 'Preparación pendiente',
                  APPLIED: 'Confirmado',
                  STALE: 'Requiere revisión; no aplicado',
                  EXPIRED: 'Intención vencida',
                }[checkout.status]
              }
            </strong>
          </p>
          {pending && (
            <p>
              Vigente hasta {date(checkout.expiresAt)}. Volver a esta página no confirma un pago.
            </p>
          )}
          {checkout.status === 'PENDING' && checkout.simulated && (
            <>
              <p>
                Este QR no realiza transferencias bancarias. La confirmación es una simulación
                autorizada para el proyecto.
              </p>
              <img
                src={checkout.qrDataUrl}
                width="280"
                height="280"
                alt="QR de simulación académica"
              />
              <button className="saas-primary" disabled={paying} onClick={() => void confirmQr()}>
                Confirmar pago simulado
              </button>
            </>
          )}
          {checkout.status === 'PENDING' && checkout.checkoutUrl && (
            <a
              className="saas-primary"
              href={checkout.checkoutUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir Stripe TEST
            </a>
          )}
          {checkout.status === 'INITIALIZING' && (
            <button
              className="saas-secondary"
              disabled={paying}
              onClick={() => void pay('STRIPE_TEST', true)}
            >
              Reintentar preparación Stripe
            </button>
          )}
          {checkout.result && <p>Acceso pagado hasta {date(checkout.result.paidThrough)}.</p>}
          <button
            className="saas-secondary"
            disabled={loading || paying}
            onClick={() => void load()}
          >
            Consultar estado del pago
          </button>
        </section>
      )}
      {data && (
        <>
          <div className="subscription-current saas-surface">
            <div className="saas-icon">
              <Building2 size={24} />
            </div>
            <div>
              <span className="saas-state">{labels[data.status]}</span>
              <h2>
                {data.legacyPilot ? 'Espacio inicial de Lúmina' : PLAN_CATALOG[data.planCode].name}
              </h2>
              <p>
                {data.legacyPilot ? (
                  <strong>Sin cobro comercial</strong>
                ) : (
                  <>
                    <strong>
                      {PLAN_CATALOG[data.planCode].contactSales
                        ? 'Precio a medida'
                        : money(data.priceMinor, data.currency)}
                    </strong>
                    {!PLAN_CATALOG[data.planCode].contactSales && ' / mes por tienda'}
                  </>
                )}
              </p>
              {data.legacyPilot && (
                <p>
                  Tu espacio anterior conserva sus datos. Los planes de suscripción se muestran
                  abajo.
                </p>
              )}
              {data.readOnly && (
                <p className="saas-alert">
                  Puedes consultar tus datos. Renueva el plan para volver a guardar cambios.
                </p>
              )}
              <p className="subscription-dates">
                <CalendarDays size={16} /> {date(data.periodFrom)} — {date(data.periodTo)}{' '}
                <small>(hora de Bolivia)</small>
              </p>
              {data.cancelAtPeriodEnd && (
                <p>
                  La renovación está cancelada. El acceso se mantiene hasta{' '}
                  {date(data.paidThrough || data.periodTo)}.
                </p>
              )}
              {!data.cancelAtPeriodEnd && !data.legacyPilot && (
                <button
                  className="saas-secondary"
                  disabled={paying || loading}
                  onClick={() => void cancel()}
                >
                  Cancelar renovación al vencer
                </button>
              )}
            </div>
          </div>
          <div className="saas-section-heading">
            <h2>Consumo del período</h2>
            <span>El equipo incluye a la propietaria; las compradoras no ocupan plazas.</span>
          </div>
          <div className="subscription-usage-grid">
            <Usage label="Ubicaciones" used={data.usage.locations} limit={data.limits.locations} />
            <Usage
              label="Integrantes del equipo"
              used={data.usage.staff}
              limit={data.limits.staff}
            />
            <Usage
              label="Productos registrados"
              used={data.usage.products}
              limit={data.limits.products}
              detail="Incluye productos archivados"
            />
            <Usage
              label="Generaciones de avatar"
              used={data.usage.avatarsCommitted + data.usage.avatarsReserved}
              limit={data.limits.avatarsPerPeriod}
              detail={`${data.usage.avatarsCommitted} terminadas · ${data.usage.avatarsReserved} en proceso`}
            />
            <Usage
              label="Reportes guardados"
              used={data.usage.savedReports}
              limit={data.limits.savedReports}
            />
            <Usage
              label="Solicitudes de IA"
              used={data.usage.aiCommitted + data.usage.aiReserved}
              limit={data.limits.aiPerPeriod}
              detail={`${data.usage.aiCommitted} confirmadas · ${data.usage.aiReserved} en proceso`}
            />
          </div>
        </>
      )}
      <div className="saas-section-heading">
        <h2>Planes disponibles</h2>
        <span>Precios en dólares estadounidenses por tienda y por mes.</span>
      </div>
      {chosen && !PLAN_CATALOG[chosen].contactSales && !pending && (
        <section className="saas-surface subscription-payment" aria-label="Condiciones del ciclo">
          <h2>
            {PLAN_CATALOG[chosen].name} · {money(PLAN_CATALOG[chosen].priceMinor)}
          </h2>
          <p>
            La activación o el cambio de plan inicia un mes completo al confirmar, sin prorrateo ni
            devolución automática del período anterior. Renovar el mismo plan antes del vencimiento
            agrega un mes al acceso pagado y conserva las cuotas del mes actual.
          </p>
          <p>
            Esta entrega usa pagos de prueba y renovación manual. No se realizan cargos automáticos.
          </p>
          <label className="billing-consent">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />
            Acepto el ciclo completo y las condiciones indicadas.
          </label>
          <div className="billing-actions">
            <button
              className="saas-primary"
              disabled={!accepted || paying}
              onClick={() => void pay('QR_SIMULATED')}
            >
              Generar QR simulado
            </button>
            <button
              className="saas-secondary"
              disabled={!accepted || paying}
              onClick={() => void pay('STRIPE_TEST')}
            >
              Preparar Stripe TEST
            </button>
          </div>
        </section>
      )}
      <div className="subscription-plans">
        {Object.values(PLAN_CATALOG).map((plan) => (
          <article
            key={plan.code}
            className={
              'saas-surface subscription-plan-card ' +
              (data && !data.legacyPilot && data.planCode === plan.code ? 'current-plan-card' : '')
            }
          >
            <span className="eyebrow">
              {data && !data.legacyPilot && data.planCode === plan.code
                ? 'TU PLAN'
                : 'LÚMINA PARA TU NEGOCIO'}
            </span>
            <h3>{plan.name}</h3>
            <p className="subscription-price">
              {plan.contactSales ? 'A medida' : money(plan.priceMinor)}
              {!plan.contactSales && <small>/ mes</small>}
            </p>
            <ul>
              {[
                `${plan.limits.locations} ubicaciones`,
                `${plan.limits.staff} integrantes del equipo`,
                `${plan.limits.products.toLocaleString('es-BO')} productos`,
                `${plan.limits.avatarsPerPeriod} generaciones de avatar por período`,
                `${plan.limits.savedReports} reportes guardados`,
                'Catálogo e inventario offline',
                'Hasta 10 prendas offline por clienta',
                plan.features.aiReports
                  ? `${plan.limits.aiPerPeriod} solicitudes de reportes por IA`
                  : 'Reportes y filtros manuales',
                ...(plan.features.demand ? ['Demostración de demanda y reposición con ML'] : []),
                ...(plan.features.anomalies ? ['Anomalías y análisis entre ubicaciones'] : []),
              ].map((line) => (
                <li key={line}>
                  <Check size={16} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <button
              className="saas-secondary"
              disabled={plan.contactSales || !data || loading || paying || Boolean(pending)}
              onClick={() => {
                setChosen(plan.code);
                setAccepted(false);
                intentKey.current = null;
                setError('');
              }}
            >
              Elegir {plan.name}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
