# A07 — protocolo del servidor offline v1

Fecha04/11/2026, rama `desarrollo/servidor-web`. RF14/15/34/38–44; CU21–23. Implementación API; no acredita todavía persistencia offline web ni integración Android. A08 prepara snapshots/medios; A09 implementa la copia web. Sin cambios en Android, workers, producción ni Word.

## API que deben consumir web y Android

Autenticación vigente y `X-Tenant-Slug` en todas las llamadas. HTTPS en despliegue. Respuestas privadas `Cache-Control: private, no-store`.

| Ruta | Solicitud | Respuesta |
| --- | --- | --- |
| POST `/api/offline/bootstrap` | `{deviceId:UUID}` | `OfflineBootstrap` validado por `BootstrapResponseSchema`: schemaVersion1.0, tenantId, actorId, deviceId, keyVersion1, keyBase64, permissions, locationIds, entitlements, issuedAt. No requiere token push. |
| POST `/api/offline/sync` | `{schemaVersion:"1.0",operations:OfflineIntent[]}` | `{results:SyncOperationResult[]}` en orden original; por operación **receipt o blocked**, nunca ambos. Lote1–100. |
| GET `/api/offline/operations/:operationId?deviceId=UUID` | Sin body | `OperationReceipt` del mismo actor/dispositivo y permiso/ámbito vigente. Ausente o ajeno404; permiso perdido403. |

Usar `@lumina/contracts`: `OfflineIntentSchema`, `canonicalIntentJson`, `SyncBatchSchema`, `OperationReceiptSchema`, `SyncOperationResultSchema`, `BootstrapResponseSchema` y tipos exportados. Las definiciones no se duplican en el móvil. Un cambio de forma del contrato debe coordinarse antes de enviar operaciones.

Una intención lleva schemaVersion,tenantId,actorId,deviceId,operationId,kind,entityId,baseVersion,dependsOn,createdAt,payload,payloadHash. `payload` es **objeto tipado**, no JSON dentro de string. Primero construir/validar `UnsignedIntentSchema`; calcular SHA256 del UTF8 de `canonicalIntentJson(unsigned)`; agregar payloadHash; conservar la intención completa sin cambiar fecha/UUID/campos entre reintentos. No incluir estado local ni campos de transporte dentro del hash.

Solo cinco tipos: CATALOG_CREATE, CATALOG_UPDATE, CATALOG_ARCHIVE, STOCK_DELTA y STOCK_COUNT. No pagos, ventas, transferencias ni generación de avatar en esta cola. Campos y límites exactos en `packages/contracts/src/offline.ts`.

## Identidad y claves

Una instalación genera y conserva UUID de dispositivo estable. Bootstrap deriva ámbito tienda/actor/dispositivo del login y petición; no acepta actorId arbitrario. Devuelve DEK de32bytes en base64 por TLS, que el cliente guarda en su almacén privado; **no loguear respuesta, clave, cola ni fotos**. La clave maestra nunca sale del servidor.

Persistencia de servidor: `configuracion`, namespace `offline-device:`+SHA256 de AAD canónica; solo envoltura AES256GCM con nonce12bytes/tag16bytes, versión, AAD y metadata. No usa tabla `dispositivo` ni tokens push, ni añade una tabla comercial. Ningún endpoint de configuración comercial expone este namespace.

Configurar `OFFLINE_MASTER_KEY` con32bytes aleatorios base64, exclusivamente en entorno servidor. Para rotar envoltura: `OFFLINE_WRAP_KEYS` es JSON `{ "1":"claveAnterior", "2":"claveNueva" }`, `OFFLINE_WRAP_KEY_VERSION=2`. Mantener anteriores para recuperar registros. Reenvoltura conserva la misma DEK y crea versión de configuración, cerrando la anterior. No rotar la DEK ni borrar pendientes al cambiar la clave maestra.

Clave ausente, desconocida, AAD/tag/ciphertext corrupto →503 `OFFLINE_KEY_UNAVAILABLE`. Conserva el registro y la copia cifrada; **nunca generar otra DEK como recuperación automática**. Reautenticar al mismo actor/dispositivo recupera la clave previa. Un error de red no significa logout ni permiso para borrar la copia. La revocación remota se conoce al reconectar; no prometer revocar un dispositivo desconectado al instante.

## Reglas de aplicación y recuperación

