import { PrismaClient } from '@prisma/client';

export async function seedTenantRoles(client: PrismaClient) {
  for (const name of ['Cliente', 'Administrador', 'Vendedor', 'Analista'])
    await client.rol.upsert({
      where: { nombre: name },
      update: {},
      create: { nombre: name, descripcion: name, protegido: true },
    });
  const grants: Record<string, string[]> = {
    Administrador: [
      'catalogo:gestionar',
      'usuarios:gestionar',
      'ubicaciones:gestionar',
      'inventario:consultar',
      'inventario:gestionar',
      'ventas:registrar',
      'pedidos:gestionar',
      'reportes:consultar',
      'modelos:gestionar',
    ],
    Vendedor: ['inventario:consultar', 'inventario:gestionar', 'ventas:registrar'],
    Analista: ['inventario:consultar', 'reportes:consultar'],
  };
  for (const [roleName, permissions] of Object.entries(grants)) {
    const role = await client.rol.findUniqueOrThrow({ where: { nombre: roleName } });
    for (const permission of permissions) {
      const [recurso, accion] = permission.split(':');
      const grant = await client.permiso.upsert({
        where: { recurso_accion: { recurso, accion } },
        update: {},
        create: { recurso, accion, descripcion: `${recurso} ${accion}` },
      });
      await client.rol_permiso.upsert({
        where: { rol_id_permiso_id: { rol_id: role.id, permiso_id: grant.id } },
        update: {},
        create: { rol_id: role.id, permiso_id: grant.id },
      });
    }
  }
}
