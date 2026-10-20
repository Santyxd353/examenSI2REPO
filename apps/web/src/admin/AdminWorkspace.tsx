import { useEffect, useState } from 'react';
import {
  Home,
  Shirt,
  Boxes,
  Building2,
  Users,
  ShoppingBag,
  ClipboardList,
  BarChart3,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Admin } from '../Admin';
import { Reports } from '../Reports';
import { Sales } from '../Sales';
import { OrdersAdmin } from '../OrdersAdmin';
import { api } from '../api';
import { businessModules, BusinessModule, TenantInfo } from './modules';
import { BusinessOverview } from './BusinessOverview';
import './workspace.css';

const icons = {
  home: Home,
  catalog: Shirt,
  inventory: Boxes,
  locations: Building2,
  team: Users,
  sales: ShoppingBag,
  orders: ClipboardList,
  reports: BarChart3,
  business: Settings,
};

export function AdminWorkspace({
  products,
  categories,
  permissions,
  onCatalogChanged,
}: Parameters<typeof Admin>[0]) {
  const [selected, setSelected] = useState<BusinessModule>('home');
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const allowed = businessModules.filter(
    (module) => !module.permission || permissions.includes(module.permission),
  );
  useEffect(() => {
    void api('/tenant')
      .then(setTenant)
      .catch((reason) => setError(reason.message));
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  const open = (module: BusinessModule) => {
    if (allowed.some((item) => item.id === module)) setSelected(module);
  };
  return (
    <div className="business-workspace">
      <aside className="business-sidebar" aria-label="Módulos administrativos">
        <div className="business-sidebar-title">
          <span>MI ESPACIO</span>
          <strong>{tenant?.name || 'Administración'}</strong>
          <small>{tenant?.subscription.planName || 'Cargando plan…'}</small>
        </div>
        <nav>
          {allowed.map((module) => {
            const Icon = icons[module.id];
            return (
              <button
                key={module.id}
                className={selected === module.id ? 'active' : ''}
                aria-current={selected === module.id ? 'page' : undefined}
                onClick={() => open(module.id)}
              >
                <Icon size={18} />
                <span>{module.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="business-content">
        <div className="business-context">
          <span>{tenant?.name || 'Mi tienda'}</span>
          <span className={online ? 'connected' : 'disconnected'}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? 'Con conexión' : 'Sin conexión'}
          </span>
        </div>
        {error && <div className="message error">{error}</div>}
        {tenant?.readOnly && (
          <div className="message">
            Tu suscripción necesita renovación. Puedes consultar tus datos; las nuevas
            modificaciones requieren un plan activo.
          </div>
        )}
        {selected === 'home' ? (
          <BusinessOverview permissions={permissions} tenant={tenant} onOpen={open} />
        ) : ['catalog', 'inventory', 'locations', 'team'].includes(selected) ? (
          <Admin
            key={selected}
            module={selected as 'catalog' | 'inventory' | 'locations' | 'team'}
            products={products}
            categories={categories}
            permissions={permissions}
            onCatalogChanged={onCatalogChanged}
          />
        ) : selected === 'reports' ? (
          <Reports />
        ) : selected === 'sales' ? (
          <Sales />
        ) : selected === 'orders' ? (
          <OrdersAdmin />
        ) : (
          <section className="business-plan">
            <span className="eyebrow">MI NEGOCIO Y SUSCRIPCIÓN</span>
            <h1>{tenant?.name || 'Mi negocio'}</h1>
            <p>
              Identificador de tienda: <strong>{tenant?.slug}</strong>
            </p>
            <dl>
              <dt>Plan</dt>
              <dd>{tenant?.subscription.planName}</dd>
              <dt>Estado</dt>
              <dd>
                {(
                  {
                    ACTIVE: 'Activo',
                    TRIALING: 'Período de prueba',
                    EXPIRED: 'Vencido',
                    PAST_DUE: 'Pago pendiente',
                    CANCELED: 'Cancelado',
                    SUSPENDED: 'Suspendido',
                  } as Record<string, string>
                )[tenant?.subscription.status || ''] || tenant?.subscription.status}
              </dd>
              <dt>Vigencia</dt>
              <dd>
                {tenant?.subscription.periodEnd
                  ? new Date(tenant.subscription.periodEnd).toLocaleDateString('es-BO')
                  : 'Sin vencimiento registrado'}
              </dd>
            </dl>
            <h2>Capacidad del plan</h2>
            {tenant?.subscription.plan === 'piloto' && (
              <p>El espacio inicial conserva sus datos sin cuotas comerciales.</p>
            )}
            <dl>
              {Object.entries(tenant?.subscription.limits || {}).map(([key, value]) => (
                <div key={key}>
                  <dt>
                    {(
                      {
                        locations: 'Ubicaciones',
                        staff: 'Personal',
                        products: 'Productos',
                      } as Record<string, string>
                    )[key] || key}
                  </dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
