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

«Guardar como» crea una definición con UUID nuevo y consume un cupo.

La prueba HTTP verifica dos creaciones concurrentes con un cupo libre, edición con versión, conflicto de versión, liberación por archivo, reintento de alta y aislamiento entre cuentas con permiso. La prueba de ventas anterior sigue aprobada.

## Conjuntos de datos

| Ruta | Contrato |
| --- | --- |
| `POST /api/reports/datasets` | Crea un corte. Recibe `{source:"REAL",period:{from,to},locationIds?,definitionId?}` o `{source:"DEMOSTRACION_SINTETICA",definitionId?}`. Devuelve metadatos, cobertura, hash y vencimiento. |
| `GET /api/reports/datasets/:id` | Consulta los metadatos del corte propio. |
| `GET /api/reports/datasets/:id/rows?offset=0&pageSize=500` | Descarga hechos etiquetados con el mismo corte y hash. `nextOffset: null` indica la última página. |
| `POST /api/reports/execute` | Recibe `{definition}` y ejecuta el motor compartido sobre el corte referenciado. |
| `POST /api/reports/export` | Recibe `{definition}` y genera el CSV del mismo resultado. |

El servidor conserva el corte durante 24 horas para la descarga y vuelve a comprobar la cuenta, el permiso y las ubicaciones en cada lectura. La copia real tiene un máximo de 50.000 hechos entre ventas, pedidos, pagos, devoluciones, reembolsos y stock. La cobertura identifica las omisiones y deshabilita las facetas incompletas. El stock representa el día del corte en Bolivia. El período de ventas usa el primer pago asentado y el filtro de devolución considera las devoluciones aceptadas del período descargado. Un reembolso sin atribución inequívoca a una variante figura como «Sin dato» al desglosar por producto.

Las pruebas comprobaron el límite y la última página, el cambio de día en Bolivia, el aislamiento por tienda y cuenta, la revocación de ubicación y la igualdad entre la ejecución HTTP y la ejecución sobre la copia. El fixture sintético permanece separado de las ventas reales. Comprobación local con PostgreSQL, siete pruebas HTTP y 23 pruebas del motor y los contratos.
