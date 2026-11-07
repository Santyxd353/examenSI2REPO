export type TeamMember = {
  id: string;
  nombres: string;
  apellidos: string;
  correo: string;
  estado: 'ACTIVO' | 'SUSPENDIDO';
  version: number;
  rol: string;
  usuario_ubicacion: { ubicacion_id: string }[];
};
export type ManagedLocation = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
  direccion: string | null;
  padre_id: string | null;
  responsable_id: string | null;
  activa: boolean;
  version: number;
  responsable: Pick<TeamMember, 'id' | 'nombres' | 'apellidos' | 'estado'> | null;
  _count: { inventario: number; usuario_ubicacion: number };
};
export const permissionLabels: Record<string, string> = {
  'catalogo:gestionar': 'Gestionar prendas y recursos',
  'usuarios:gestionar': 'Gestionar equipo y permisos',
  'ubicaciones:gestionar': 'Gestionar todas las ubicaciones',
  'inventario:consultar': 'Consultar inventario',
  'inventario:gestionar': 'Ajustar, contar y transferir stock',
  'ventas:registrar': 'Registrar ventas',
  'pedidos:gestionar': 'Gestionar pedidos y devoluciones',
  'reportes:consultar': 'Consultar reportes',
  'modelos:gestionar': 'Gestionar modelos del vestidor',
  'suscripcion:gestionar': 'Gestionar suscripción',
  'analitica:entrenar': 'Preparar análisis de datos según el plan',
};
export type ManagementProps = { readOnly: boolean; online: boolean; limit?: number };
