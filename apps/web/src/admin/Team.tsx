import { FormEvent, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Users } from 'lucide-react';
import { api } from '../api';
import { TeamMember, ManagedLocation, permissionLabels, ManagementProps } from './management';
import './management.css';

type Role = { nombre: string; permisos: string[] };
export function Team({ readOnly, online, limit }: ManagementProps) {
  const [people, setPeople] = useState<TeamMember[]>([]);
  const [locations, setLocations] = useState<ManagedLocation[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<TeamMember | 'new' | null>(null);
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('ALL');
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const alive = useRef(true);
  async function load() {
    setLoading(true);
    try {
      const [members, places, grants] = await Promise.all([
        api('/staff'),
        api('/locations'),
        api('/staff/roles'),
      ]);
      if (alive.current) {
        setPeople(members);
        setLocations(places);
        setRoles(grants);
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
      await api(editing === 'new' ? '/staff' : `/staff/${editing!.id}`, {
        method: editing === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      });
      if (!alive.current) return;
      setEditing(null);
      setMessage('Integrante guardada. Si cambió su acceso, deberá iniciar sesión nuevamente.');
      await load();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const active = people.filter((p) => p.estado === 'ACTIVO').length;
  const disabled = readOnly || !online;
  const visible = people.filter(
    (p) =>
      (filter === 'ALL' || p.estado === filter) &&
      `${p.nombres} ${p.apellidos} ${p.correo}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="team-module management-module">
      <div className="business-page-heading">
        <div>
          <span className="eyebrow">PERSONAS Y ACCESOS</span>
          <h1>Equipo y permisos</h1>
          <p>Define quién puede trabajar en tu tienda y en qué ubicaciones.</p>
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
        <Users size={22} />
        <div>
          <strong>
            {active} {limit !== undefined && limit >= 0 ? `de ${limit}` : ''} plazas activas
          </strong>
          <p>
            La administradora ocupa una plaza. Las compradoras y las cuentas suspendidas no consumen
            cupo.
          </p>
        </div>
      </div>
      {disabled && (
        <p className="message">
          {!online
            ? 'La gestión de accesos requiere conexión. Puedes seguir revisando la información cargada.'
            : 'El plan está en modo consulta. Renueva para modificar el equipo.'}
        </p>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}{' '}
          {editing && (
            <button
              type="button"
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
          Buscar integrante
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre o correo"
          />
        </label>
        <label>
          Filtrar estado
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">Todas</option>
            <option value="ACTIVO">Activas</option>
            <option value="SUSPENDIDO">Suspendidas</option>
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
          Agregar integrante
        </button>
      </div>
      {editing && (
        <TeamEditor
          key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`}
          person={editing === 'new' ? null : editing}
          locations={locations}
          roles={roles}
          disabled={disabled || busy}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {loading && <p role="status">Consultando equipo…</p>}
      <div className="management-grid">
        {visible.map((person) => (
          <article className="management-card" key={person.id}>
            <div>
              <span className={`management-state ${person.estado === 'ACTIVO' ? 'active' : ''}`}>
                {person.estado === 'ACTIVO' ? 'Activa' : 'Suspendida'}
              </span>
              <h2>
                {person.nombres} {person.apellidos}
              </h2>
              <p>{person.correo}</p>
              <b>
                {person.rol === 'Administrador'
                  ? 'Administradora'
                  : person.rol === 'Vendedor'
                    ? 'Vendedora'
                    : 'Analista'}
              </b>
            </div>
            <p>
              {person.rol === 'Administrador'
                ? 'Acceso a todas las ubicaciones.'
                : person.usuario_ubicacion.length
                  ? person.usuario_ubicacion
                      .map(
                        (a) =>
                          locations.find((l) => l.id === a.ubicacion_id)?.nombre ||
                          'Ubicación histórica',
                      )
                      .join(' · ')
                  : 'Sin ubicaciones asignadas.'}
            </p>
            <button
              className="business-refresh"
              disabled={disabled || busy}
              onClick={() => {
                setEditing(person);
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
        <p className="management-empty">No hay integrantes que coincidan con tu búsqueda.</p>
      )}
    </section>
  );
}

function TeamEditor({
  person,
  locations,
  roles,
  disabled,
  onSave,
  onCancel,
}: {
  person: TeamMember | null;
  locations: ManagedLocation[];
  roles: Role[];
  disabled: boolean;
  onSave: (body: object) => Promise<void>;
  onCancel: () => void;
}) {
  const [role, setRole] = useState(person?.rol || 'Vendedor'),
    [state, setState] = useState(person?.estado || 'ACTIVO');
  const [assigned, setAssigned] = useState(
    person?.usuario_ubicacion.map((a) => a.ubicacion_id) || [],
  );
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    form.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('clave') || '');
    void onSave({
      nombres: data.get('nombres'),
      apellidos: data.get('apellidos'),
      correo: data.get('correo'),
      rol: role,
      ubicaciones: assigned,
      ...(password ? { clave: password } : {}),
      ...(person
        ? {
            expectedVersion: person.version,
            estado: state,
            ...(state === 'SUSPENDIDO' ? { motivo: data.get('motivo') } : {}),
          }
        : {}),
    });
  }
  return (
    <form
      ref={form}
      className="management-editor"
      aria-label="Datos del integrante"
      onSubmit={submit}
    >
      <h2>{person ? 'Editar integrante' : 'Nueva integrante'}</h2>
      <fieldset disabled={disabled}>
        <div className="management-fields">
          <label>
            Nombres
            <input
              name="nombres"
              required
              minLength={2}
              maxLength={100}
              defaultValue={person?.nombres}
              autoComplete="off"
            />
          </label>
          <label>
            Apellidos
            <input
              name="apellidos"
              required
              minLength={2}
              maxLength={120}
              defaultValue={person?.apellidos}
              autoComplete="off"
            />
          </label>
          <label>
            Correo
            <input
              name="correo"
              type="email"
              required
              maxLength={160}
              defaultValue={person?.correo}
              autoComplete="off"
            />
          </label>
          <label>
            {person ? 'Nueva contraseña (opcional)' : 'Contraseña inicial'}
            <input
              name="clave"
              type="password"
              required={!person}
              minLength={10}
              maxLength={72}
              autoComplete="new-password"
            />
          </label>
          <label>
            Rol
            <select aria-label="Rol" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r.nombre} value={r.nombre}>
                  {r.nombre === 'Administrador'
                    ? 'Administradora'
                    : r.nombre === 'Vendedor'
                      ? 'Vendedora'
                      : r.nombre}
                </option>
              ))}
            </select>
          </label>
          {person && (
            <label>
              Estado
              <select
                aria-label="Estado"
                value={state}
                onChange={(e) => setState(e.target.value as typeof state)}
              >
                <option value="ACTIVO">Activa</option>
                <option value="SUSPENDIDO">Suspendida</option>
              </select>
            </label>
          )}
        </div>
        {state === 'SUSPENDIDO' && (
          <label>
            Motivo
            <textarea
              name="motivo"
              required
              minLength={5}
              maxLength={400}
              placeholder="Explica la suspensión"
            />
          </label>
        )}
        <div className="management-permissions">
          <h3>Acciones que recibirá</h3>
          <ul>
            {roles
              .find((r) => r.nombre === role)
              ?.permisos.map((p) => (
                <li key={p}>{permissionLabels[p] || p}</li>
              ))}
          </ul>
        </div>
        <fieldset>
          <legend>Ubicaciones asignadas</legend>
          {role === 'Administrador' && (
            <p>
              La administradora puede operar en todas las ubicaciones, aunque no estén marcadas.
            </p>
          )}
          <div className="management-checkboxes">
            {locations.map((location) => (
              <label key={location.id}>
                <input
                  type="checkbox"
                  checked={assigned.includes(location.id)}
                  disabled={!location.activa && !assigned.includes(location.id)}
                  onChange={(e) =>
                    setAssigned((current) =>
                      e.target.checked
                        ? [...current, location.id]
                        : current.filter((id) => id !== location.id),
                    )
                  }
                />
                <span>
                  {location.nombre}
                  {!location.activa ? ' · Inactiva' : ''}
                </span>
              </label>
            ))}
          </div>
          {!locations.length && <p>Aún no existen ubicaciones. Puedes asignarlas después.</p>}
        </fieldset>
        <p className="management-help">
          Cambiar el rol, contraseña, correo o ubicaciones revoca las sesiones. La suspensión
          conserva sus ventas y movimientos.
        </p>
        <div className="management-actions">
          <button className="primary" type="submit">
            Guardar integrante
          </button>
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}
