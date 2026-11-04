import { FormEvent, useEffect, useRef, useState } from 'react';
import { Building2, Plus, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { TeamMember, ManagedLocation, ManagementProps } from './management';
import './management.css';

export function Locations({ readOnly, online, limit }: ManagementProps) {
  const [locations, setLocations] = useState<ManagedLocation[]>([]),
    [people, setPeople] = useState<TeamMember[]>([]);
  const [editing, setEditing] = useState<ManagedLocation | 'new' | null>(null);
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('ALL');
  const [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  async function load() {
    setLoading(true);
    try {
      const [places, members] = await Promise.all([api('/locations'), api('/staff')]);
      if (alive.current) {
        setLocations(places);
        setPeople(members);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  async function save(body: object) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(editing === 'new' ? '/locations' : `/locations/${editing!.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      if (!alive.current) return;
      setEditing(null);
      setMessage('Ubicación guardada. El historial y sus existencias se conservan.');
      await load();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const active = locations.filter((l) => l.activa).length,
    disabled = readOnly || !online;
  const visible = locations.filter(
    (l) =>
      (filter === 'ALL' || String(l.activa) === filter) &&
      `${l.nombre} ${l.direccion || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="locations-module management-module">
      <div className="business-page-heading">
        <div>
          <span className="eyebrow">ESPACIOS DE TU NEGOCIO</span>
          <h1>Sucursales y almacenes</h1>
          <p>Organiza las ubicaciones y designa una persona responsable.</p>
        </div>
        <button
          className="business-refresh"
          onClick={() => {
            setError('');
            void load();
          }}
          disabled={loading || busy || !online}
        >
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      <div className="management-summary">
        <Building2 size={22} />
        <div>
          <strong>
            {active} {limit !== undefined && limit >= 0 ? `de ${limit}` : ''} ubicaciones activas
          </strong>
          <p>Sucursales y almacenes comparten el cupo del plan.</p>
        </div>
      </div>
      {disabled && (
        <p className="message">
          {!online
            ? 'Crear o reorganizar ubicaciones requiere conexión. La información cargada sigue disponible para consulta.'
            : 'Renueva el plan para modificar ubicaciones.'}
        </p>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}{' '}
          {editing && (
            <button
              onClick={() => {
                setEditing(null);
                setError('');
                void load();
              }}
            >
              Cerrar edición y recargar
            </button>
          )}
        </div>
      )}
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
      <div className="management-toolbar">
        <label>
          Buscar ubicación
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre o dirección"
          />
        </label>
        <label>
          Filtrar estado
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">Todas</option>
            <option value="true">Activas</option>
            <option value="false">Inactivas</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={
            disabled || busy || loading || (limit !== undefined && limit >= 0 && active >= limit)
          }
          onClick={() => {
            setEditing('new');
            setError('');
            setMessage('');
          }}
        >
          <Plus size={16} />
          Agregar ubicación
        </button>
      </div>
      {editing && (
        <LocationEditor
          key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`}
          location={editing === 'new' ? null : editing}
          locations={locations}
          people={people}
          disabled={disabled || busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {loading && <p role="status">Consultando ubicaciones…</p>}
      <div className="management-grid">
        {visible.map((location) => (
          <article key={location.id} className="management-card">
            <div>
              <span className={`management-state ${location.activa ? 'active' : ''}`}>
                {location.activa ? 'Activa' : 'Inactiva'}
              </span>
              <h2>{location.nombre}</h2>
              <b>{location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'}</b>
              <p>{location.direccion || 'Sin dirección registrada'}</p>
            </div>
            <dl>
              <div>
                <dt>Responsable</dt>
                <dd>
                  {location.responsable
                    ? `${location.responsable.nombres} ${location.responsable.apellidos}`
                    : 'Por asignar'}
                </dd>
              </div>
              <div>
                <dt>Depende de</dt>
                <dd>
                  {locations.find((l) => l.id === location.padre_id)?.nombre || 'Sin dependencia'}
                </dd>
              </div>
              <div>
                <dt>Equipo asignado</dt>
                <dd>{location._count.usuario_ubicacion}</dd>
              </div>
            </dl>
            <button
              className="business-refresh"
              disabled={disabled || busy}
              onClick={() => {
                setEditing(location);
                setError('');
                setMessage('');
              }}
            >
              Editar
            </button>
          </article>
        ))}
      </div>
      {!loading && !visible.length && (
        <p className="management-empty">No hay ubicaciones que coincidan con tu búsqueda.</p>
      )}
      <p className="management-help">
        Consulta saldos, conteos y movimientos en el módulo Inventario. Asigna el personal desde
        Equipo y permisos.
      </p>
    </section>
  );
}
function LocationEditor({
  location,
  locations,
  people,
  disabled,
  onSave,
  onCancel,
}: {
  location: ManagedLocation | null;
  locations: ManagedLocation[];
  people: TeamMember[];
  disabled: boolean;
  onSave: (body: object) => Promise<void>;
  onCancel: () => void;
}) {
  const [active, setActive] = useState(String(location?.activa ?? true));
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onSave({
      nombre: data.get('nombre'),
      tipo: data.get('tipo'),
      responsableId: data.get('responsable'),
      ...(data.get('direccion')
        ? { direccion: data.get('direccion') }
        : location
          ? { direccion: null }
          : {}),
      ...(data.get('padre') ? { padreId: data.get('padre') } : location ? { padreId: null } : {}),
      ...(location
        ? {
            expectedVersion: location.version,
            activa: active === 'true',
            ...(active === 'false' ? { motivo: data.get('motivo') } : {}),
          }
        : {}),
    });
  }
  return (
    <form
      ref={form}
      className="management-editor"
      aria-label="Datos de la ubicación"
      onSubmit={submit}
    >
      <h2>{location ? 'Editar ubicación' : 'Nueva ubicación'}</h2>
      <fieldset disabled={disabled}>
        <div className="management-fields">
          <label>
            Nombre
            <input
              name="nombre"
              required
              minLength={2}
              maxLength={120}
              defaultValue={location?.nombre}
            />
          </label>
          <label>
            Tipo
            <select aria-label="Tipo" name="tipo" defaultValue={location?.tipo || 'TIENDA'}>
              <option value="TIENDA">Sucursal</option>
              <option value="ALMACEN">Almacén</option>
            </select>
          </label>
          <label>
            Dirección
            <input
              name="direccion"
              minLength={5}
              maxLength={300}
              defaultValue={location?.direccion || ''}
            />
          </label>
          <label>
            Responsable
            <select
              aria-label="Responsable"
              name="responsable"
              required
              defaultValue={location?.responsable_id || ''}
            >
              <option value="">Selecciona una persona</option>
              {people
                .filter((p) => p.estado === 'ACTIVO')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombres} {p.apellidos} · {p.correo}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Ubicación superior
            <select
              aria-label="Ubicación superior"
              name="padre"
              defaultValue={location?.padre_id || ''}
            >
              <option value="">Sin dependencia</option>
              {locations
                .filter((l) => l.id !== location?.id && (l.activa || l.id === location?.padre_id))
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nombre}
                    {!l.activa ? ' · Inactiva' : ''}
                  </option>
                ))}
            </select>
          </label>
          {location && (
            <label>
              Estado
              <select
                aria-label="Estado"
                value={active}
                onChange={(e) => setActive(e.target.value)}
              >
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </label>
          )}
        </div>
        {active === 'false' && (
          <label>
            Motivo
            <textarea
              name="motivo"
              required
              minLength={5}
              maxLength={400}
              placeholder="Explica la desactivación"
            />
          </label>
        )}
        <p className="management-help">
          La persona responsable recibe acceso a esta ubicación. Para desactivarla deben estar
          resueltos el stock, las reservas, los pedidos y las dependencias.
        </p>
        <div className="management-actions">
          <button className="primary" type="submit">
            Guardar ubicación
          </button>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}
