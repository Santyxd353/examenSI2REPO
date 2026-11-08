import type { Identity } from '../types';

export type MobileBusinessModule =
  | 'home'
  | 'catalog'
  | 'inventory'
  | 'sales-orders'
  | 'team'
  | 'locations'
  | 'reports-analysis'
  | 'analysis'
  | 'sync'
  | 'business';

export type ModuleDefinition = Readonly<{
  id: MobileBusinessModule;
  label: string;
  permission: string;
  alternatives?: readonly string[];
  description: string;
}>;

export const mobileBusinessModules: readonly ModuleDefinition[] = [
  { id: 'home', label: 'Inicio', permission: '', description: 'Indicadores y actividad reciente' },
  {
    id: 'catalog',
    label: 'Catálogo',
    permission: 'catalogo:gestionar',
    description: 'Prendas y variantes',
  },
  {
    id: 'inventory',
    label: 'Inventario',
    permission: 'inventario:consultar',
    description: 'Existencias y movimientos',
  },
  {
    id: 'sales-orders',
    label: 'Ventas y pedidos',
    permission: 'ventas:registrar',
    alternatives: ['pedidos:gestionar'],
    description: 'Mostrador y pedidos',
  },
  {
    id: 'team',
    label: 'Equipo',
    permission: 'usuarios:gestionar',
    description: 'Personal y permisos',
  },
  {
    id: 'locations',
    label: 'Ubicaciones',
    permission: 'ubicaciones:gestionar',
    description: 'Sucursales y almacenes',
  },
  {
    id: 'reports-analysis',
    label: 'Reportes',
    permission: 'reportes:consultar',
    description: 'Reportes y análisis',
  },
  {
    id: 'analysis',
    label: 'Análisis de datos',
    permission: 'reportes:consultar',
    description: 'Demanda, reposición y anomalías',
  },
  {
    id: 'sync',
    label: 'Sincronización',
    permission: 'inventario:consultar',
    description: 'Pendientes y conflictos',
  },
  {
    id: 'business',
    label: 'Mi negocio',
    permission: 'suscripcion:gestionar',
    description: 'Tienda y plan',
  },
] as const;

export function modulesForIdentity(identity: Identity): ModuleDefinition[] {
  const grants = new Set(identity.permissions);
  return mobileBusinessModules.filter(
    (module) =>
      !module.permission ||
      grants.has(module.permission) ||
      module.alternatives?.some((permission) => grants.has(permission)),
  );
}
export const canOpenSales = (identity: Pick<Identity, 'permissions'>) =>
  identity.permissions.includes('ventas:registrar');
export const canOpenOrders = (identity: Pick<Identity, 'permissions'>) =>
  identity.permissions.includes('pedidos:gestionar');

export function canUseBusinessWorkspace(identity: Identity) {
  return modulesForIdentity(identity).some((module) => module.id !== 'home');
}
export function activeBusinessModule(
  identity: Identity,
  module: MobileBusinessModule,
): MobileBusinessModule {
  return modulesForIdentity(identity).some((item) => item.id === module) ? module : 'home';
}
