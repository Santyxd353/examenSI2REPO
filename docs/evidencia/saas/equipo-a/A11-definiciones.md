# A11 · Definiciones privadas de reportes

Cada tienda cuenta sus definiciones activas para aplicar el cupo de su plan. La creación, la comprobación del cupo y la auditoría se ejecutan en la misma transacción. Una edición conserva el identificador y aumenta la versión. Archivar libera el cupo y conserva la definición para las referencias históricas.

Las rutas requieren autenticación, `X-Tenant-Slug` y el permiso `reportes:consultar`. Cada cuenta accede a sus definiciones. El servidor revalida el acceso de escritura del plan.

| Ruta | Contrato |
| --- | --- |
| `GET /api/reports/definitions` | Devuelve `{definitions}` con las definiciones activas propias. |
| `GET /api/reports/definitions/:id` | Devuelve la definición activa con tienda, propietaria, versión, estado y fecha. |
| `POST /api/reports/definitions` | Recibe `{definition,operationId?}`. La definición usa `ReportDefinitionSchema`. Reenviar el mismo UUID y contenido recupera el registro actual. |
| `PATCH /api/reports/definitions/:id` | Recibe `{expectedVersion,definition}`. Una versión anterior da `VERSION_CONFLICT`. |
| `DELETE /api/reports/definitions/:id?expectedVersion=N` | Archiva la definición. Repetir el mismo archivo devuelve el estado archivado. |

«Guardar como» crea una definición con UUID nuevo y consume un cupo. Los conjuntos de datos y la ejecución quedan en el siguiente incremento de A11.

La prueba HTTP verifica dos creaciones concurrentes con un cupo libre, edición con versión, conflicto de versión, liberación por archivo, reintento de alta y aislamiento entre cuentas con permiso. La prueba de ventas anterior sigue aprobada.