- Tienda/actor de cada operación deben coincidir con contexto autenticado. Otro dispositivo necesita su propio bootstrap. No cambiar actorId para reenviar una cola después de login de otra persona.
- Valida todo el lote, huellas, IDs repetidos y ciclos antes de aplicar. Un UUID duradero con otra carga recibe HTTP409 `IDEMPOTENCY_PAYLOAD_MISMATCH`; no modifica el comprobante previo.
- Cada intención tiene bloqueo por UUID y transacción comercial propia. Dominio + auditoría + comprobante se confirman juntos. Un fallo técnico revierte todo y devuelve bloqueo recuperable; el siguiente intento usa el mismo UUID. No reenviar con ID nuevo para “resolver” respuesta perdida.
- Una intención ya aplicada recupera **el mismo comprobante**, sin incrementar versión, stock o auditoría. La recuperación funciona después de vencer el plan, con identidad y permisos actuales. Nuevas escrituras vencidas reciben `blocked.code=SUBSCRIPTION_REQUIRED`; HTTP201 del lote no significa que todas se aplicaron.
- STOCK_DELTA suma al saldo global actual y protege reservado/comprometido. STOCK_COUNT exige baseVersion actual; si quedó vieja, receipt CONFLICT/VERSION_CONFLICT. No reemplazar saldo global con el saldo mostrado offline.
- `entityId` de stock es el ID estable de inventario para variante/ubicación. Si todavía no hay saldo, generar UUID una sola vez, baseVersion=null y usar STOCK_DELTA; el servidor crea con ese ID. Una identidad que no corresponde al par se rechaza/conflictúa, sin pisar otro saldo.
- Dependencias se procesan topológicamente aunque el lote venga desordenado. Deben ser APPLIED del mismo actor/dispositivo. Desconocida, rechazada, conflictiva o ajena produce `DEPENDENCY_BLOCKED` sin comprobante definitivo para la hija.
- CATALOG_UPDATE/ARCHIVE con baseVersion=null solo después de CATALOG_CREATE aplicado de la misma entidad. Usa la versión del comprobante padre y verifica que no haya cambiado; no cambia la base silenciosamente a la versión actual. Las ediciones posteriores necesitan versión explícita.
- Guardar catálogo reutiliza A05: precio por canal, variantes, archivo lógico y cupos. Archivar no libera cupo de productos. Permisos y asignaciones se consultan en servidor al aplicar, incluso si el cliente estuvo offline.
- Recursos no preparados devuelven bloqueo `RESOURCE_NOT_STAGED`. El staging corresponde a A08. No crear recursos ficticios ni eliminar referencias del payload para eludir la espera: cambiaría la huella.

## Interpretación del cliente

| Resultado | Acción local |
| --- | --- |
| receipt APPLIED | Marcar APPLIED y guardar el comprobante completo, verified tenant/actor/device/operation/hash. Incorporar confirmedVersion y datos confirmados. |
| receipt CONFLICT | Mantener intención original, mostrar saldo/versión/código del servidor y ofrecer reconciliación explícita. Una resolución nueva tiene UUID nuevo y referencia a la anterior. |
| receipt REJECTED | Conservar motivo y bloquear dependientes; no reenviar indefinidamente ni anunciar éxito. Decisión de descartar/editar visible. |
| blocked AUTH_REQUIRED/FORBIDDEN/DEVICE_NOT_REGISTERED | Mantener pendiente/bloqueada, reautenticar o corregir ámbito; no reinterpretar autor. |
| blocked SUBSCRIPTION_REQUIRED/CAPACITY_EXCEEDED | Conservar cola hasta renovar/ampliar capacidad; no comprobante terminal. |
| blocked DEPENDENCY_BLOCKED/RESOURCE_NOT_STAGED | Resolver padre/subida primero; conservar identidad/hash de la hija. |
| blocked SERVICE_UNAVAILABLE/BUSINESS_BUSY | Reintentar con espera creciente y jitter; consultar comprobante si se perdió la respuesta. |

## Adaptación concreta de B, inspeccionada en aa8d8e9

`apps/mobile/src/offline/bootstrap.ts` usa `/offline/key/bootstrap` y `{dek,rotated}`; cambiar al endpoint anterior y tipo compartido `OfflineBootstrap`, usando `keyBase64`. No sustituir una clave local existente por una clave distinta sin migración verificada.

`syncQueue.ts` envía `{deviceId,operations}` con payload string y consume `{receipts}`. Ese prototipo **no es compatible** con v1. Adaptar persistencia para guardar identidad, entityId, fecha y huella estable en la intención; el envío usa `{schemaVersion,operations}` completo, y el retorno usa results individuales. `serverVersion` pasa a `confirmedVersion`; `result.message`/`blocked.message` están separados. Mantener `DISCARDED` como estado local y nunca como estado de servidor.

Antes de migrar prototipo con pendientes, preservar copia cifrada y claves; no inventar createdAt/huella distintos en cada reintento ni recrear una operación que pueda haber sido aplicada. Inventariar recibos y formato legacy al integrar A15. El prototipo B usa almacenamiento de claves distinto; A15 requiere importar/reenvolver su DEK existente cuando corresponda, sin borrarla. La rama de A no integra a ciegas su API/Prisma fuera de propiedad de B.

## Evidencia

04/11/2026: `npm test -- --cacheDirectory .local/jest` → **38 suites/202 pruebas aprobadas**,219.528s; incluye21 pruebas offline. `npm run build` y `npm run test:shared` → aprobados,14 contratos. Advertencia de bundle894.01kB pendiente A09. Logs locales `a07-full.log`, `a07-build.log`, `a07-shared-final.log`. No se excluyeron suites en esta regresión.

Pruebas HTTP con PostgreSQL real aislado por tenant, no mocks del dominio. Bootstrap recuperable, AESGCM/AAD incorrecta, corrupción sin reemplazo, rotación, dos tiendas/actores/dispositivos, pérdida de respuesta/reenvío concurrente, deltas, conteo viejo, archivo/edición dependiente, rollback tras campos parcialmente modificados, y fallo de persistir comprobante inyectado con trigger temporal de base QA. Dos sesiones HTTP separadas aplican deltas concurrentes contra la misma API. Los archivos `offline-sync`, `offline-keys`, `offline-receipts`, `offline-isolation` reproducen estos casos.

RED inicial6 pruebas por rutas404. Después se reprodujo un fallo real de persistencia: recibida_en se asignaba después de committedAt y violaba el orden temporal de la tabla; se captura recepción antes de procesar. Contrato BootstrapResponse RED por export ausente→GREEN.

No es evidencia de APK físico, ni de SQLite/Hermes integrado, ni de almacenamiento IndexedDB. **G2 completa queda pendiente** de clientes web/Android reales A09/B08; el protocolo servidor está listo para esa integración. No se ha desplegado ni creado una suscripción real.
