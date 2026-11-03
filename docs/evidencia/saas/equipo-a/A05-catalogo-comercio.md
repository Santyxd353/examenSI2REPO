# A05 — Catálogo, inventario y comercio

Fecha: 03/11/2026. Base: a5db123. Rama: desarrollo/servidor-web.
Alcance: RF08–RF16 y RF25–RF34; servicios reutilizables para A07, sin modificar Android ni workers.
Validación exclusivamente local en PostgreSQL 18, `127.0.0.1:55418`, bases de prueba y tiendas temporales. Sin migraciones ni escrituras en la VM.

## Cambios

- Catálogo: alta estructurada, edición con versión, archivo lógico (`RETIRADO` en la BD), categoría/colección/marca/material, variantes y códigos únicos, precios en centavos por canal, promociones con vigencia, galería editable y versiones de recursos. El catálogo público filtra por precio vigente/canal y ordena antes de limitar a 60 prendas; declara `hasMore`.
- Web: editor de prendas y variantes, promociones, fotos visibles/ocultas, archivo y búsqueda administrativa; filtros públicos de precio/orden. Importes visibles con dos decimales. Mantiene el diseño de Lúmina.
- Inventario: `applyStockDelta`, `applyStockCount` y `transferStock` reciben la transacción del llamador; bloquean saldos en orden, validan permisos/asignación/ubicaciones activas y guardan movimientos y auditoría juntos. Altas nuevas empiezan en versión 1.
- Transferencias: `ONLINE_TRANSFER` usa comprobante atómico en `operacion_sincronizacion`. Mismo UUID/payload/dispositivo/actor devuelve la respuesta guardada; otro contenido devuelve 409. No entra en los cinco tipos offline.
- WEB/APP/POS: UUID serializado y hash del pedido en la instantánea comercial; reintentos concurrentes no duplican pedido, pago ni stock. Carritos por actor/canal coordinados con checkout. La web conserva UUID tras una respuesta perdida.
- Devoluciones: las solicitudes activas reservan cantidades; las resueltas descuentan solo cantidades aceptadas. Revisión, cancelación y reembolso comparten bloqueo por pedido. Redondeo acumulativo exacto en centavos, límite contra reembolsos previos y auditoría de UUID. Solicitud de devolución admite UUID opcional para clientes antiguos.
- Reporte actual: las ventas pagadas y después reembolsadas siguen en las ventas brutas; las canceladas y pendientes quedan fuera. Métricas separadas de devolución/reembolso y motor común corresponden a A10/A11.
- Reservas: barrido por todas las tiendas, incluidas las de solo lectura, con conexión temporal liberada por tienda y prevención de ejecuciones superpuestas. Libera reservas vencidas sin depender del tráfico del cliente.
- Direcciones: cambios concurrentes dejan una sola predeterminada; editar campos no desmarca implícitamente la predeterminada. Los pedidos conservan su instantánea histórica.
- Multipart de catálogo: revalida sesión, permiso y suscripción antes de confirmar los archivos; fallo de BD elimina únicamente los archivos de esa petición.

## Evidencia de defectos y corrección

Las pruebas RED reprodujeron: UUID concurrente sin recuperación, transferencia sin comprobante, devolución de 3 solicitadas/2 aceptadas que bloqueaba la unidad restante, pago de 150 con reembolso previo de 50 que terminaba devolviendo 200, revisión concurrente duplicada/rechazada, direcciones concurrentes, pago simultáneo tras leer el mismo estado y venta bruta que desaparecía al completar un reembolso.

Se corrigieron también supuestos de los fixtures: el estado histórico para archivo es `RETIRADO`, el movimiento del cobro es `SALIDA` y una reserva vencida conserva fecha de creación anterior al vencimiento. No se cambiaron resultados esperados de cantidades ni dinero para acomodar la implementación. Los tests anteriores de recursos ahora limpian su auditoría antes de eliminar exclusivamente usuarios de prueba.

Resultados finales del 03/11:

- `npm test -- --cacheDirectory .local/jest`: **29 suites, 160 pruebas aprobadas**, sin omisiones, 137,85 s.
- `npm run test:shared`: **12 pruebas aprobadas**.
- `npm run build`: contratos, API y web compilan. Vite mantiene aviso de bundle principal mayor de 800 kB; revisar división de módulos al preparar el shell offline A09.
- `node scripts/check-admin-ui.cjs`: recorrido Chromium aprobado, incluida edición/galería/archivo y venta persistida. El script consulta la BD para comprobar las operaciones.

No se ejecutó la app Android ni se generó un APK en este bloque.

Chromium verificó edición/precio persistido, carga y ocultación de foto, archivo conservando historial, venta persistida, navegación y permisos de tres roles. Capturas locales `catalog-editor-mobile.png` y `catalog-editor-desktop.png` revisadas: sin desbordamiento a 390 px y 1440 px. No equivalen a una prueba en Android físico.

## Límites e integración

La ampliación no está desplegada. Las pruebas APP ejercitan la API con el canal APP; falta aceptación con el APK en A15/B15. El procesador offline, staging cifrado y manifiestos aún corresponden a A07/A08. `mutateCatalog` admite referencias de recursos únicamente mediante un resolvedor interno de archivos validados; una referencia sin cargar se rechaza. La validación y publicación completa de GLB y el recorrido del vestidor se verifican con A06/A08; este bloque no acredita que ya existan esos modelos para cada prenda.

Las cargas antiguas de galería/AR siguen funcionando. El contrato anterior de transferencia sin UUID se conserva para APK antiguos, pero solo las peticiones con `operationId` y `deviceId` obtienen garantía de reenvío. A07 reutilizará el dominio para ajustes/conteos offline con comprobante; las rutas online históricas de ajuste/conteo mantienen su DTO.

Consultar [handoff A05 para Android y sincronización](A05-handoff.md) antes de adaptar B13.
