import type { Identity } from '../types';

export type MobileBusinessModule =
  | 'home'
  | 'catalog'
  | 'inventory'
  | 'sales-orders'
  | 'team'
  | 'locations'
  | 'reports-analysis'
  | 'sync'
  | 'business';

export type ModuleDefinition = Readonly<{
  id: MobileBusinessModule;
  label: string;
  permission: string;
  description: string;
}>;

export const mobileBusinessModules: readonly ModuleDefinition[] = [
  { id: 'home', label: 'Inicio', permission: '', description: 'Indicadores y actividad reciente' },
  { id: 'catalog', label: 'Catálogo', permission: 'catalogo:gestionar', description: 'Prendas y variantes' },
  { id: 'inventory', label: 'Inventario', permission: 'inventario:consultar', description: 'Existencias y movimientos' },
  { id: 'sales-orders', label: 'Ventas y pedidos', permission: 'ventas:registrar', description: 'Mostrador y pedidos' },
  { id: 'team', label: 'Equipo', permission: 'usuarios:gestionar', description: 'Personal y permisos' },
  { id: 'locations', label: 'Ubicaciones', permission: 'ubicaciones:gestionar', description: 'Sucursales y almacenes' },
  { id: 'reports-analysis', label: 'Reportes', permission: 'reportes:consultar', description: 'Reportes y análisis' },
  { id: 'sync', label: 'Sincronización', permission: 'inventario:consultar', description: 'Pendientes y conflictos' },
  { id: 'business', label: 'Mi negocio', permission: 'usuarios:gestionar', description: 'Tienda y plan' },
] as const;

export function modulesForIdentity(identity: Identity): ModuleDefinition[] {
  const grants = new Set(identity.permissions);
  return mobileBusinessModules.filter((module) => !module.permission || grants.has(module.permission));
}
