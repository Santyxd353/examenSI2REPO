# A15 — integración de revisión de conteos

Fecha: 08/11/2026. Rama: `integracion/android`. Base: `ffec846`. Cambios entrantes de `desarrollo/android-ml`: `ed94551` y `1557824`.

## Comportamiento integrado

- El catálogo público web deja de mostrar el desglose de existencias por sucursal o almacén. El módulo administrativo de inventario conserva su consulta por ubicación.
- Android reconoce conteos pendientes de la misma variante y ubicación en el formato canónico de sincronización. Indica que deben revisarse antes de registrar otro conteo.
- Un conteo en conflicto permite consultar el inventario actual del servidor y comparar cantidad física, versión y unidades reservadas/comprometidas. Esta consulta requiere conexión y permiso para gestionar inventario.
- La administradora confirma expresamente que la cantidad guardada sigue siendo la observada. Se conserva el intento anterior como descartado con historial y se crea otro UUID, fecha, versión y hash; el recibo anterior no se reutiliza. Si el servidor vuelve a cambiar, el nuevo intento puede producir otro conflicto.
- El reemplazo local es una transacción SQLite. Se rechazan identidades ajenas, versiones inválidas, UUID repetidos y operaciones con dependientes sin resolver. Un estado tardío de sincronización no reactiva un intento descartado ni degrada uno aplicado.

## Compatibilidad conservada

La rama entrante todavía utilizaba la API y los registros offline anteriores. Se conservaron el servidor transaccional canónico, el arranque con lease y versiones de claves, el almacén cifrado de cortes completos, la validación de comprobantes y las protecciones del cliente HTTP. No se reintrodujo `apps/api/src/offline-sync.ts` ni una segunda copia de inventario con reglas distintas. Las mejoras de conteo se adaptaron a los componentes vigentes.

Se incorporó la lectura del sobre AES combinado. La escritura conserva el formato persistido v1 de nonce, contenido y tag para mantener compatibilidad; los bytes se obtienen con una sola llamada al sobre combinado de Expo. La conversión une bytes decodificados, valida base64 y respeta el límite existente de 50 MiB. Los registros históricos en texto claro continúan bloqueados para revisión: esta integración no autoriza su reenvío automático.

Los estados locales conservan `DISCARDED` y `BLOCKED`; no se creó una segunda máquina de estados `SUPERSEDED`/`REJECTED`. Los comprobantes del servidor mantienen sus estados propios.

## Evidencia

Las regresiones nuevas fallaron antes de adaptar el código: faltaban las funciones de compatibilidad y reemplazo, no se reconocía un conteo dentro del sobre canónico y se aceptaban reservas negativas. Otra regresión demostró que un estado tardío reactivaba el conflicto descartado. Las correcciones se comprobaron con SQLite real y AES-GCM de WebCrypto en Node, incluida reapertura con UUID/hash nuevos y conservación del historial cifrado.

La compilación API/web y TypeScript móvil aprobaron. El recorrido Chromium de compra volvió a aprobar en escritorio y 390 px: dos escaneos APP de un pedido WEB producen un pago, una salida de stock y nueve unidades restantes; la confirmación persiste al recargar. Se revisaron las dos capturas.

La implementación de API y sus dependencias no cambiaron respecto de `ffec846`, donde la regresión completa aprobó 49 suites y 243 pruebas. El conjunto móvil final aprobó **83 pruebas**, sin omitidas, en 21 segundos; TypeScript y la compilación API/web aprobaron. La exportación Android/Hermes aprobó **1196 módulos**, aproximadamente 3,8 MB, con SHA-256 `A81F9CBF840029A96AFD66A3FC4506A0109F637E87BF564E242053BB62E395EE`.

Las pruebas de compatibilidad reconstruyen los segmentos base64 con padding sin perder bytes y verifican que la escritura conserva los tres campos del formato anterior. No equivalen a ejecutar Expo Crypto sobre un teléfono; esa comprobación permanece dentro de la aceptación nativa pendiente.

No se ejecutó el APK, no se modificó la VM y este incremento no cierra la aceptación física Android, A06/B14 ni G6.
