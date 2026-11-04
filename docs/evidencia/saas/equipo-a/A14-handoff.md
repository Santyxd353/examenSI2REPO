# A14 — Equipo y ubicaciones para B13

04/11/2026. Incremento temprano del Plan A para desbloquear B13. Rutas con prefijo `/api`, token y `X-Tenant-Slug`. Solo online: estos cambios no pertenecen a los cinco tipos de operación offline.

## Contratos

Importar `StaffCreateSchema`, `StaffUpdateSchema`, `LocationCreateSchema` y `LocationUpdateSchema` de `@lumina/contracts`. DTO de lectura con `schemaVersion: "1.0"` y `version` entera positiva. Nunca volver a enviar una edición obsoleta sin revisión de la persona.

| Ruta | Cuerpo / resultado |
| --- | --- |
| GET `/staff` | Array de integrantes, incluida administradora y suspendidas. Campos id, nombres, apellidos, correo, estado, rol, version, schemaVersion, usuario_rol[].rol.nombre y usuario_ubicacion[].ubicacion_id. Nunca incluye contraseña/hash. |
| GET `/staff/roles` | Array `{schemaVersion,nombre,permisos:string[]}`. Mostrar acciones efectivas antes de guardar. |
| POST `/staff` | `{nombres,apellidos,correo,clave,rol,ubicaciones:UUID[]}`; roles Administrador/Vendedor/Analista. Contraseña 10–72 caracteres y hasta 72 bytes UTF-8. Retorna integrante. |
| PATCH `/staff/:id` | `{expectedVersion,...camposModificados}`. Admite nombres, apellidos, correo, clave, rol, ubicaciones, estado ACTIVO/SUSPENDIDO y motivo. Suspensión exige motivo de 5–400 caracteres. `ubicaciones` reemplaza la asignación completa en la misma transacción. |
| GET `/locations` | Array con version/schemaVersion, datos anteriores y responsable_id; objeto responsable con id/nombres/apellidos/estado, conteos y asignaciones. Vendedora/analista reciben solo sus ubicaciones. |
| POST `/locations` | `{nombre,tipo,direccion?,padreId?,responsableId?}`. Tipo TIENDA/ALMACEN. En nuevos clientes enviar responsableId seleccionado. Compatibilidad antigua: se usa administradora solicitante si se omite. |
| PATCH `/locations/:id` | `{expectedVersion,nombre?,tipo?,direccion?,padreId?,responsableId?,activa?,motivo?}`. `padreId:null` elimina dependencia y `direccion:null` limpia dirección. Desactivar con versión exige motivo. |
| POST `/locations/:id/assignments` | Histórico `{usuarioId}`. Asignación idempotente; debe reautenticar a la persona afectada si cambió su ámbito. Preferir PATCH staff para sustituir varias asignaciones atómicamente. |
| DELETE `/locations/:id/assignments/:userId` | Histórico, conserva historial; no retira responsable vigente. |

La primera versión es 1. El guardado incrementa versión. Asignar responsable añade su acceso a la ubicación y actualiza la versión de la persona si faltaba la asignación. Volver a consultar equipo al regresar desde Ubicaciones.

## Reglas que debe reflejar Android

- Plazas activas incluyen administradoras, vendedoras y analistas; excluyen compradoras y suspendidas. Reactivación revalida cupo, incluso si la UI mostraba disponibilidad. No borrar cuentas para liberar cupo.
- No suspender ni quitar el rol a la última administradora activa. Dos solicitudes simultáneas no pueden quitar ambos accesos.
- Cambio efectivo de rol, correo, contraseña, asignaciones o estado revoca sesiones. Una nueva sesión vuelve a cargar permisos desde la base. No reutilizar tokens rechazados ni presentar una edición fallida como guardada.
- No suspender responsable de ubicación activa antes de reasignarla. Para una persona sin rol administrador, tampoco se permite retirar su asignación a una ubicación que aún tiene a cargo.
- La jerarquía no admite ciclos ni padres inactivos. Sucursal y almacén consumen el mismo cupo. Reactivación revalida responsable activo, padre y cupo.
- No desactivar con existencias físicas/reservadas/comprometidas, hijas activas, pedidos pendientes o devoluciones sin resolver. Pedidos entregados/cerrados/cancelados y devoluciones resueltas/rechazadas conservan historial sin impedir cierre.
- No cambiar personal/ubicaciones sin conexión. A07/A09 manejan otras operaciones offline; no agregar estos tipos a la cola.

## Respuestas relevantes

| Estado/código | Acción del cliente |
| --- | --- |
| 409 `VERSION_CONFLICT`, details.currentVersion | Conservar el formulario y ofrecer recargar; no sobrescribir automáticamente. |
| 409 `LAST_ADMIN` | Designar otra administradora activa. |
| 409 `RESPONSIBLE_REQUIRED`, details.locations cuando corresponda | Reasignar responsables antes de suspender o quitar ámbito. |
| 409 `LOCATION_DEPENDENCIES`, details.stock/children/orders/returns | Mostrar las cantidades pendientes y permitir corregirlas. |
| 409 de cupo o correo duplicado | Mantener formulario y explicar el mensaje del servidor. |
| 401/403 | Reautenticar o explicar falta de permiso, sin reintentar mutaciones ciegamente. |

Solo para APK ya distribuido: PATCH locations sin expectedVersion conserva aceptación histórica y estado HTTP400 para dependencias. Clientes nuevos siempre mandan expectedVersion; reciben HTTP409 y el mismo código estable. La compatibilidad no omite comprobaciones de cupo, responsabilidad o dependencias.

## Migración y alcance

Antes de arrancar esta API aplicar `202611040001_team_locations` en todas las tiendas (también suspendidas) con el procedimiento de A16. Añade version a usuario y ubicacion, responsable_id nullable con FK/índice y comprobaciones de versión. Mantiene 59 tablas. Regenerar Prisma. La base histórica no inventa responsables: null se presenta como «Por asignar» y reactivar exige seleccionar uno.

La web ya tiene módulos separados de Equipo y Ubicaciones. La finalización completa de A14 sigue dependiendo de la Sincronización real A09 y de Reportes/análisis A12/A13; este handoff no anuncia esas capacidades ni un despliegue. B implementa pantallas Android sobre estos contratos; los cambios de API siguen del lado A.
