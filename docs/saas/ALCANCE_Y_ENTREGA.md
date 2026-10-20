# Lúmina SaaS — alcance de la segunda entrega

Fecha de inicio: 20/10/2026. Objetivo de entrega: 27/10/2026.

## Decisiones confirmadas

Varias tiendas independientes contratan planes de suscripción y reciben su propio espacio. Cada negocio administra catálogo femenino, personal, ubicaciones, inventario, pedidos, reportes y recursos del vestidor. El inventario y los dashboards deben funcionar sin conexión tanto en web como en Android. Las suscripciones usarán Stripe y una alternativa QR explícitamente simulada.

La funcionalidad descrita aquí es alcance de desarrollo, no una declaración de que ya está implementada. La evidencia de avance se mantiene en ESTADO.md. El documento ICONIX final deberá distinguir funciones verificadas, límites de la entrega y trabajo futuro.

## Organización de la administración

| Módulo | Responsabilidad |
| --- | --- |
| Inicio | Indicadores generales, alertas y actividad reciente |
| Catálogo y vestidor | Prendas, variantes, imágenes, recursos RA/3D y publicación |
| Inventario | Sucursales, almacenes, existencias, ajustes, conteos y transferencias |
| Ventas y pedidos | Mostrador, compras web/APP, pagos, preparación, devoluciones e historial |
| Clientes | Perfiles y direcciones dentro del negocio autorizado |
| Equipo y permisos | Personal, roles y alcance por ubicación |
| Reportes y dashboards | Constructor, filtros, gráficos, plantillas guardadas y exportaciones |
| Análisis de datos | Predicción de demanda, anomalías y recomendaciones evaluadas |
| Sincronización | Descargas, operaciones pendientes, errores y resolución de conflictos |
| Mi negocio y suscripción | Identidad de la tienda, plan, límites y estado de pago |

El operador de la plataforma tiene un área separada para tiendas, planes, suscripciones y soporte. Ser administrador de una tienda no concede acceso a otra ni al control global.

## Base SaaS

Se conserva NestJS/React/React Native/PostgreSQL y se separa el código por módulos. Se compararon base compartida con identificador por fila, base por tienda y despliegue completo por tienda. Para la entrega de una semana se elige una base por tienda en el mismo PostgreSQL: permite reutilizar las consultas SQL existentes y demostrar aislamiento sin migrar todas las relaciones de negocio a claves compuestas. El coste es mantener migraciones por base y limitar conexiones por tienda. No se crea una VM por cliente.

Las sesiones incluyen la tienda. La selección de tienda es validada en el servidor y también se aplica a archivos, trabajos en segundo plano, eventos en tiempo real y almacenamiento offline. Lúmina existente se conserva como tienda inicial.

Los precios y límites de los planes serán configurables. Stripe se implementará mediante Checkout y webhooks autenticados e idempotentes; una redirección del navegador no prueba el pago. QR simulado registra su condición de demostración y auditoría. No se informará un cobro real sin credenciales y confirmación verificable del proveedor.

## Trabajo offline

**Cliente.** Descarga un paquete de hasta diez prendas con recursos compatibles, metadatos y versiones, seleccionado por preferencias, favoritos e interacciones. Sin historial se usan gustos declarados y una selección inicial explícita. El paquete incluye los archivos necesarios para la experiencia soportada, con verificación de integridad y estado de descarga. El seguimiento RA actual se ejecuta en el teléfono; el visor 3D web y la superposición RA móvil se documentan como experiencias diferentes. Descargar un PNG no se describirá como descargar un modelo 3D. La generación de un avatar desde fotografías sigue requiriendo procesamiento en servidor.

**Administración.** SQLite en Android e IndexedDB y caché de aplicación en web. Se permiten altas, ediciones, archivo lógico y movimientos de inventario sobre datos previamente descargados. Cada operación conserva un UUID, dispositivo, tienda, versión de base y estado de envío. La cola sobrevive al cierre de la aplicación. Los aumentos de stock se envían como movimientos, no como sustituciones del saldo global. Reintentar una operación no duplica el movimiento.

