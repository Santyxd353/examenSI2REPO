export type BusinessModule =
  | 'home'
  | 'catalog'
  | 'inventory'
  | 'locations'
  | 'team'
  | 'sales'
  | 'orders'
  | 'reports'
  | 'business';
export const businessModules: {
  id: BusinessModule;
  label: string;
  permission: string;
  description: string;
}[] = [
  { id: 'home', label: 'Inicio', permission: '', description: 'Indicadores y actividad reciente' },
  {
    id: 'catalog',
    label: 'Catálogo y vestidor',
    permission: 'catalogo:gestionar',
    description: 'Prendas, variantes y recursos',
  },
  {
    id: 'inventory',
    label: 'Inventario',
    permission: 'inventario:consultar',
    description: 'Existencias y movimientos',
  },
  {
    id: 'locations',
    label: 'Sucursales y almacenes',
    permission: 'ubicaciones:gestionar',
    description: 'Ubicaciones del negocio',
  },
  { id: 'sales', label: 'Vender', permission: 'ventas:registrar', description: 'Punto de venta' },
  {
    id: 'orders',
    label: 'Pedidos y devoluciones',
    permission: 'pedidos:gestionar',
    description: 'Compras y entregas',
  },
  {
    id: 'team',
    label: 'Equipo y permisos',
    permission: 'usuarios:gestionar',
    description: 'Personal y asignaciones',
  },
  {
    id: 'reports',
    label: 'Reportes y análisis',
    permission: 'reportes:consultar',
    description: 'Resultados comerciales',
  },
  {
    id: 'business',
    label: 'Mi negocio y plan',
    permission: 'usuarios:gestionar',
    description: 'Tienda y suscripción',
  },
];

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
  state: string;
  readOnly: boolean;
  subscription: {
    plan: string;
    planName: string;
    status: string;
    provider: string;
    periodEnd: string | null;
    limits: Record<string, number>;
    features: string[];
  };
};
