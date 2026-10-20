import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { BusinessModule, businessModules, TenantInfo } from './modules';

const money = (value: number | string) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(Number(value));
type Summary = {
  kpis: { ventas: number; pedidos: number; unidades: number; ticketPromedio: number };
  summary: string;
};
type Order = {
  id: string;
  numero: string;
  canal: string;
  estado: string;
  total: string;
  creado_en: string;
};

export function BusinessOverview({
  permissions,
  tenant,
  onOpen,
}: {
  permissions: string[];
  tenant: TenantInfo | null;
  onOpen: (module: BusinessModule) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const from = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
      const to = new Date().toISOString().slice(0, 10);
      const [report, recent] = await Promise.all([
        permissions.includes('reportes:consultar')
          ? api(`/reports/summary?from=${from}&to=${to}`)
          : null,
        permissions.includes('pedidos:gestionar') ? api('/admin/orders') : [],
      ]);
      setSummary(report);
      setOrders(recent.slice(0, 5));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="business-overview">
      <div className="business-page-heading">
        <div>
          <span className="eyebrow">TU NEGOCIO, EN UN SOLO LUGAR</span>
          <h1>{tenant?.name || 'Mi negocio'}</h1>
          <p>Revisa tus resultados y abre el módulo que necesitas.</p>
        </div>
        <button className="business-refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} /> {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
      {error && <div className="message error">{error}</div>}
      {summary && (
        <>
          <div className="business-kpis">
            {[
              { name: 'Ventas confirmadas', value: money(summary.kpis.ventas) },
              { name: 'Pedidos', value: summary.kpis.pedidos },
              { name: 'Unidades', value: summary.kpis.unidades },
              { name: 'Ticket promedio', value: money(summary.kpis.ticketPromedio) },
            ].map((item) => (
              <article key={item.name}>
                <span>{item.name}</span>
                <strong>{item.value}</strong>
                <small>Últimos 90 días</small>
              </article>
            ))}
          </div>
          <p className="business-summary">{summary.summary}</p>
        </>
      )}
      <div className="business-module-grid">
        {businessModules
          .filter((module) => module.id !== 'home' && permissions.includes(module.permission))
          .map((module) => (
            <button key={module.id} onClick={() => onOpen(module.id)}>
              <ArrowUpRight size={20} />
              <strong>{module.label}</strong>
              <span>{module.description}</span>
            </button>
          ))}
      </div>
      {permissions.includes('pedidos:gestionar') && (
        <div className="business-recent">
          <div className="business-page-heading">
            <h2>Últimos pedidos</h2>
            <button onClick={() => onOpen('orders')}>
              Ver todos <ArrowUpRight size={16} />
            </button>
          </div>
          {!orders.length && <p>Aún no se han registrado pedidos en esta tienda.</p>}
          {orders.map((order) => (
            <article key={order.id}>
              <div>
                <strong>{order.numero}</strong>
                <small>
                  {new Date(order.creado_en).toLocaleString('es-BO')} · {order.canal}
                </small>
              </div>
              <span>{order.estado.replaceAll('_', ' ')}</span>
              <b>{money(order.total)}</b>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