Las modificaciones incompatibles, conteos simultáneos, permisos revocados y stock insuficiente se muestran como conflictos. El servidor revalida permisos, suscripción y reglas al sincronizar. Eliminar una prenda con historial significa archivarla. Las ventas online y sus reservas conservan su confirmación transaccional en servidor; vender sin conexión no forma parte de los requisitos offline confirmados.

## Reportes y dashboards

Filtros iniciales: período y comparación, tienda autorizada, sucursal/almacén, canal, vendedor, categoría, marca, producto, talla, color, estado del pedido, estado/método del pago, devoluciones, precio y stock. Dimensiones, métricas, agrupación temporal, orden, límites y tipo de gráfico forman una definición guardada de reporte.

Los dashboards permiten cambiar filtros, cruzar selecciones, consultar detalle y guardar diseños. Sin conexión siguen siendo interactivos dentro del conjunto descargado, con cobertura y fecha de actualización visibles. No se fingirá disponibilidad offline de filas que nunca se descargaron.

Con conexión, texto o voz se transforma en una definición estructurada de reporte que el servidor valida. La IA elige filtros y visualizaciones del catálogo permitido; los números se calculan con consultas autorizadas. No ejecuta SQL arbitrario ni inventa resultados. Sin internet quedan disponibles filtros, definiciones y datos locales; la transcripción y la interpretación remota requieren conexión.

## Machine learning

Casos concretos: predicción de demanda por prenda/ubicación, alertas de comportamiento inusual y apoyo a reposición; personalización del paquete offline. Los modelos deben tener entrenamiento, versión, período de datos, comparación con una referencia simple y métricas de error sobre datos posteriores al entrenamiento. Se evaluarán por separación temporal, sin usar información futura.

Al revisar producción el 20/10/2026 había siete ventas confirmadas, nueve unidades y cinco variantes vendidas. Esto no basta para evaluar una predicción comercial fiable. Se admite importar historial autorizado y usar datos sintéticos identificados para demostrar entrenamiento. Una tienda con datos insuficientes muestra esa limitación y reglas de stock configuradas; no una predicción presentada como fiable.

## Documento ICONIX

Requisitos y reglas de negocio → modelo de dominio → actores/casos de uso con flujo principal y alternos → análisis de robustez (frontera, control y entidad) → secuencias → clases de diseño → implementación y pruebas. Se incorporan modelo de datos, arquitectura SaaS y sincronización como soporte del diseño. Cada requisito debe enlazar caso, diagramas, módulo, código y evidencia de prueba. Las pruebas se documentan con resultados realmente ejecutados al avanzar el sistema.

Se mantienen Grupo 18, integrantes en orden alfabético, dos carátulas y navegación del índice del informe anterior. El documento nuevo se generará como archivo separado y se verificará visualmente.

## Orden de entrega

1. 20–21/10: base SaaS, aislamiento, planes y administración por módulos.
2. 21–23/10: sincronización durable y paquete de prendas offline; inventario web y Android.
3. 23–24/10: constructor de reportes y dashboards offline con la misma definición de filtros.
4. 24–25/10: lenguaje natural/voz, Stripe/QR simulado y modelos ML evaluados.
5. 26/10: integración, pruebas de dos tiendas, pérdida de conexión, concurrencia y actualización del APK.
6. 27/10: verificación de despliegue y cierre del documento ICONIX con evidencia.

Este orden expresa prioridades y dependencias. Cualquier cambio de alcance se registra aquí y en los casos de uso antes de declararlo entregado.

## Referencias técnicas

- Microsoft, SaaS y multitenencia: https://learn.microsoft.com/en-us/azure/architecture/guide/saas-multitenant-solution-architecture/
- Microsoft, modelos de aislamiento: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
- Expo, persistencia local: https://docs.expo.dev/guides/local-first/
- MDN, IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- scikit-learn, evaluación temporal: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
- Rosenberg y Stephens, Use Case Driven Object Modeling with UML: https://link.springer.com/book/9781430243052
