import { ArrowUpRight, Building2, CircleCheck, Clock3, ShieldAlert } from 'lucide-react';
import { PLAN_CATALOG } from '@lumina/contracts';
import { platformDate, stateNames, type PlatformSummary } from './platform-model';

export function PlatformOverview({
  data,
  onInspect,
  onList,
}: {
  data: PlatformSummary;
  onInspect: (id: string) => void;
  onList: () => void;
}) {
  const c = data.counts;
  const metrics = [
    {
      label: 'Tiendas registradas',
      value: c.total,
      detail: `${c.new_this_month} creadas este mes`,
      icon: Building2,
    },
    {
      label: 'Suscripciones activas',
      value: c.active,
      detail: 'Incluye el espacio inicial activo',
      icon: CircleCheck,
    },
    { label: 'En período de prueba', value: c.trial, detail: 'Prueba vigente', icon: Clock3 },
    {
      label: 'Requieren atención',
      value: c.attention,
      detail: 'Vencidas, suspendidas o sin preparar',
      icon: ShieldAlert,
    },
  ];
  const maximum = Math.max(1, ...data.plans.map((p) => p.count));
  return (
    <section className="operator-overview" aria-label="Resumen global">
      <div className="operator-metrics">
        {metrics.map(({ label, value, detail, icon: Icon }) => (
          <article className="saas-surface operator-metric" key={label}>
            <div>
              <span>{label}</span>
              <Icon size={19} />
            </div>
            <strong>{value}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <div className="operator-overview-columns">
        <section className="saas-surface">
          <div className="saas-section-heading">
            <h2>Distribución por plan</h2>
            <span>{c.total} tiendas</span>
          </div>
          <div
            className="operator-plan-chart"
            role="img"
            aria-label={data.plans.map((p) => `${p.code}: ${p.count} tiendas`).join(', ')}
          >
            {data.plans.map((p) => (
              <div className="operator-plan-row" key={p.code}>
                <div>
                  <span>
                    {p.code === 'piloto'
                      ? 'Espacio inicial'
                      : PLAN_CATALOG[p.code as keyof typeof PLAN_CATALOG]?.name || p.code}
                  </span>
                  <strong>{p.count}</strong>
                </div>
                <div className="operator-bar">
                  <span style={{ width: (100 * p.count) / maximum + '%' }} />
                </div>
              </div>
            ))}
          </div>
          <p className="operator-caption">
            Cantidad de negocios registrados en cada plan. Los datos comerciales permanecen en sus
            tiendas.
          </p>
        </section>
        <section className="saas-surface">
          <h2>Estado de la plataforma</h2>
          <dl className="operator-status-list">
            {[
              ['Próximas a vencer (7 días)', c.expiring],
              ['Suscripciones vencidas', c.expired],
              ['Negocios suspendidos', c.suspended],
              ['Altas en preparación', c.provisioning],
              ['Preparación fallida', c.failed],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="operator-caption">
            Consultar el estado no renueva un plan ni modifica los datos de una tienda.
          </p>
        </section>
      </div>
      <section className="saas-surface">
        <div className="saas-section-heading">
          <h2>Últimos negocios</h2>
          <button className="operator-text-button" onClick={onList}>
            Ver todos <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="operator-recent">
          {data.recent.map((store) => (
            <button key={store.id} onClick={() => onInspect(store.id)}>
              <div>
                <strong>{store.name}</strong>
                <small>
                  {store.slug} · {platformDate(store.createdAt)}
                </small>
              </div>
              <span className="saas-state">{stateNames[store.state] || store.state}</span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      </section>
      {data.registrations.length > 0 && (
        <section className="saas-surface operator-attention">
          <h2>Registros públicos pendientes de preparación</h2>
          <p>
            Estos registros ya forman parte del avance de la plataforma y necesitan revisión
            técnica. Un pago registrado no debe repetirse.
          </p>
          {data.registrations.map((r) => (
            <div key={r.id}>
              <strong>{r.companyName}</strong>
              <span>
                {r.slug} · {r.state}
              </span>
              <code>{r.id}</code>
            </div>
          ))}
        </section>
      )}
      <p className="operator-caption">
        Última consulta: {platformDate(data.generatedAt)} · hora de Bolivia.
      </p>
    </section>
  );
}
