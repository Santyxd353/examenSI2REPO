import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Building2,
  History,
  ImagePlus,
  PackagePlus,
  Pencil,
  Power,
  Shirt,
  UserCog,
  UserPlus,
} from 'lucide-react';
import { api } from './api';

type Location = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
  direccion?: string;
  activa: boolean;
  _count: { inventario: number; usuario_ubicacion: number };
  usuario_ubicacion: { usuario: { id: string; nombres: string; apellidos: string } }[];
};
type Staff = {
  id: string;
  nombres: string;
  apellidos: string;
  correo: string;
  estado: string;
  usuario_rol: { rol: { nombre: string } }[];
  usuario_ubicacion: { ubicacion_id: string }[];
};
type Product = {
  id: string;
  nombre: string;
  marca?: string | null;
  variantes: { id: string; talla: string; color: string }[];
};
type Category = { id: string; nombre: string };
type NewVariant = { talla: string; color: string; colorHex: string };
type Movement = {
  id: string;
  tipo: string;
  deltaFisico: number;
  conteoObservado?: number;
  motivo: string;
  creadoEn: string;
  actor: { nombres: string; apellidos: string };
  variante: { sku: string; talla: string; color: string; producto: { nombre: string } };
  contraparte?: { nombre: string };
};
type InventoryRow = {
  id: string;
  variante_id: string;
  version: number;
  fisico: number;
  reservado: number;
  comprometido: number;
  disponible: number;
  stockSeguridad: number;
  plazoReposicionDias: number;
  alertaStock: boolean;
  variante: { sku: string; talla: string; color: string; producto: { nombre: string } };
};
type StockAlert = {
  ubicacion_id: string;
  ubicacion: string;
  variante_id: string;
  producto: string;
  sku: string;
  talla: string;
  color: string;
  disponible: number;
  stock_seguridad: number;
};
type ArResource = {
  id: string;
  varianteId: string;
  producto: string;
  talla: string;
  color: string;
  estado: 'BORRADOR' | 'PUBLICADO';
  textoAlternativo: string;
  licencia: string;
  imagePath: string;
};

