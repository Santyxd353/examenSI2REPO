# A15 — Integración en curso

Fecha: 7 de noviembre de 2026 (Bolivia).

**Estado: avance local; G6 todavía no está congelada.** No se ha desplegado en una VM ni se ha ejecutado un APK.

## Base y resolución de interfaces

La rama de trabajo `integracion/android` combina la base Android `aa8d8e9` con el servidor/web `89344b2`. Se conservaron los servicios A de autorización, facturación, inventario, recibos, reportes, análisis y las migraciones canónicas. Los prototipos de servidor de B no sustituyen esas implementaciones.

Android utilizaba otro bootstrap y enviaba operaciones sin ámbito, entidad, fecha ni hash. Se adaptó a `/offline/bootstrap`, al lote firmado de `@lumina/contracts` y a los resultados con recibos verificados por operación, cuenta, dispositivo y hash. Una respuesta incompleta o ajena no confirma la cola.

Las operaciones antiguas incompletas se conservan cifradas y bloqueadas para revisión. No se inventan SKU, precios o versiones faltantes. Descartar un bloqueo conserva su historial y bloquea sus dependencias; una corrección requiere una intención nueva.

## Incremento móvil

- SQLite confirma conjuntamente la intención y su proyección. Los datos comerciales y las copias de reportes se cifran con AES-GCM y contexto de cuenta/registro.
- El cierre de sesión bloquea inmediatamente el acceso local. La persistencia de tokens y claves está serializada para impedir que una escritura tardía restaure la sesión. Se conservan las claves históricas necesarias para recuperar pendientes al volver a autenticarse.
- Catálogo e inventario utilizan cortes paginados completos, con hashes de página y documento. Los formularios generan altas, ediciones, retiros, deltas y conteos reales en la cola. La reconexión intenta sincronizarlos.
- Reportes consume los conjuntos A11 y el motor compartido A10: métricas, agrupaciones, comparaciones, veinte filtros, gráficos, filtros desde el gráfico, detalle, CSV y copia cifrada para reapertura offline.
- El asistente utiliza A12: audio M4A/AAC limitado a treinta segundos, transcripción editable, propuesta revisable y aplicación explícita desde los filtros. Sin conexión se mantienen los filtros manuales.
- Análisis de datos utiliza A13: trabajos durables, selección de datasets/modelos/pronósticos, permisos por plan, métricas con referencia o N/A, segmentación del resultado descargado y propuestas de reposición sin movimientos de stock.
- Mi negocio interpreta los derechos reales de `/tenant/subscription`, incluidos reservas de consumo, precio BOB, vencimiento y solo lectura.
- El acceso al espacio de trabajo depende de permisos, también para vendedor y analista. El inicio del vendedor no solicita reportes sin autorización; un módulo revocado vuelve al inicio y el bloqueo de sesión limpia los datos visibles. Mi negocio requiere el permiso específico de suscripción.

Estas funciones tienen comprobación de lógica y compilación; ello no equivale a aceptación visual o funcional en un teléfono físico.

## Escenarios comprobados contra la API

`apps/api/test/saas-acceptance.test.ts` utiliza dos tiendas temporales distintas:

1. Compra WEB, compra APP y venta TIENDA: tres pedidos, Bs 150, cada canal una vez. Repetir confirmaciones no duplica pedidos. El conjunto descargado por el adaptador móvil coincide con la ejecución del motor en el servidor. La otra tienda no ve esas ventas ni ese conjunto.
2. Desde diez unidades, el protocolo móvil aplica +3 y el endpoint web aplica −2: quedan once. Un conteo de versión antigua conserva un conflicto y no reemplaza las once unidades.
3. Esencial conserva reportes manuales y rechaza entrenamiento. Profesional acepta un trabajo durable y el adaptador móvil interpreta la lista `{ jobs }`; repetir la solicitud recupera el mismo trabajo.

`apps/api/test/mobile-client.test.ts` comprueba el cliente real con almacenamiento nativo simulado: respuesta tardía, cambio de tienda, logout durante escritura y revocación confirmada por el servidor.

## Verificación local

Entorno de trabajo: Node 22, Expo 57, PostgreSQL 18 local. Las compilaciones y las pruebas se realizan en el volumen D por el espacio disponible; los datos de QA usan el puerto local 55419. No utilizan la base comercial publicada.

Resultados observados hasta este avance:

| Comprobación | Resultado |
| --- | --- |
| Contratos y motor compartido | 25 pruebas aprobadas |
| Unitarios móviles, incluido SQLite real y WebCrypto en Node | 75 pruebas aprobadas |
| TypeScript móvil | Aprobado |
| Compatibilidad de dependencias Expo | Aprobada |
| Exportación Android/Hermes | Aprobada: 1195 módulos, bundle de aproximadamente 3,8 MB |
| Compilación API/web | Aprobada |
| Suite completa API tras integrar pagos y compatibilidad de recibos anteriores | 49 suites y 243 pruebas aprobadas, sin omitidas; repetición por archivo, 978 segundos de procesos |
| Pagos y regresión de comercio | 3 suites y 18 pruebas aprobadas; QR y Stripe con proveedor simulado |
| Regresión de reintento web en la misma pestaña | 2 pruebas adicionales aprobadas |
| Recorrido Chromium offline de vestidor y sincronización | Aprobado: diez prendas, avatar, reapertura, recuperación, conflicto y reenvío sin duplicación |
| Recorrido Chromium de reportes | Aprobado: corte, propuesta de voz con proveedor simulado, revisión, diseño guardado, reinicio offline, filtros, CSV y PDF |
| Administración web | Aprobada: módulos, ancho móvil, venta persistida y confirmación visual |
| Compra QR en Chromium | Aprobada: escritorio/390 px, confirmación desde APP, reapertura, un pago y una salida de stock |
| Mostrador con flujo Android contra API real | Aprobado en la suite de aceptación: respuesta perdida, reapertura, un pedido TIENDA y aparición única en reportes junto con WEB/APP |
| Uso de APK en dispositivo | Pendiente; no ejecutado por este agente |

