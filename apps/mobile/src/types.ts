export type Identity = {
  id: string;
  nombres: string;
  apellidos: string;
  correo: string;
  roles: string[];
  permissions: string[];
  tenant?: { id: string; slug: string; name: string };
};

export type CustomerAddress = {
  id: string;
  alias: string;
  destinatario: string;
  telefono: string;
  ciudad: string;
  zona: string;
  detalle: string;
  predeterminada: boolean;
  activa: boolean;
};

export type CustomerProfile = {
  id: string;
  nombres: string;
  apellidos: string;
  correo: string;
  telefono: string | null;
  preferencias: { push?: boolean };
  direccion: CustomerAddress[];
  identity: Identity;
};

export type LocationAvailability = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
  disponible: number;
};

export type Variant = {
  id: string;
  talla: string;
  color: string;
  color_hex?: string;
  precio: number;
  disponible: number;
  ubicaciones: LocationAvailability[];
  arImagePath?: string | null;
};

export type Product = {
  id: string;
  categoria_id: string;
  nombre: string;
  tipoPrenda?: string;
  descripcion: string;
  material: string;
  marca?: string | null;
  imagenes?: { url: string; textoAlternativo: string }[];
  variantes: Variant[];
};

export type CatalogLocation = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
};

export type Catalog = {
  products: Product[];
  locations: CatalogLocation[];
  filters: { brands: string[]; colors: string[]; sizes: string[] };
  categories: { id: string; nombre: string; descripcion?: string | null; activa: boolean }[];
};
