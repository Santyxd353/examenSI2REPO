import { useEffect, useState } from 'react';
import { RefreshCw, Check, CalendarDays, Building2 } from 'lucide-react';
import { EntitlementsSchema, PLAN_CATALOG, type Entitlements } from '@lumina/contracts';
import { api } from '../api';
import './subscription.css';
const money = (minor: number) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(minor / 100);
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
  const [data, setData] = useState<Entitlements | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const checked = EntitlementsSchema.safeParse(await api('/tenant/subscription'));
      if (!checked.success)
        throw new Error(
          'No se pudo interpretar el estado del plan. Actualiza e intenta nuevamente.',
        );
      setData(checked.data);
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
    void load();
  }, []);
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
                    <strong>{money(data.priceMinor)}</strong> / mes por tienda
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
        <span>Precios en bolivianos por tienda y por mes.</span>
      </div>
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
              {money(plan.priceMinor)}
              <small>/ mes</small>
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
          </article>
        ))}
      </div>
    </section>
  );
}
