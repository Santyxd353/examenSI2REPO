# Lúmina SaaS — alcance de la segunda entrega

Base inicial: 20/10/2026. Replanificación confirmada: 31/10/2026.
Objetivo de entrega: 07/11/2026. Primero se cierra el documento ICONIX;
después se implementa el sistema con esa línea base.

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

Los precios confirmados por tienda y mes son Esencial Bs149, Profesional Bs299
y Negocio Bs599. Sus prestaciones y límites objetivo se detallan en
`iconix/especificacion.json` y el Word ICONIX. Se conservan configurables.
Stripe se implementará en modo TEST mediante Checkout y webhooks autenticados
e idempotentes; una redirección del navegador no prueba el pago. QR simulado
registra su condición QR_SIMULATED y auditoría. No se informará un cobro real
sin una cuenta elegible, credenciales y confirmación verificable del proveedor.

## Trabajo offline

**Cliente.** Descarga un paquete de hasta diez prendas con recursos compatibles, metadatos y versiones, seleccionado por preferencias, favoritos e interacciones. Sin historial se usan gustos declarados y una selección inicial explícita. El paquete incluye los archivos necesarios para la experiencia soportada, con verificación de integridad y estado de descarga. El seguimiento RA actual se ejecuta en el teléfono; el visor 3D web y la superposición RA móvil se documentan como experiencias diferentes. Descargar un PNG no se describirá como descargar un modelo 3D. La generación de un avatar desde fotografías sigue requiriendo procesamiento en servidor.

**Administración.** SQLite en Android e IndexedDB y caché de aplicación en web. Se permiten altas, ediciones, archivo lógico y movimientos de inventario sobre datos previamente descargados. Cada operación conserva un UUID, dispositivo, tienda, versión de base y estado de envío. La cola sobrevive al cierre de la aplicación. Los aumentos de stock se envían como movimientos, no como sustituciones del saldo global. Reintentar una operación no duplica el movimiento.

Las modificaciones incompatibles, conteos simultáneos, permisos revocados y stock insuficiente se muestran como conflictos. El servidor revalida permisos, suscripción y reglas al sincronizar. Eliminar una prenda con historial significa archivarla. Las ventas online y sus reservas conservan su confirmación transaccional en servidor; vender sin conexión no forma parte de los requisitos offline confirmados.

## Reportes y dashboards

Filtros iniciales: período y comparación, tienda autorizada, sucursal/almacén, canal, vendedor, categoría, marca, producto, talla, color, estado del pedido, estado/método del pago, devoluciones, precio y stock. Dimensiones, métricas, agrupación temporal, orden, límites y tipo de gráfico forman una definición guardada de reporte.

Los dashboards permiten cambiar filtros, cruzar selecciones, consultar detalle y guardar diseños. Sin conexión siguen siendo interactivos dentro del conjunto descargado, con cobertura y fecha de actualización visibles. No se fingirá disponibilidad offline de filas que nunca se descargaron.

Con conexión, texto o voz se transforma en una definición estructurada de reporte que el servidor valida. La IA elige filtros y visualizaciones del catálogo permitido; los números se calculan con consultas autorizadas. No ejecuta SQL arbitrario ni inventa resultados. Sin internet quedan disponibles filtros, definiciones y datos locales; la transcripción y la interpretación remota requieren conexión.

## Machine learning

Casos de ML concretos: predicción de demanda por prenda/ubicación, alertas de
comportamiento inusual y apoyo a reposición. La selección de prendas offline
usa preferencias y reglas explícitas; no se presenta como otro modelo entrenado.
Los modelos tendrán entrenamiento, versión, período de datos, comparación con
una referencia simple y métricas sobre datos posteriores al entrenamiento.
Se evaluarán por separación temporal, sin información futura.

La decisión del 31/10 es usar una demostración con datos sintéticos identificados,
separados de ventas, stock y reportes reales. El protocolo define semilla,
generador, particiones temporales y métricas; sus resultados siguen pendientes
de ejecución. La importación de historial no forma parte de esta entrega.
Una tienda sin historial suficiente muestra esa limitación y reglas de stock,
sin presentar la demostración como pronóstico comercial propio.

## Documento ICONIX

Requisitos y reglas de negocio → modelo de dominio → actores/casos de uso con flujo principal y alternos → análisis de robustez (frontera, control y entidad) → secuencias → clases de diseño → implementación y pruebas. Se incorporan modelo de datos, arquitectura SaaS y sincronización como soporte del diseño. Cada requisito debe enlazar caso, diagramas, módulo, código y evidencia de prueba. Las pruebas se documentan con resultados realmente ejecutados al avanzar el sistema.

Se mantienen Grupo 18, integrantes en orden alfabético, dos carátulas y navegación
del índice del informe anterior. El archivo nuevo es
`docs/Lumina_SaaS_ICONIX_Grupo18.docx`; el informe anterior se conserva como
referencia. La especificación JSON y las fuentes de los diagramas permiten
reproducir el documento. El Word es una especificación objetivo y las pruebas
del incremento se declaran planificadas.

## Orden de entrega

1. 31/10: documento ICONIX y coherencia de requisitos, casos, datos y diagramas.
2. 01/11: prestaciones, cuotas y suscripciones de demostración sobre la base SaaS.
3. 02–03/11: sincronización y paquetes offline en web y Android.
4. 04/11: constructor de reportes y dashboards interactivos offline.
5. 05/11: texto/voz y laboratorio de ML sintético entrenado y evaluado.
6. 06/11: integración, pruebas y APK firmado.
7. 07/11: verificación del despliegue y cierre documental con evidencia real.

Este orden expresa prioridades y dependencias. Cualquier cambio de alcance se registra aquí y en los casos de uso antes de declararlo entregado.

## Referencias técnicas

- Microsoft, SaaS y multitenencia: https://learn.microsoft.com/en-us/azure/architecture/guide/saas-multitenant-solution-architecture/
- Microsoft, modelos de aislamiento: https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
- Expo, persistencia local: https://docs.expo.dev/guides/local-first/
- MDN, IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- scikit-learn, evaluación temporal: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html
- Rosenberg y Stephens, Use Case Driven Object Modeling with UML: https://link.springer.com/book/10.1007/978-1-4302-0369-8