Los unitarios criptográficos usan AES-GCM de WebCrypto y SQLite de Node para comprobar la persistencia. La implementación Android usa Expo Crypto/SecureStore/SQLite y todavía requiere la comprobación nativa correspondiente.

### Descargas nativas para el vestidor AR

El catálogo Android abre «Descargas sin conexión». La clienta guarda marcas, categorías, tallas y colores preferidos; el servidor selecciona hasta diez prendas compatibles mediante el manifiesto privado A08. La pantalla informa cuántas prendas llegaron, la fecha de preparación, las limitaciones y los recursos pendientes. Permite continuar, verificar y eliminar la descarga.

Los PNG se descargan con la sesión APP y la tienda actual, verifican longitud y SHA-256 y se persisten cifrados. Un reemplazo incompleto conserva el último paquete íntegro. Al probar una prenda se descifra en memoria y se abre la cámara con su anclaje de vestido, falda o parte superior; al volver se conserva la pantalla de descargas. El logout bloquea el acceso al ámbito anterior. La superposición AR sigue siendo orientativa y no representa una simulación física de ajuste.

Las pruebas cubren reapertura, descarga parcial, corrupción y reparación, reemplazo, URLs ajenas, aislamiento, PNG en memoria y eliminación por ámbito. Los registros privados nuevos rechazan contenido sin sobre cifrado; los registros históricos de cola en texto claro se conservan bloqueados para revisión y no se reenvían automáticamente. La exportación Hermes de este incremento tiene SHA-256 `46986EA6584D1E14C89DA7FC97DE464E5013BF2235966C781C0DDE39AF65BA85`; no constituye una prueba de cámara en dispositivo ni un APK firmado.

La suite del manifiesto privado pasó sus cuatro pruebas y utiliza el descargador nativo contra los archivos reales de la API: las diez prendas se verificaron y quedaron disponibles para abrirlas en memoria. El cliente de transporte pasó seis pruebas, incluida una respuesta binaria tardía tras cambiar de tienda. El primer intento de la suite excedió el tiempo de preparación porque PostgreSQL local estaba recuperándose; se repitió con la base disponible y pasó en 26 segundos, sin ampliar los tiempos de las operaciones.

El primer recorrido completo encontró dos dependencias de entorno: faltaba el GLB de referencia generado y se mezclaban declaraciones de transporte de Node/React Native. Se preparó el fixture y se corrigieron los tipos sin desactivar el chequeo móvil. Ambos casos de avatar y los casos del cliente móvil fueron repetidos con resultado favorable. Un cierre de fixtures necesitó un timeout de limpieza mayor debido a un checkpoint de disco de 38 segundos; no se amplió el tiempo de las operaciones comerciales.

El recorrido web detectó además una carrera real: reintentar mientras terminaba un envío automático de la misma pestaña devolvía el aviso de otra pestaña y dejaba la cola pendiente. Los disparadores de cada sesión ahora se serializan dentro de la pestaña; se conserva el bloqueo entre pestañas. Se comprobó la cancelación de un turno en espera y se repitió el recorrido completo con resultado favorable.

Para repetir los escenarios de integración con un PostgreSQL local preparado:

```powershell
node scripts/check-saas-integrated.cjs
```

`--full` ejecuta cada suite de API en un proceso nuevo; `--api-only` omite los chequeos móviles. `SAAS_QA_DATABASE_URL` permite seleccionar la instancia local de prueba y `SAAS_QA_OUTPUT_DIR` dirige los logs. El resumen conserva SHA, estado de modificaciones locales, códigos de salida y rutas de evidencia. No convierte una copia con cambios en un candidato congelado.

## Pendientes antes de G6

- Cerrar A06/B14: regeneración de avatar sin fotos purgadas y evidencia de inferencia válida desde fotos reales autorizadas.
- Aceptación en dispositivo: cierre y reapertura, pérdida de red, claves, cámara, audio, conflictos y dashboards offline. La compilación Hermes no sustituye estas pruebas.
- Revisión final de la rama y trazabilidad RF/CU. Las métricas analíticas siguen siendo de demostración sintética; su calidad y limitaciones se conservan en A13.
- Completar las comprobaciones de publicación de A16. Las diez alertas iniciales de dependencias de producción ya se resolvieron: la auditoría actual informa cero en API/web y Android; la instalación aislada conserva las herramientas de migración y excluye Jest/Vite. La auditoría que incluye herramientas de desarrollo aún tiene alertas. El build Linux y el arranque del contenedor siguen pendientes. Véase [A16 — preparación local](A16-preparacion-local.md).

La VM nueva, el despliegue, las credenciales reales de proveedores, la firma/distribución final del APK y el cierre del Word corresponden a los bloques posteriores. No se han ejecutado operaciones sobre la VM anterior.
