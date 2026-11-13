import { useEffect, useState, lazy, Suspense } from 'react';
import {
  Home,
  Shirt,
  Boxes,
  Building2,
  Users,
  ShoppingBag,
  ClipboardList,
  BarChart3,
  BrainCircuit,
  Settings,
  Wifi,
  WifiOff,
  CloudUpload,
  Sparkles,
} from 'lucide-react';
import { Admin } from '../Admin';
import { ReportBuilder } from '../reporting/ReportBuilder';
import type { ReportIdentity } from '../reporting/report-data';
import { AnalyticsLab } from '../analytics/AnalyticsLab';
import { Sales } from '../Sales';
import { OrdersAdmin } from '../OrdersAdmin';
import { api } from '../api';
import { businessModules, BusinessModule, canUseModule, TenantInfo } from './modules';
import type { OfflineSession } from '../offline/scope';
import { BusinessOverview } from './BusinessOverview';
import './workspace.css';

const SubscriptionPanel = lazy(() =>
  import('./Subscription').then((module) => ({ default: module.SubscriptionPanel })),
);
const Team = lazy(() => import('./Team').then((module) => ({ default: module.Team })));
const Locations = lazy(() =>
  import('./Locations').then((module) => ({ default: module.Locations })),
);
const SyncWorkspace = lazy(() =>
  import('./SyncWorkspace').then((module) => ({ default: module.SyncWorkspace })),
);
const icons = {
  home: Home,
  catalog: Shirt,
  inventory: Boxes,
  locations: Building2,
  team: Users,
  sales: ShoppingBag,
  orders: ClipboardList,
  reports: BarChart3,
  'reports-ai': Sparkles,
  analysis: BrainCircuit,
  business: Settings,
  sync: CloudUpload,
};

export function AdminWorkspace({
  products,
  categories,
  permissions,
  onCatalogChanged,
  offlineSession,
  enableOffline,
  localName,
  reportIdentity,
}: Parameters<typeof Admin>[0] & {
  offlineSession: OfflineSession | null;
  enableOffline: (signal: AbortSignal) => Promise<OfflineSession>;
  localName?: string;
  reportIdentity?: ReportIdentity;
}) {
  const [selected, setSelected] = useState<BusinessModule>(() =>
    permissions.includes('suscripcion:gestionar') &&
    new URLSearchParams(window.location.search).has('checkout')
      ? 'business'
      : !navigator.onLine && offlineSession
        ? 'sync'
        : 'home',
  );
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const allowed = businessModules.filter((module) => canUseModule(module, permissions));
  useEffect(() => {
    if (!allowed.some((module) => module.id === selected)) setSelected('home');
  }, [permissions, selected]);
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  useEffect(() => {
    if (!online) return;
    let active = true;
    void api('/tenant')
      .then((value) => {
        if (active) {
          setTenant(value);
          setError('');
        }
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [online]);
  const open = (module: BusinessModule) => {
    if (allowed.some((item) => item.id === module)) setSelected(module);
  };
  return (
    <div className="business-workspace">
      <aside className="business-sidebar" aria-label="Módulos administrativos">
        <div className="business-sidebar-title">
          <span>MI ESPACIO</span>
          <strong>{tenant?.name || localName || 'Administración'}</strong>
          <small>
            {tenant?.subscription.planName || (online ? 'Cargando plan…' : 'Copia local')}
          </small>
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
          <span>{tenant?.name || localName || 'Mi tienda'}</span>
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
        ) : selected === 'team' || selected === 'locations' ? (
          <Suspense fallback={<p role="status">Abriendo módulo…</p>}>
            {selected === 'team' ? (
              <Team
                readOnly={tenant?.readOnly ?? true}
                online={online}
                limit={tenant?.subscription.limits.staff}
              />
            ) : (
              <Locations
                readOnly={tenant?.readOnly ?? true}
                online={online}
                limit={tenant?.subscription.limits.locations}
              />
            )}
          </Suspense>
        ) : selected === 'sync' ? (
          <Suspense fallback={<p role="status">Abriendo sincronización…</p>}>
            <SyncWorkspace
              session={offlineSession}
              online={online}
              permissions={permissions}
              enable={enableOffline}
            />
          </Suspense>
        ) : ['catalog', 'inventory'].includes(selected) ? (
          <Admin
            key={selected}
            module={selected as 'catalog' | 'inventory'}
            products={products}
            categories={categories}
            permissions={permissions}
            onCatalogChanged={onCatalogChanged}
          />
        ) : selected === 'analysis' ? (
          reportIdentity && (
            <AnalyticsLab
              key={reportIdentity.tenantId + ':' + reportIdentity.actorId}
              identity={reportIdentity}
              online={online}
              session={offlineSession}
              enableOffline={enableOffline}
              readOnly={tenant?.readOnly ?? true}
              features={tenant?.subscription.features ?? []}
              multiLocation={['negocio', 'piloto'].includes(tenant?.subscription.plan ?? '')}
            />
          )
        ) : selected === 'reports' || selected === 'reports-ai' ? (
          reportIdentity && (
            <ReportBuilder
              key={selected + ':' + reportIdentity.tenantId + ':' + reportIdentity.actorId}
              mode={selected === 'reports-ai' ? 'assistant' : 'parameters'}
              identity={reportIdentity}
              online={online}
              session={offlineSession}
              enableOffline={enableOffline}
              readOnly={tenant?.readOnly ?? true}
              aiEnabled={tenant?.subscription.features.includes('ai') ?? false}
            />
          )
        ) : selected === 'sales' ? (
          <Sales />
        ) : selected === 'orders' ? (
          <OrdersAdmin />
        ) : (
          <Suspense fallback={<p role="status">Consultando tu plan…</p>}>
            <SubscriptionPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
