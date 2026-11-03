# A05 — Contratos para B y siguientes bloques A

03/11/2026. Consumir el commit de A05 en la rama de integración después de su publicación. No copiar controladores ni crear otros DTO privados. Todas las rutas siguientes llevan `/api`, `Authorization: Bearer …` y `X-Tenant-Slug`; APP añade `X-Client-Channel: APP` en comercio. La BD seleccionada por el servidor define el ámbito de la tienda.

## Inventario

| Ruta | Cuerpo | Resultado |
| --- | --- | --- |
| POST `/locations/transfers` | `OnlineTransferSchema`: origenId, destinoId, varianteId, cantidad, motivo, operationId, deviceId | `{grupoOperacion,origen,destino}`; cantidades y versiones confirmadas. Reenvío idéntico devuelve el resultado original, diferente 409 |
| POST `/locations/:id/inventory/adjustments` | `{varianteId,delta,motivo}` | Inventario confirmado; delta distinto de cero, hasta ±100000 en esta ruta histórica |
| POST `/locations/:id/inventory/counts` | `{varianteId,conteoObservado,expectedVersion,motivo}` | Inventario confirmado; versión obsoleta 409; saldo menor a reservado+comprometido 400 por compatibilidad histórica |

Los motivos de las rutas históricas tienen mínimo 5 caracteres; el dominio compartido admite mínimo 3. La pareja operationId/deviceId es opcional únicamente para compatibilidad con transferencias de APK antiguos; enviar ambos en clientes nuevos. ONLINE_TRANSFER no es un tipo offline y debe deshabilitarse sin red. El dispositivo es la instalación cliente, UUID estable.

Funciones A07: `applyStockDelta(tx,{actor,operationId},StockDeltaInput)`, `applyStockCount(tx,{actor,operationId},StockCountInput)` y `transferStock(tx,{actor,operationId},StockTransferInput)`. Reciben `Prisma.TransactionClient`, no abren otra transacción. El procesador offline guarda recibo y cambio en la misma transacción. El dominio devuelve 409 `INSUFFICIENT_STOCK`/`VERSION_CONFLICT`; los adaptadores online conservan respuestas anteriores.

## Catálogo

| Ruta | Cuerpo | Notas |
| --- | --- | --- |
| GET `/catalog/manage` | — | `{products,categories}` incluye borradores/retirados, versiones, `variantes`, historial `precio_canal` y `recurso_catalogo` con URL; permiso catalogo:gestionar |
| POST `/catalog/products` | `CatalogProductSchema` | Alta BORRADOR, IDs UUID del cliente; versión 1 |
| PATCH `/catalog/products/:id` | `CatalogEditSchema`: `{baseVersion,patch}` | `CatalogProductPatchSchema`; si no coincide la versión, 409 sin cambios |
| POST `/catalog/products/:id/archive` | `{baseVersion,reason}` | Archivo lógico RETIRADO, incrementa versión; conserva inventario, referencias y cupo ocupado |
| POST `/catalog/products/:id/photos` | multipart: baseVersion, license, fotos[] | PNG/JPEG/WebP, hasta 8 archivos de 5 MiB; máximo 30 fotos visibles; respuesta producto actualizado |
| PATCH `/catalog/products/:id/photos/:resourceId` | `{baseVersion,visible}` | Oculta/muestra foto de galería sin borrar archivo ni historia |

Campo `coleccion` opcional/nullable. Variante: SKU máximo 60, barcode opcional/nullable máximo 80; IDs/códigos únicos dentro de la tienda. Variantes existentes requieren su `baseVersion`; nuevas usan null. Una variante ajena a la prenda se rechaza. Omitir variantes no las elimina: para retirar una, enviar `active:false`. La prenda publicada necesita una variante activa con precios vigentes en WEB/APP/TIENDA.

`prices` contiene enteros en centavos, positivos, máximo 100000000 por canal. Ejemplo: 5990 significa Bs 59,90. `discounts` opcional por canal: `{basisPoints,startsAt,endsAt}`; 1500 = 15%, intervalo positivo y fin futuro. Al editar precios se cierran vigencias actuales, se reemplazan programaciones futuras aún no utilizadas y se conserva historia. Después de la promoción se restablece el precio base.

Servicio: `mutateCatalog(tx,{actor,operationId,resolveResource?},CatalogMutation)`. Payload de alta/edición/archivo coincide con el de `OfflineIntentSchema`. A07 resuelve dependencias y versiones antes de llamar. `resolveResource` es una función interna de A08, nunca un campo aceptado del cliente; debe comprobar archivo, hash, propietario/tienda y formato. Sin ella, una referencia de recurso devuelve 409 `RESOURCE_NOT_READY`. En recursos AR/3D `variantId` es obligatorio al aplicar; web requiere modelo GLB validado, Android PNG transparente validado. No reemplazar una capacidad con una miniatura.

Actualizaciones del contrato antes de integración: SKU 80→60; barcode/coleccion/discounts/estado del parche; referencias admiten variantId; límite de conteo/delta del dominio 1000000. El parche vacío se rechaza sin defaults que creen cambios ficticios. Actualizar el paquete compartido y volver a verificar hashes de G0b. No reescribir UUID/payload/hash de intenciones ya encoladas; tratar compatibilidad explícitamente antes de migrar una cola del prototipo.

Fixtures ejecutables: `packages/contracts/fixtures/catalog-product-v1.json` y `online-transfer-v1.json`. Son datos sintéticos de contrato; sustituir IDs por entidades de la tienda al usar la API.

## Colección y comercio

GET `/catalog`: se conservan search, category, location, brand, color, size y channel. Añade minPriceMinor/maxPriceMinor (centavos, inclusivos) y sort (`featured`, `name_asc`, `newest`, `price_asc`, `price_desc`). Se usa el precio neto vigente y redondeado del canal; orden por menor precio de las variantes coincidentes. Devuelve `hasMore` y `asOf`; máximo 60 coincidencias por consulta, refinar filtros cuando hasMore sea true.

Checkout, cobro simulado y POS conservan rutas/cuerpos. Reutilizar el UUID al reenviar la misma operación, conservarlo hasta recibir respuesta. El mismo UUID de checkout/POS con otra solicitud devuelve 409. La reserva tiene 15 minutos; cobro y despacho descuentan físico una sola vez. La confirmación visual debe ocurrir después del éxito de la API y refrescar pedidos/reportes, no reemplazar la persistencia.

GET `/commerce/orders` añade `detalle_pedido[].returnEligible`: vendido menos cantidades aceptadas resueltas y cantidades reservadas por otras solicitudes activas. Una devolución rechazada no consume elegibilidad. POST `/commerce/orders/:id/returns` conserva reason/items y admite `idempotency` opcional para compatibilidad; clientes nuevos deben enviarlo. Mismo UUID con otros ítems/motivo devuelve 409.

PATCH `/admin/orders/returns/:id/review`: resolución de 10–400 caracteres (límite real de reembolso), UUID estable e ítems únicos. La revisión y cancelación guardan auditoría/resultado; reenvíos no duplican saldos ni reembolsos. La suma reembolsada jamás supera el pago confirmado. Las ventas brutas siguen en el reporte tras una devolución; las métricas independientes de reembolso las publicará A10/A11.

Para B13: consumir estos contratos, sin modificar API/Prisma. Para A07: comprobar autorización fresca y suscripción, dependencias/versión y hash; luego invocar el dominio dentro de la transacción que escribe el comprobante. Los servicios no implementan por sí solos bootstrap, cola offline, cifrado o subida de archivos.
