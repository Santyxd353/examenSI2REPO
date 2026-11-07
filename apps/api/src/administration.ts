import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomUUID } from 'crypto';
import { StaffCreate, StaffUpdate, LocationCreate, LocationUpdate } from '@lumina/contracts';
import { Identity } from './auth';
import { requireCapacity } from './tenancy/capacity';
import { lockActiveLocations } from './inventory/scope';
import { assignAssortment } from './assortment';

type Tx = Prisma.TransactionClient;
export const staffRoles = ['Administrador', 'Vendedor', 'Analista'];
export const staffSelect = {
  id: true,
  nombres: true,
  apellidos: true,
  correo: true,
  estado: true,
  version: true,
  usuario_rol: { select: { rol: { select: { nombre: true } } } },
  usuario_ubicacion: { select: { ubicacion_id: true } },
} satisfies Prisma.usuarioSelect;
type Staff = Prisma.usuarioGetPayload<{ select: typeof staffSelect }>;
export const staffDto = (user: Staff) => ({
  ...user,
  schemaVersion: '1.0',
  rol: staffRoles.find((name) => user.usuario_rol.some((r) => r.rol.nombre === name)),
});
export const locationInclude = {
  responsable: { select: { id: true, nombres: true, apellidos: true, estado: true } },
  _count: { select: { inventario: true, usuario_ubicacion: true } },
  usuario_ubicacion: {
    include: { usuario: { select: { id: true, nombres: true, apellidos: true, correo: true } } },
  },
} satisfies Prisma.ubicacionInclude;
export const locationDto = <T extends { id: string }>(row: T) => ({ ...row, schemaVersion: '1.0' });