export function Admin({
  products,
  categories,
  permissions,
  onCatalogChanged,
  module = 'all',
}: {
  products: Product[];
  categories: Category[];
  permissions: string[];
  onCatalogChanged: () => Promise<void>;
  module?: 'all' | 'catalog' | 'inventory' | 'locations' | 'team';
}) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [historyLocation, setHistoryLocation] = useState<Location | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [staffLocations, setStaffLocations] = useState<string[]>([]);
  const [alerts, setAlerts] = useState<StockAlert[]>([]);
  const [inventoryLocation, setInventoryLocation] = useState<Location | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [countingRow, setCountingRow] = useState<InventoryRow | null>(null);
  const [thresholdRow, setThresholdRow] = useState<InventoryRow | null>(null);
  const [arResources, setArResources] = useState<ArResource[]>([]);
  const [newVariants, setNewVariants] = useState<NewVariant[]>([
    { talla: 'M', color: '', colorHex: '#c9b8a7' },
  ]);
  const [brandChoice, setBrandChoice] = useState('__new__');
  const [typeChoice, setTypeChoice] = useState('__new__');
  const managesLocations =
    permissions.includes('ubicaciones:gestionar') && ['all', 'locations'].includes(module);
  const managesUsers =
    permissions.includes('usuarios:gestionar') && ['all', 'team'].includes(module);
  const managesInventory =
    permissions.includes('inventario:gestionar') && ['all', 'inventory'].includes(module);
  const managesCatalog =
    permissions.includes('catalogo:gestionar') && ['all', 'catalog'].includes(module);
  const variants = useMemo(
    () =>
      products.flatMap((product) =>
        product.variantes.map((variant) => ({ ...variant, producto: product.nombre })),
      ),
    [products],
  );
  const brands = useMemo(
    () =>
      [
        ...new Set(
          products.map((product) => product.marca).filter((value): value is string => !!value),
        ),
      ].sort(),
    [products],
  );

  async function createGarment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const photos = (form.elements.namedItem('fotos') as HTMLInputElement).files;
    const body = new FormData();
    for (const name of ['nombre', 'descripcion', 'material', 'precio', 'licencia'])
      body.set(name, String(values.get(name) || ''));
    body.set(
      'marca',
      brandChoice === '__new__' ? String(values.get('nuevaMarca') || '') : brandChoice,
    );
    body.set(
      'tipoPrenda',
      typeChoice === '__new__' ? String(values.get('nuevoTipo') || '') : typeChoice,
    );
    body.set('variantes', JSON.stringify(newVariants));
    for (const photo of Array.from(photos || [])) body.append('fotos', photo);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const created = await api('/catalog/garments', { method: 'POST', body });
      form.reset();
      setBrandChoice('__new__');
      setTypeChoice('__new__');
      setNewVariants([{ talla: 'M', color: '', colorHex: '#c9b8a7' }]);
      await onCatalogChanged();
      await reload();
      if (inventoryLocation)
        setInventory(await api(`/locations/${inventoryLocation.id}/inventory`));
      setMessage(
        `${created.nombre} creada en ${created.ubicaciones} ubicaciones con stock inicial de cero. Ahora puedes agregar existencias por sucursal.`,
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    const [locationData, staffData, alertData, arData] = await Promise.all([
      (managesLocations || managesUsers || ['all', 'inventory'].includes(module)) &&
      (permissions.includes('inventario:consultar') ||
        permissions.includes('ubicaciones:gestionar'))
        ? api('/locations')
        : Promise.resolve([]),
      managesUsers ? api('/staff') : Promise.resolve([]),
      ['all', 'inventory'].includes(module) && permissions.includes('inventario:consultar')
        ? api('/locations/inventory/alerts')
        : Promise.resolve([]),
      managesCatalog ? api('/catalog/ar-resources') : Promise.resolve([]),
    ]);
    setLocations(locationData);
    setStaff(staffData);
    setAlerts(alertData);
    setArResources(arData);
  }

  async function uploadArImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/catalog/ar-resources', { method: 'POST', body: new FormData(form) });
      form.reset();
      setArResources(await api('/catalog/ar-resources'));
      setMessage('Imagen AR cargada como borrador. Revísala y publícala para mostrarla en la app.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setArImageStatus(resource: ArResource) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const estado = resource.estado === 'PUBLICADO' ? 'BORRADOR' : 'PUBLICADO';
      await api(`/catalog/ar-resources/${resource.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado }),
      });
      setArResources(await api('/catalog/ar-resources'));
      setMessage(
        estado === 'PUBLICADO'
          ? 'Imagen AR publicada en el catálogo.'
          : 'Imagen AR retirada del catálogo.',
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function showInventory(location: Location) {
    setError('');
    try {
      setInventory(await api(`/locations/${location.id}/inventory`));
      setInventoryLocation(location);
      setCountingRow(null);
      setThresholdRow(null);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function showHistory(location: Location) {
    setError('');
    try {
      setMovements(await api(`/locations/${location.id}/movements`));
      setHistoryLocation(location);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason.message));
  }, []);

  async function submit(
    path: string,
    form: HTMLFormElement,
    transform?: (data: Record<string, string>) => unknown,
  ) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const values = Object.fromEntries(new FormData(form)) as Record<string, string>;
      await api(path, {
        method: 'POST',
        body: JSON.stringify(transform ? transform(values) : values),
      });
      form.reset();
      await reload();
      await onCatalogChanged();
      if (inventoryLocation)
        setInventory(await api(`/locations/${inventoryLocation.id}/inventory`));
      setMessage('Cambios guardados correctamente.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingLocation) return;
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<
        string,
        string
      >;
      await api(`/locations/${editingLocation.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: values.nombre,
          tipo: values.tipo,
          direccion: values.direccion,
        }),
      });
      setEditingLocation(null);
      await reload();
      setMessage('Ubicación actualizada correctamente.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(location: Location) {
    if (
      !window.confirm(
        `¿Desactivar ${location.nombre}? El historial se conservará y dejará de aparecer en el catálogo.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`/locations/${location.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activa: false }),
      });
      await reload();
      setMessage('Ubicación desactivada. Su historial se conserva.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function editAssignments(person: Staff) {
    setEditingStaff(person);
    setStaffLocations(person.usuario_ubicacion.map((assignment) => assignment.ubicacion_id));
  }

  async function saveAssignments() {
    if (!editingStaff) return;
    setBusy(true);
    setError('');
    try {
      const previous = new Set(
        editingStaff.usuario_ubicacion.map((assignment) => assignment.ubicacion_id),
      );
      const next = new Set(staffLocations);
      await Promise.all([
        ...[...next]
          .filter((locationId) => !previous.has(locationId))
          .map((locationId) =>
            api(`/locations/${locationId}/assignments`, {
              method: 'POST',
              body: JSON.stringify({ usuarioId: editingStaff.id }),
            }),
          ),
        ...[...previous]
          .filter((locationId) => !next.has(locationId))
          .map((locationId) =>
            api(`/locations/${locationId}/assignments/${editingStaff.id}`, {
              method: 'DELETE',
            }),
          ),
      ]);
      setEditingStaff(null);
      await reload();
      setMessage('Asignaciones actualizadas correctamente.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inventoryLocation || !countingRow) return;
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<
        string,
        string
      >;
      await api(`/locations/${inventoryLocation.id}/inventory/counts`, {
        method: 'POST',
        body: JSON.stringify({
          varianteId: countingRow.variante_id,
          conteoObservado: Number(values.conteoObservado),
          expectedVersion: countingRow.version,
          motivo: values.motivo,
        }),
      });
      setInventory(await api(`/locations/${inventoryLocation.id}/inventory`));
      setAlerts(await api('/locations/inventory/alerts'));
      setCountingRow(null);
      setMessage('Conteo conciliado y movimiento registrado.');
    } catch (reason) {
      setError((reason as Error).message);
      try {
        const latest: InventoryRow[] = await api(`/locations/${inventoryLocation.id}/inventory`);
        setInventory(latest);
        const current = latest.find((row) => row.id === countingRow.id);
        if (!current || current.version !== countingRow.version) {
          setCountingRow(null);
          setError(
            'El inventario cambió. Revisa el saldo actualizado y abre nuevamente el conteo para confirmarlo.',
          );
        }
      } catch {
        // Preserve the original error and the original version until a successful reload.
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveThreshold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inventoryLocation || !thresholdRow) return;
    setBusy(true);
    setError('');
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<
        string,
        string
      >;
      await api(
        `/locations/${inventoryLocation.id}/inventory/${thresholdRow.variante_id}/threshold`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            stockSeguridad: Number(values.stockSeguridad),
            plazoReposicionDias: Number(values.plazoReposicionDias),
          }),
        },
      );
      setInventory(await api(`/locations/${inventoryLocation.id}/inventory`));
      setAlerts(await api('/locations/inventory/alerts'));
      setThresholdRow(null);
      setMessage('Mínimo de stock actualizado.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-page">
      <div className="section-title">
        <span className="eyebrow">ADMINISTRACIÓN DEL NEGOCIO</span>
        <h1>
          {
            {
              all: 'Sucursales, almacenes y responsables',
              catalog: 'Catálogo y vestidor',
              inventory: 'Inventario y movimientos',
              locations: 'Sucursales y almacenes',
              team: 'Equipo y permisos',
            }[module]
          }
        </h1>
        <p>
          {
            {
              all: 'Organiza la operación de tu negocio.',
              catalog: 'Crea prendas, variantes y recursos para el vestidor.',
              inventory: 'Consulta existencias, registra ajustes y concilia tus conteos.',
              locations: 'Administra los espacios físicos de tu tienda.',
              team: 'Asigna responsables y controla su alcance por ubicación.',
            }[module]
          }
        </p>
      </div>
      {error && <div className="message error">{error}</div>}
      {message && <div className="message">{message}</div>}
      {['all', 'inventory'].includes(module) && alerts.length > 0 && (
        <div className="stock-alerts" role="status">
          <div>
            <span className="eyebrow">ATENCIÓN DE INVENTARIO</span>
            <h2>
              {alerts.length} {alerts.length === 1 ? 'alerta activa' : 'alertas activas'}
            </h2>
          </div>
          {alerts.slice(0, 6).map((alert) => (
            <button
              key={`${alert.ubicacion_id}-${alert.variante_id}`}
              onClick={() => {
                const location = locations.find((item) => item.id === alert.ubicacion_id);
                if (location) void showInventory(location);
              }}
            >
              <b>
                {alert.producto} · {alert.talla}
              </b>
              <span>
                {alert.ubicacion}: {alert.disponible} disponibles / mínimo {alert.stock_seguridad}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="admin-grid">
        {managesCatalog && (
          <form
            className="admin-card garment-create-card"
            onSubmit={(event) => void createGarment(event)}
          >
            <Shirt size={24} />
            <h2>Nueva prenda</h2>
            <p>
              La prenda se mostrará en todas las sucursales y almacenes. Las existencias se cargan
              después en cada ubicación. Estas fotos son para el catálogo; la imagen AR se
              administra aparte.
            </p>
            <label>
              Nombre de la prenda
              <input
                name="nombre"
                minLength={2}
                maxLength={160}
                required
                placeholder="Blusa de lino"
              />
            </label>
            <div className="two-fields">
              <label>
                Tipo de prenda
                <select value={typeChoice} onChange={(event) => setTypeChoice(event.target.value)}>
                  <option value="__new__">Crear nuevo tipo</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.nombre}>
                      {category.nombre}
                    </option>
                  ))}
                </select>
              </label>
              {typeChoice === '__new__' && (
                <label>
                  Nuevo tipo
                  <input
                    name="nuevoTipo"
                    required
                    minLength={2}
                    maxLength={80}
                    placeholder="Blusa"
                  />
                </label>
              )}
            </div>
            <div className="two-fields">
              <label>
                Marca
                <select
                  value={brandChoice}
                  onChange={(event) => setBrandChoice(event.target.value)}
                >
                  <option value="__new__">Crear nueva marca</option>
                  {brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </label>
              {brandChoice === '__new__' && (
                <label>
                  Nueva marca
                  <input
                    name="nuevaMarca"
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="Nombre de marca"
                  />
                </label>
              )}
            </div>
            <label>
              Material
              <input name="material" minLength={2} maxLength={150} required placeholder="Lino" />
            </label>
            <label>
              Descripción
              <textarea
                name="descripcion"
                minLength={10}
                maxLength={3000}
                required
                placeholder="Describe el corte y los detalles de la prenda"
              />
            </label>
            <label>
              Precio por variante (Bs)
              <input name="precio" type="number" min="0.01" max="1000000" step="0.01" required />
            </label>
            <h3>Tallas y colores</h3>
            {newVariants.map((variant, index) => (
              <div className="garment-variant-row" key={index}>
                <label>
                  Talla
                  <input
                    aria-label={`Talla ${index + 1}`}
                    value={variant.talla}
                    required
                    maxLength={20}
                    onChange={(event) =>
                      setNewVariants((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, talla: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Color
                  <input
                    aria-label={`Color ${index + 1}`}
                    value={variant.color}
                    required
                    maxLength={50}
                    onChange={(event) =>
                      setNewVariants((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, color: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Muestra
                  <input
                    aria-label={`Muestra de color ${index + 1}`}
                    type="color"
                    value={variant.colorHex}
                    onChange={(event) =>
                      setNewVariants((current) =>
                        current.map((item, i) =>
                          i === index ? { ...item, colorHex: event.target.value } : item,
                        ),
                      )
                    }
                  />
                </label>
                {newVariants.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setNewVariants((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={newVariants.length >= 30}
              onClick={() =>
                setNewVariants((current) => [
                  ...current,
                  { talla: 'M', color: '', colorHex: '#c9b8a7' },
                ])
              }
            >
              + Añadir talla y color
            </button>
            <label>
              Fotos de la prenda (1 a 8, PNG/JPEG/WebP, máximo 5 MB cada una)
              <input
                name="fotos"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                required
              />
            </label>
            <label>
              Licencia o autorización de las fotos
              <input
                name="licencia"
                minLength={3}
                maxLength={255}
                required
                placeholder="Fotografías propias"
              />
            </label>
            <button className="primary" disabled={busy}>
              Crear prenda
            </button>
          </form>
        )}
        {managesCatalog && (
          <form className="admin-card" onSubmit={(event) => void uploadArImage(event)}>
            <ImagePlus size={24} />
            <h2>Nueva imagen para prueba AR</h2>
            <p>
              Sube la imagen frontal de la prenda con fondo transparente. Se vincula a una talla y
              color específicos.
            </p>
            <label>
              Prenda y variante
              <select name="varianteId" required>
                <option value="">Seleccionar</option>
                {variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.producto} · {variant.talla} · {variant.color}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Imagen PNG transparente (256–2048 px, máximo 5 MB)
              <input name="imagen" type="file" accept="image/png" required />
            </label>
            <label>
              Descripción de la imagen
              <input
                name="textoAlternativo"
                minLength={5}
                maxLength={255}
                required
                placeholder="Blusa marfil vista de frente"
              />
            </label>
            <label>
              Licencia o autorización de uso
              <input
                name="licencia"
                minLength={3}
                maxLength={255}
                required
                placeholder="Fotografía propia"
              />
            </label>
            <button className="primary" disabled={busy || variants.length === 0}>
              Cargar borrador AR
            </button>
          </form>
        )}
        {managesLocations && (
          <form
            className="admin-card"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void submit('/locations', event.currentTarget);
            }}
          >
            <Building2 size={24} />
            <h2>Nueva ubicación</h2>
            <label>
              Nombre
              <input name="nombre" minLength={2} required />
            </label>
            <label>
              Tipo
              <select name="tipo">
                <option value="TIENDA">Sucursal</option>
                <option value="ALMACEN">Almacén</option>
              </select>
            </label>
            <label>
              Dirección
              <input name="direccion" minLength={5} required />
            </label>
            <button className="primary" disabled={busy}>
              Crear ubicación
            </button>
          </form>
        )}
        {managesUsers && (
          <form
            className="admin-card"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void submit('/staff', event.currentTarget, (values) => ({
                nombres: values.nombres,
                apellidos: values.apellidos,
                correo: values.correo,
                clave: values.clave,
                rol: values.rol,
                ubicaciones: values.ubicacion ? [values.ubicacion] : [],
              }));
            }}
          >
            <UserPlus size={24} />
            <h2>Nuevo responsable</h2>
            <div className="two-fields">
              <label>
                Nombres
                <input name="nombres" required />
              </label>
              <label>
                Apellidos
                <input name="apellidos" required />
              </label>
            </div>
            <label>
              Correo
              <input name="correo" type="email" required />
            </label>
            <label>
              Contraseña inicial
              <input name="clave" type="password" minLength={10} required />
            </label>
            <div className="two-fields">
              <label>
                Rol
                <select name="rol">
                  <option>Vendedor</option>
                  <option>Analista</option>
                </select>
              </label>
              <label>
                Ubicación
                <select name="ubicacion" required>
                  <option value="">Seleccionar</option>
                  {locations
                    .filter((x) => x.activa)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <button className="primary" disabled={busy || locations.length === 0}>
              Crear y asignar
            </button>
          </form>
        )}
        {managesInventory && (
          <form
            className="admin-card"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = event.currentTarget;
              const locationId = String(new FormData(form).get('ubicacion'));
              void submit(`/locations/${locationId}/inventory/adjustments`, form, (values) => ({
                varianteId: values.varianteId,
                delta: Number(values.delta),
                motivo: values.motivo,
              }));
            }}
          >
            <PackagePlus size={24} />
            <h2>Agregar o ajustar stock</h2>
            <label>
              Ubicación
              <select name="ubicacion" required>
                <option value="">Seleccionar</option>
                {locations
                  .filter((x) => x.activa)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nombre}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Prenda y variante
              <select name="varianteId" required>
                <option value="">Seleccionar</option>
                {variants.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.producto} · {x.talla} · {x.color}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad (+ entrada / − salida)
              <input name="delta" type="number" min="-100000" max="100000" required />
            </label>
            <label>
              Motivo
              <input name="motivo" minLength={5} required />
            </label>
            <button className="primary" disabled={busy || variants.length === 0}>
              Registrar ajuste
            </button>
          </form>
        )}
        {managesInventory && (
          <form
            className="admin-card"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              void submit('/locations/transfers', event.currentTarget, (values) => ({
                origenId: values.origenId,
                destinoId: values.destinoId,
                varianteId: values.varianteId,
                cantidad: Number(values.cantidad),
                motivo: values.motivo,
              }));
            }}
          >
            <ArrowRightLeft size={24} />
            <h2>Transferir existencias</h2>
            <div className="two-fields">
              <label>
                Origen
                <select name="origenId" required>
                  <option value="">Seleccionar</option>
                  {locations
                    .filter((x) => x.activa)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Destino
                <select name="destinoId" required>
                  <option value="">Seleccionar</option>
                  {locations
                    .filter((x) => x.activa)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nombre}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <label>
              Prenda y variante
              <select name="varianteId" required>
                <option value="">Seleccionar</option>
                {variants.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.producto} · {x.talla} · {x.color}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad
              <input name="cantidad" type="number" min="1" max="100000" required />
            </label>
            <label>
              Motivo
              <input name="motivo" minLength={5} required />
            </label>
            <button className="primary" disabled={busy || locations.length < 2}>
              Confirmar transferencia
            </button>
          </form>
        )}
      </div>
      {managesCatalog && (
        <section className="admin-card" aria-label="Imágenes AR cargadas">
          <h2>Imágenes de prueba AR</h2>
          {arResources.length === 0 && <p>Todavía no hay imágenes AR cargadas.</p>}
          {arResources.map((resource) => (
            <div key={resource.id} className="ar-resource-row">
              <img src={resource.imagePath} alt={resource.textoAlternativo} />
              <div>
                <strong>
                  {resource.producto} · {resource.talla} · {resource.color}
                </strong>
                <p>
                  {resource.estado === 'PUBLICADO' ? 'Publicada' : 'Borrador'} · {resource.licencia}
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => void setArImageStatus(resource)}>
                {resource.estado === 'PUBLICADO' ? 'Retirar' : 'Publicar'}
              </button>
            </div>
          ))}
        </section>
      )}
      {['all', 'locations', 'inventory'].includes(module) && (
        <div className="location-list">
          <h2>Ubicaciones registradas</h2>
          {locations.map((location) => (
            <article key={location.id}>
              <div>
                <b>{location.nombre}</b>
                <span>
                  {location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'} ·{' '}
                  {location.direccion || 'Sin dirección'} {!location.activa && '· Inactiva'}
                </span>
              </div>
              <div>
                <b>{location._count.inventario}</b>
                <span>variantes</span>
              </div>
              <div>
                <b>{location._count.usuario_ubicacion}</b>
                <span>responsables</span>
              </div>
              <small>
                {location.usuario_ubicacion
                  .map((x) => `${x.usuario.nombres} ${x.usuario.apellidos}`)
                  .join(', ') || 'Sin personal asignado'}
              </small>
              <div className="row-actions">
                <button className="text-button" onClick={() => void showInventory(location)}>
                  <PackagePlus size={15} /> Inventario
                </button>
                <button className="text-button" onClick={() => void showHistory(location)}>
                  <History size={15} /> Movimientos
                </button>
                {managesLocations && location.activa && (
                  <>
                    <button className="text-button" onClick={() => setEditingLocation(location)}>
                      <Pencil size={15} /> Editar
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => void deactivate(location)}
                    >
                      <Power size={15} /> Desactivar
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {editingLocation && (
        <form className="editor-panel" onSubmit={updateLocation}>
          <div>
            <span className="eyebrow">EDITAR UBICACIÓN</span>
            <h2>{editingLocation.nombre}</h2>
          </div>
          <label>
            Nombre
            <input name="nombre" defaultValue={editingLocation.nombre} minLength={2} required />
          </label>
          <label>
            Tipo
            <select name="tipo" defaultValue={editingLocation.tipo}>
              <option value="TIENDA">Sucursal</option>
              <option value="ALMACEN">Almacén</option>
            </select>
          </label>
          <label>
            Dirección
            <input
              name="direccion"
              defaultValue={editingLocation.direccion || ''}
              minLength={5}
              required
            />
          </label>
          <div className="row-actions">
            <button className="primary" disabled={busy}>
              Guardar cambios
            </button>
            <button type="button" className="text-button" onClick={() => setEditingLocation(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {inventoryLocation && (
        <div className="inventory-detail">
          <div className="movement-heading">
            <div>
              <span className="eyebrow">INVENTARIO DETALLADO</span>
              <h2>{inventoryLocation.nombre}</h2>
            </div>
            <button className="text-button" onClick={() => setInventoryLocation(null)}>
              Cerrar
            </button>
          </div>
          <div className="inventory-head">
            <span>Prenda y variante</span>
            <span>Físico</span>
            <span>Reservado</span>
            <span>Comprometido</span>
            <span>Disponible</span>
            <span>Mínimo</span>
            <span>Estado</span>
            <span>Acciones</span>
          </div>
          {inventory.map((row) => (
            <article className="inventory-row" key={row.id}>
              <div>
                <b>{row.variante.producto.nombre}</b>
                <span>
                  {row.variante.sku} · {row.variante.talla} · {row.variante.color}
                </span>
              </div>
              <strong>{row.fisico}</strong>
              <span>{row.reservado}</span>
              <span>{row.comprometido}</span>
              <strong>{row.disponible}</strong>
              <span>{row.stockSeguridad}</span>
              <span className={row.alertaStock ? 'stock-warning' : 'stock-ok'}>
                {row.alertaStock ? 'Stock bajo' : 'Disponible'}
              </span>
              <div className="row-actions">
                {managesInventory && (
                  <button className="text-button" onClick={() => setCountingRow(row)}>
                    Contar
                  </button>
                )}
                {managesInventory && (
                  <button className="text-button" onClick={() => setThresholdRow(row)}>
                    Mínimo
                  </button>
                )}
              </div>
            </article>
          ))}
          {inventory.length === 0 && (
            <p className="fineprint">Esta ubicación todavía no tiene inventario.</p>
          )}
        </div>
      )}
      {countingRow && inventoryLocation && (
        <form className="editor-panel" onSubmit={saveCount}>
          <div>
            <span className="eyebrow">CONTEO FÍSICO</span>
            <h2>
              {countingRow.variante.producto.nombre} · {countingRow.variante.talla}
            </h2>
          </div>
          <label>
            Unidades observadas
            <input
              name="conteoObservado"
              type="number"
              min="0"
              defaultValue={countingRow.fisico}
              required
            />
          </label>
          <label>
            Motivo
            <input name="motivo" minLength={5} defaultValue="Conteo físico periódico" required />
          </label>
          <div className="row-actions">
            <button className="primary" disabled={busy}>
              Conciliar conteo
            </button>
            <button type="button" className="text-button" onClick={() => setCountingRow(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {thresholdRow && inventoryLocation && (
        <form className="editor-panel" onSubmit={saveThreshold}>
          <div>
            <span className="eyebrow">MÍNIMO DE STOCK</span>
            <h2>
              {thresholdRow.variante.producto.nombre} · {thresholdRow.variante.talla}
            </h2>
          </div>
          <label>
            Stock mínimo
            <input
              name="stockSeguridad"
              type="number"
              min="0"
              defaultValue={thresholdRow.stockSeguridad}
              required
            />
          </label>
          <label>
            Reposición en días
            <input
              name="plazoReposicionDias"
              type="number"
              min="0"
              max="365"
              defaultValue={thresholdRow.plazoReposicionDias}
              required
            />
          </label>
          <div className="row-actions">
            <button className="primary" disabled={busy}>
              Guardar mínimo
            </button>
            <button type="button" className="text-button" onClick={() => setThresholdRow(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {managesUsers && (
        <div className="staff-list">
          <h2>Personal y asignaciones</h2>
          {staff.map((person) => {
            const assignedNames = person.usuario_ubicacion
              .map(
                (assignment) =>
                  locations.find((location) => location.id === assignment.ubicacion_id)?.nombre,
              )
              .filter(Boolean);
            return (
              <article key={person.id}>
                <div>
                  <b>
                    {person.nombres} {person.apellidos}
                  </b>
                  <span>
                    {person.usuario_rol.map((item) => item.rol.nombre).join(', ')} · {person.correo}
                  </span>
                </div>
                <span>{assignedNames.join(', ') || 'Sin ubicación asignada'}</span>
                <button className="text-button" onClick={() => editAssignments(person)}>
                  <UserCog size={16} /> Gestionar ubicaciones
                </button>
              </article>
            );
          })}
          {staff.length === 0 && (
            <p className="fineprint">Todavía no hay vendedores o analistas.</p>
          )}
        </div>
      )}
      {editingStaff && (
        <div className="editor-panel assignment-editor">
          <div>
            <span className="eyebrow">ASIGNAR UBICACIONES</span>
            <h2>
              {editingStaff.nombres} {editingStaff.apellidos}
            </h2>
          </div>
          <div className="assignment-options">
            {locations.map((location) => (
              <label key={location.id}>
                <input
                  type="checkbox"
                  checked={staffLocations.includes(location.id)}
                  disabled={!location.activa && !staffLocations.includes(location.id)}
                  onChange={(event) =>
                    setStaffLocations((current) =>
                      event.target.checked
                        ? [...new Set([...current, location.id])]
                        : current.filter((id) => id !== location.id),
                    )
                  }
                />
                <span>
                  {location.nombre}
                  <small>
                    {location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'}
                    {!location.activa ? ' · Inactiva' : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="row-actions">
            <button className="primary" disabled={busy} onClick={() => void saveAssignments()}>
              Guardar asignaciones
            </button>
            <button className="text-button" onClick={() => setEditingStaff(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {historyLocation && (
        <div className="movement-history">
          <div className="movement-heading">
            <div>
              <span className="eyebrow">HISTORIAL DE INVENTARIO</span>
              <h2>{historyLocation.nombre}</h2>
            </div>
            <button className="text-button" onClick={() => setHistoryLocation(null)}>
              Cerrar
            </button>
          </div>
          {movements.length === 0 ? (
            <p className="fineprint">Todavía no hay movimientos registrados.</p>
          ) : (
            movements.map((movement) => (
              <article className="movement-row" key={movement.id}>
                <time>
                  {new Intl.DateTimeFormat('es-BO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(movement.creadoEn))}
                </time>
                <div>
                  <b>{movement.variante.producto.nombre}</b>
                  <span>
                    {movement.variante.sku} · {movement.variante.talla} · {movement.variante.color}
                  </span>
                </div>
                <strong className={movement.deltaFisico > 0 ? 'positive' : 'negative'}>
                  {movement.deltaFisico > 0 ? '+' : ''}
                  {movement.deltaFisico}
                </strong>
                <div>
                  <b>
                    {movement.tipo === 'TRANSFERENCIA' && movement.contraparte
                      ? `${movement.deltaFisico > 0 ? 'Desde' : 'Hacia'} ${movement.contraparte.nombre}`
                      : movement.tipo}
                  </b>
                  <span>{movement.motivo}</span>
                </div>
                <small>
                  {movement.actor.nombres} {movement.actor.apellidos}
                </small>
              </article>
            ))
          )}
        </div>
      )}
      {staff.length > 0 && (
        <p className="fineprint">
          Personal activo: {staff.length}. Cada vendedor o analista consulta únicamente las
          ubicaciones que tenga asignadas.
        </p>
      )}
    </section>
  );
}
