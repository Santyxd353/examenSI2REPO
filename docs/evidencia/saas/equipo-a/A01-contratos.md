# A01 — Contratos compartidos v1 / G0a

Fecha: 02/11/2026. Estado: VERIFICADO_LOCAL. G0b Android pendiente de equipo B.
Rama A: desarrollo/servidor-web. Base de implementación: 554a595.

## Paquetes y uso

`@lumina/contracts` y `@lumina/reporting` son paquetes CommonJS locales con
declaraciones TypeScript. Ejecutar npm ci y npm run build:shared desde raíz.
API conserva rootDir/src y dist/api/main.js. Reporting exporta solo interfaces
en esta etapa; la implementación real del motor llega en A10.

Raíz consume file:packages/contracts y file:packages/reporting. B agrega las
referencias file:../../packages/contracts y file:../../packages/reporting en
mobile y actualiza únicamente su lock. Verificar Metro/Hermes antes de G0b.

## Intención HTTP, distinta del registro de cola local

Ver `packages/contracts/fixtures/offline-intent-v1.json` y los tipos de
`packages/contracts/src/offline.ts`. La intención de transporte contiene
schemaVersion, operationId, tenantId, actorId, deviceId, kind, entityId,
baseVersion, dependsOn, createdAt, payload tipado y payloadHash. No contiene
state ni payload como string. La fila local puede conservar ambos por separado.

Para firmar: persistir primero UUID/createdAt, validar UnsignedIntentSchema,
usar canonicalIntentJson y SHA256 UTF8; guardar hash/cuerpo inmutables.
No firmar JSON.stringify de un objeto privado móvil. El fixture fija el hash.
El parser rechaza keys extra, saldos absolutos en delta, tipos no admitidos,
NaN, dependencia propia/repetida y conteos sin versión. Los estados locales
incluyen DISCARDED; REJECTED es estado de recibo servidor, no de cola.

Producto de alta: `payload.product` con id/nombre/descripcion/material/marca,
categoriaId/variants/resources. Variantes llevan id,sku,talla,color,prices
{WEB,APP,TIENDA} en centavos, active/baseVersion. Edición: payload.patch con
campos permitidos; archivo: payload.reason. No enviar todo el producto como
edición sin versión. Recursos usan clientResourceId/hash estable antes de upload.

Los recibos devuelven identidad/hash/estado/resultado/version/correlationId.
Cada resultado del lote tiene recibo o bloqueo, exclusivamente. Las rutas de
sync/bootstrap/snapshot continúan pendientes hasta A07/A08; el paquete no
acredita que esos endpoints estén implementados.

## Cifrado y compatibilidad B

Sobre v1: schemaVersion1.0, algorithm A256GCM, keyVersion, nonce base64 de12bytes,
ciphertext base64, tag base64 de16bytes y aad canónica. Adaptar el sobre B
agregando schemaVersion/keyVersion; no regenerar DEK ni rotar al fallar decrypt.
A07 recuperará claves por tienda/actor/dispositivo en configuracion privada.
La ruta B offline/key/bootstrap se revisará como alias compatible; no conservar
una séptima tabla comercial creada dinámicamente en cada solicitud.

## Reportes y jobs

DSL: ver reports.ts y fixture report-golden-v1.json. Datos tienen identidad,
procedencia, fechas/cobertura/columnas/hash y hechos separados sales/orders/
payments/returns/refunds/stock. Golden:22000centavos,4unidades,2pedidos,
ticket11000; devolución1/reembolso5000 por separado; disponible7.

No inferir tickets o métodos de pago desde el panel ML de demanda. La fila de
reporte descargada no es la misma entidad que una serie de entrenamiento.
ReportDefinitionSchema valida el ejemplo rector, límites10/5/20 y granos.
No se incorpora asistencia IA offline por regex: offline conserva filtros
manuales y ejecución del dashboard; texto/voz del CU25 requiere proveedor online.

AnalyticsJobSchema corresponde a la CLI B03; fixture analytics-job-v1.json.
Admite identificadores demo; valida5acciones/horizontes7/30/workDir privado.
HTTP público no permitirá que el usuario elija rutas/artifactos del servidor.
Nota para integración B03/A16: discovery de raíz por .git en job_schema.py no
funcionará en la imagen publicada que no copia Git. B debe recibir raíz privada
explícita/configurada y validarla, sin crear un .git ficticio ni copiar secretos.

## Verificación observada

- RED observado: paquete y consumidor API inexistentes antes de implementación.
- `npm run test:shared`:11/11 aprobadas, incluyendo hash/centavos/DSL/jobs/sobre
  y orden Unicode canónico con prueba RED→GREEN.
- `npm run build`: paquetes, API y web aprobados.
- `node scripts/check-shared-bundles.cjs`: import real en API CommonJS y Vite/
  Chromium con WebCrypto; mismo JSON canónico, hash SHA256 y precio29900.
- `npm test`:18suites,100/100 aprobadas sobre el incremento.
- `node scripts/check-admin-ui.cjs`: administración/venta/ancho móvil aprobados.
- Docker copia paquetes antes de npm ci y conserva sus destinos en runtime.
  La construcción/arranque de imagen completa se verificará en A16.

Pendiente externo: B ejecuta fixture en Hermes/ExpoCrypto y confirma consumo
de paquetes. A01/G0a permite avanzar; G0b todavía no se anuncia aprobado.