// All team, responsibility, assignment and hierarchy changes acquire this lock first.
// Recheck the actor after waiting: a concurrent role change must not leave cached authority.
export async function lockAdministration(tx: Tx, actor: Identity, permission: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended('vestidor18:ubicacion:jerarquia', 0))`;
  const [recurso, accion] = permission.split(':');
  const authorized = await tx.usuario.count({
    where: {
      id: actor.id,
      estado: 'ACTIVO',
      usuario_rol: { some: { rol: { rol_permiso: { some: { permiso: { recurso, accion } } } } } },
    },
  });
  if (!authorized)
    throw new ForbiddenException('Tus permisos cambiaron. Inicia sesión nuevamente.');
}
async function audit(
  tx: Tx,
  actor: Identity,
  entity: string,
  id: string,
  action: string,
  before: unknown,
  after: unknown,
  reason?: string,
) {
  await tx.auditoria.create({
    data: {
      actor_id: actor.id,
      entidad: entity,
      entidad_id: id,
      accion: action,
      correlacion: randomUUID(),
      creado_en: new Date(),
      cambios: JSON.parse(JSON.stringify({ before, after, reason })),
    },
  });
}
function version(found: { version: number }, expected?: number) {
  if (expected !== undefined && expected !== found.version)
    throw new ConflictException({
      code: 'VERSION_CONFLICT',
      message: 'Otra persona modificó este registro. Recarga antes de guardar.',
      details: { currentVersion: found.version },
    });
}
async function revoke(tx: Tx, userId: string) {
  await tx.sesion.updateMany({
    where: { usuario_id: userId, revocada_en: null },
    data: { revocada_en: new Date() },
  });
}
async function activeStaff(tx: Tx, id: string) {
  const user = await tx.usuario.findFirst({
    where: { id, estado: 'ACTIVO', usuario_rol: { some: { rol: { nombre: { in: staffRoles } } } } },
    select: staffSelect,
  });
  if (!user)
    throw new BadRequestException(
      'La persona responsable debe ser un integrante activo de esta tienda.',
    );
  return user;
}
export async function passwordHash(password?: string) {
  if (password === undefined) return undefined;
  if (Buffer.byteLength(password, 'utf8') > 72)
    throw new BadRequestException('La contraseña supera 72 bytes UTF-8.');
  return hash(password, 12);
}
export async function createStaff(tx: Tx, actor: Identity, data: StaffCreate, password: string) {
  await lockAdministration(tx, actor, 'usuarios:gestionar');
  await requireCapacity(tx, 'staff');
  const locations = [...new Set(data.ubicaciones)];
  if (locations.length) await lockActiveLocations(tx, locations);
  const role = await tx.rol.findUniqueOrThrow({ where: { nombre: data.rol } });
  const user = await tx.usuario.create({
    data: {
      nombres: data.nombres,
      apellidos: data.apellidos,
      correo: data.correo,
      clave_hash: password,
      estado: 'ACTIVO',
      preferencias: { push: false },
      creado_en: new Date(),
      usuario_rol: { create: { rol_id: role.id, asignado_en: new Date() } },
      usuario_ubicacion: { create: locations.map((ubicacion_id) => ({ ubicacion_id })) },
    },
    select: staffSelect,
  });
  const dto = staffDto(user);
  await audit(tx, actor, 'usuario', user.id, 'STAFF_CREATE', null, dto);
  return dto;
}
export async function updateStaff(
  tx: Tx,
  actor: Identity,
  id: string,
  data: StaffUpdate,
  password?: string,
) {
  await lockAdministration(tx, actor, 'usuarios:gestionar');
  await tx.$queryRaw`SELECT id FROM usuario WHERE id=${id}::uuid FOR UPDATE`;
  const before = await tx.usuario.findFirst({
    where: { id, usuario_rol: { some: { rol: { nombre: { in: staffRoles } } } } },
    select: staffSelect,
  });
  if (!before) throw new NotFoundException('Integrante no encontrado.');
  version(before, data.expectedVersion);
  const isAdmin = before.usuario_rol.some((r) => r.rol.nombre === 'Administrador');
  const state = data.estado ?? before.estado;
  if (
    before.estado === 'ACTIVO' &&
    isAdmin &&
    (state !== 'ACTIVO' || (data.rol && data.rol !== 'Administrador'))
  ) {
    const remaining = await tx.usuario.count({
      where: {
        id: { not: id },
        estado: 'ACTIVO',
        usuario_rol: { some: { rol: { nombre: 'Administrador' } } },
      },
    });
    if (!remaining)
      throw new ConflictException({
        code: 'LAST_ADMIN',
        message: 'Designa otra administradora activa antes de quitar este acceso.',
      });
  }
  const locations = data.ubicaciones === undefined ? undefined : [...new Set(data.ubicaciones)];
  const responsibilities = await tx.ubicacion.findMany({
    where: { responsable_id: id, activa: true },
    select: { id: true, nombre: true },
  });
  if (
    responsibilities.some(
      (l) =>
        state !== 'ACTIVO' ||
        (locations !== undefined &&
          !locations.includes(l.id) &&
          (data.rol ?? staffDto(before).rol) !== 'Administrador'),
    )
  )
    throw new ConflictException({
      code: 'RESPONSIBLE_REQUIRED',
      message: 'Reasigna las ubicaciones activas antes de suspender o retirar a su responsable.',
      details: { locations: responsibilities },
    });
  if (state === 'ACTIVO' && before.estado !== 'ACTIVO') await requireCapacity(tx, 'staff');
  if (locations?.length) {
    // Retaining a historical inactive assignment is valid; adding one is not.
    const added = locations.filter(
      (l) => !before.usuario_ubicacion.some((a) => a.ubicacion_id === l),
    );
    if (added.length) await lockActiveLocations(tx, added);
  }
  if (data.rol) {
    const role = await tx.rol.findUniqueOrThrow({ where: { nombre: data.rol } });
    await tx.usuario_rol.deleteMany({
      where: { usuario_id: id, rol: { nombre: { in: staffRoles } } },
    });
    await tx.usuario_rol.create({
      data: { usuario_id: id, rol_id: role.id, asignado_en: new Date() },
    });
  }
  if (locations !== undefined) {
    await tx.usuario_ubicacion.deleteMany({
      where: { usuario_id: id, ubicacion_id: { notIn: locations } },
    });
    await tx.usuario_ubicacion.createMany({
      data: locations.map((ubicacion_id) => ({ usuario_id: id, ubicacion_id })),
      skipDuplicates: true,
    });
  }
  const after = await tx.usuario.update({
    where: { id },
    data: {
      nombres: data.nombres,
      apellidos: data.apellidos,
      correo: data.correo,
      estado: data.estado,
      clave_hash: password,
      version: { increment: 1 },
    },
    select: staffSelect,
  });
  const changedScope =
    locations !== undefined &&
    [...locations].sort().join() !==
      before.usuario_ubicacion
        .map((a) => a.ubicacion_id)
        .sort()
        .join();
  const roleChanged =
    data.rol !== undefined &&
    (before.usuario_rol.filter((r) => staffRoles.includes(r.rol.nombre)).length !== 1 ||
      staffDto(before).rol !== data.rol);
  if (
    state !== before.estado ||
    roleChanged ||
    changedScope ||
    password !== undefined ||
    (data.correo !== undefined && data.correo !== before.correo)
  )
    await revoke(tx, id);
  await audit(
    tx,
    actor,
    'usuario',
    id,
    'STAFF_UPDATE',
    staffDto(before),
    staffDto(after),
    data.motivo,
  );
  return staffDto(after);
}

async function ensureAssortment(tx: Tx, id: string) {
  const variants = await tx.variante.findMany({
    where: { activa: true, producto: { estado: 'PUBLICADO' } },
    select: { id: true },
  });
  await assignAssortment(
    tx,
    variants.map((v) => v.id),
    [id],
  );
}
async function assignResponsible(tx: Tx, locationId: string, userId: string) {
  const assignment = await tx.usuario_ubicacion.findUnique({
    where: { usuario_id_ubicacion_id: { usuario_id: userId, ubicacion_id: locationId } },
  });
  if (!assignment) {
    await tx.usuario_ubicacion.create({ data: { usuario_id: userId, ubicacion_id: locationId } });
    await tx.usuario.update({ where: { id: userId }, data: { version: { increment: 1 } } });
    // Administrators already have all locations; adding their own location must not log them out.
    const admin = await tx.usuario_rol.count({
      where: { usuario_id: userId, rol: { nombre: 'Administrador' } },
    });
    if (!admin) await revoke(tx, userId);
  }
}
export async function createLocation(tx: Tx, actor: Identity, data: LocationCreate) {
  await lockAdministration(tx, actor, 'ubicaciones:gestionar');
  await requireCapacity(tx, 'locations');
  if (data.padreId) await lockActiveLocations(tx, [data.padreId]);
  const responsible = data.responsableId ?? actor.id;
  await activeStaff(tx, responsible);
  const location = await tx.ubicacion.create({
    data: {
      nombre: data.nombre,
      tipo: data.tipo,
      direccion: data.direccion,
      padre_id: data.padreId,
      responsable_id: responsible,
      activa: true,
    },
  });
  await assignResponsible(tx, location.id, responsible);
  await ensureAssortment(tx, location.id);
  const after = locationDto(
    await tx.ubicacion.findUniqueOrThrow({ where: { id: location.id }, include: locationInclude }),
  );
  await audit(tx, actor, 'ubicacion', location.id, 'LOCATION_CREATE', null, after);
  return after;
}
export async function updateLocation(tx: Tx, actor: Identity, id: string, data: LocationUpdate) {
  await lockAdministration(tx, actor, 'ubicaciones:gestionar');
  await tx.$queryRaw`SELECT id FROM ubicacion WHERE id=${id}::uuid FOR UPDATE`;
  const before = await tx.ubicacion.findUnique({ where: { id } });
  if (!before) throw new NotFoundException('Ubicación no encontrada.');
  version(before, data.expectedVersion);
  if (data.activa === true && !before.activa) await requireCapacity(tx, 'locations');
  const parentId = data.padreId === undefined ? before.padre_id : data.padreId;
  if (parentId && (data.padreId !== undefined || data.activa === true)) {
    const visited = new Set([id]);
    let current: string | null = parentId;
    while (current) {
      if (visited.has(current))
        throw new BadRequestException('La jerarquía de ubicaciones no puede formar un ciclo.');
      visited.add(current);
      const parent: { padre_id: string | null; activa: boolean } | null =
        await tx.ubicacion.findUnique({
          where: { id: current },
          select: { padre_id: true, activa: true },
        });
      if (!parent?.activa) throw new BadRequestException('La ubicación superior no está activa.');
      current = parent.padre_id;
    }
  }
  const responsible = data.responsableId ?? before.responsable_id;
  if (data.responsableId || (data.activa === true && !before.activa)) {
    if (!responsible)
      throw new BadRequestException('Asigna una persona responsable antes de reactivar.');
    await activeStaff(tx, responsible);
  }
  if (data.activa === false && before.activa) {
    const stock = await tx.inventario.count({
      where: {
        ubicacion_id: id,
        OR: [{ fisico: { gt: 0 } }, { reservado: { gt: 0 } }, { comprometido: { gt: 0 } }],
      },
    });
    const children = await tx.ubicacion.count({ where: { padre_id: id, activa: true } });
    const orders = await tx.pedido.count({
      where: { ubicacion_id: id, estado: { notIn: ['ENTREGADO', 'CERRADO', 'CANCELADO'] } },
    });
    const returns = await tx.devolucion.count({
      where: { pedido: { ubicacion_id: id }, estado: { notIn: ['RESUELTA', 'RECHAZADA'] } },
    });
    if (stock || children || orders || returns)
      throw new ConflictException({
        code: 'LOCATION_DEPENDENCIES',
        message:
          'Resuelve las existencias, ubicaciones dependientes, pedidos y devoluciones antes de desactivar.',
        details: { stock, children, orders, returns },
      });
  }
  const after = await tx.ubicacion.update({
    where: { id },
    data: {
      nombre: data.nombre,
      tipo: data.tipo,
      direccion: data.direccion,
      padre_id: data.padreId,
      responsable_id: data.responsableId,
      activa: data.activa,
      version: { increment: 1 },
    },
    include: locationInclude,
  });
  if (data.responsableId) await assignResponsible(tx, id, data.responsableId);
  if (data.activa === true && !before.activa) await ensureAssortment(tx, id);
  await audit(
    tx,
    actor,
    'ubicacion',
    id,
    'LOCATION_UPDATE',
    before,
    after,
    data.motivo ??
      (data.activa === false ? 'Desactivación solicitada desde cliente anterior.' : undefined),
  );
  return locationDto(
    await tx.ubicacion.findUniqueOrThrow({ where: { id }, include: locationInclude }),
  );
}
export async function changeAssignment(
  tx: Tx,
  actor: Identity,
  locationId: string,
  userId: string,
  add: boolean,
) {
  await lockAdministration(tx, actor, 'usuarios:gestionar');
  const location = await tx.ubicacion.findUnique({ where: { id: locationId } });
  if (!location || (add && !location.activa))
    throw new NotFoundException('Ubicación no encontrada o inactiva.');
  if (add) await activeStaff(tx, userId);
  if (!add && location.activa && location.responsable_id === userId)
    throw new ConflictException({
      code: 'RESPONSIBLE_REQUIRED',
      message: 'Reasigna primero a la persona responsable.',
    });
  const key = { usuario_id: userId, ubicacion_id: locationId };
  const before = await tx.usuario_ubicacion.findUnique({ where: { usuario_id_ubicacion_id: key } });
  if (add && before) return before;
  if (!add && !before) return { ok: true };
  const result = add
    ? await tx.usuario_ubicacion.create({ data: key })
    : await tx.usuario_ubicacion.delete({ where: { usuario_id_ubicacion_id: key } });
  await tx.usuario.update({ where: { id: userId }, data: { version: { increment: 1 } } });
  await tx.ubicacion.update({ where: { id: locationId }, data: { version: { increment: 1 } } });
  await revoke(tx, userId);
  await audit(
    tx,
    actor,
    'usuario',
    userId,
    add ? 'STAFF_ASSIGN' : 'STAFF_UNASSIGN',
    before,
    add ? result : null,
  );
  return add ? result : { ok: true };
}
