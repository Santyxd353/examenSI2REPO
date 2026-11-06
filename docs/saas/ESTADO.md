# Estado de Lúmina SaaS

Actualización de desarrollo: 06/11/2026. Entrega prevista: 07/11/2026.

El documento ICONIX v2.0 es la base del desarrollo. El equipo A inició ejecución
en desarrollo/servidor-web con worktree aislado. A00 volvió a verificar100pruebas,
build y administración en Chromium; A01 publica contratos/fixtures compartidos.
Las evidencias nuevas están en docs/evidencia/saas/equipo-a. No se ha desplegado
esta ampliación; las verificaciones históricas del20/10 se conservan abajo.

| Área | Estado | Evidencia |
| --- | --- | --- |
| Alcance y prioridades | Definidos inicialmente | ALCANCE_Y_ENTREGA.md; decisiones del usuario sobre SaaS, offline web/Android, Stripe y QR simulado |
| Base SaaS y aislamiento | Implementado en rama de trabajo | Contexto por petición, base y archivos por tienda, tokens vinculados, cookies y claves móviles separadas; pruebas HTTP, ORM, SQL, transacciones, eventos y purga |
| Provisión y planes | A03 verificado localmente | Portal global y CLI, autenticación de control separada, planes149/299/599BOB, consumo/entitlements, cuotas transaccionales y períodos por aniversario. Checkout TEST y QR verificados en A04; cuenta Stripe externa pendiente |
| Administración por módulos | Equipo, ubicaciones y sincronización web verificados | Alta, edición, suspensión, reactivación, permisos, responsables y conflictos. La sincronización A09 tiene su propio módulo. Quedan reportes y análisis A10–A13. Ver equipo-a/A14-handoff.md y A09-web-offline.md |
| Identidad de tienda Android | Implementado en código | Selector en inicio de sesión, tokens y WebSocket por tienda; tipos y compatibilidad Expo aprobados. No se ha generado un APK nuevo |
| Catálogo y comercio A05 | Verificado localmente | Edición/archivo/versiones/precios/promociones/fotos; inventario transaccional y transferencia con comprobante; compras WEB/APP/POS, devoluciones y reportes sin duplicación. 29 suites/160 pruebas, build y Chromium aprobados; ver equipo-a/A05-catalogo-comercio.md y A05-handoff.md |
| Avatar y vestidor A06 | Cuotas/privacidad/validación y web verificados; regeneración pendiente B14 | 34 suites/181 pruebas, shared13 y build aprobados. Exportación Blender real desde parámetros QA; Chromium recupera respuesta perdida y añade M/Negro exacta al carrito. No acredita inferencia exitosa de fotos reales ni regeneración; ver equipo-a/A06-avatar-handoff.md. CSP corregida para visor Blob privado. Sin despliegue |
| Servidor de sincronización offline A07 | Servidor y web verificados en local | Bootstrap con clave envuelta por tienda, actor y dispositivo. Cinco operaciones con recibos atómicos, dependencias, conflictos y permisos actuales. Adaptación Android B08 pendiente. Ver equipo-a/A07-handoff.md |
| Copia y prendas offline A08 | Servidor verificado en local | Cortes paginados verificables, staging privado y hasta diez prendas. Pruebas con 12 referencias, GLB g18-1 en web y PNG AR en Android. Ver equipo-a/A08-descargas-handoff.md |
| Offline web A09 | Verificado en Chromium | Reapertura sin red, descargas cifradas, visor local, cola de catálogo e inventario, conflicto y reenvío sin duplicación. Android físico queda en B09 y B15. Ver equipo-a/A09-web-offline.md |
| Reportes y dashboards offline | Motor A10 verificado en Node y Chromium | Centavos, cobertura, filtros, selección cruzada, widgets y CSV con fixture común. Conjuntos privados, interfaz y Hermes pendientes de A11, A12 y B10. Ver equipo-a/A10-motor-reportes.md |
| IA por texto/voz | Pendiente | Proveedor y credenciales por configurar |
| ML evaluado | Pendiente | Demostración con datos sintéticos identificados confirmada; entrenamiento y evaluación temporal definidos, sin resultados fabricados |
| Suscripciones Stripe/QR | A04 verificado localmente | QR real de simulación, renovación/cambio/cancelación idempotentes y UI móvil. Stripe probado con eventos firmados del SDK; sesión externa pendiente de cuenta TEST configurada.135pruebas generales aprobadas. No desplegado |
| Documento ICONIX nuevo | Especificación objetivo en Word y JSON | `docs/Lumina_SaaS_ICONIX_Grupo18.docx` y `iconix/especificacion.json`: 54 requisitos, 27 casos, 111 diagramas, 59 tablas; dos carátulas, índice navegable, recomendaciones, bibliografía y QR. No acredita implementación de los incrementos pendientes |
| Contratos compartidos A01/G0a | Verificado localmente | Esquemas/DTO/planes, hash canónico, dinero exacto y fixtures.14 pruebas de contrato tras A07; paridad API/Vite/WebCrypto. Motor reporting y validación Android pendientes |
| Esquema A02/A14 | Migrado y verificado solo en local | Seis tablas y ampliaciones ICONIX, Prisma regenerado, migración control versionada,19suites/108tests y ensayo real de respaldo/restauración. A14 añade responsable y versiones de equipo/ubicación sin nuevas tablas. Despliegue pendiente |

## Verificación del primer incremento

20/10/2026, sobre PostgreSQL local de pruebas y sin escribir en producción:

- `npm test`: 18 suites, 100 pruebas aprobadas.
- `npm run test:admin-ui`: compilación de API/web y recorrido real Chromium aprobados. Navegación modular, aislamiento entre pestañas, anchos de escritorio y móvil sin desbordamiento, permisos de tres roles y venta persistida con confirmación y lista reciente.
- `npm run mobile:typecheck`: aprobado.
- `npm run mobile:check`: dependencias compatibles con SDK Expo 57.
- `npm run mobile:pose-test`: siete pruebas aprobadas.

La prueba de navegador encontró y reprodujo un error anterior de mostrador: React liberaba `event.currentTarget` durante la petición de venta. La venta se guardaba, pero fallaban la confirmación visual y la recarga. Se conserva una referencia al formulario antes de esperar la respuesta; el recorrido automatizado ahora comprueba ambas partes.

La revisión del incremento cerró defectos de cambio de tienda entre pestañas, respuestas móviles atrasadas, cierre de sesión dirigido al negocio anterior y estado de catálogo conservado al cambiar de cuenta. También se verificaron rutas de archivos con mayúsculas, consultas de solo lectura tras vencimiento y carga de la aplicación compartida cuando Lúmina está suspendida. El runtime de migraciones conserva la configuración TypeScript requerida por sus decoradores.

Se actualizaron los parches Expo compatibles y `shell-quote` a 1.11.0. La auditoría móvil todavía informa quince alertas altas transitivas de la cadena de herramientas, derivadas de `braces` y `node-forge`; no se ejecutó una actualización forzada incompatible. Revisar los parches disponibles antes de la entrega del APK.

La rama es `desarrollo/saas-offline`. Este estado no significa que SaaS esté publicado ni que offline, cobros, nueva IA o ML estén terminados. La ampliación modular y offline de Administración Android corresponde al siguiente incremento descrito en `02_OFFLINE.md`.

Reglas: no convertir una tarea en «implementada» sin interfaz, lógica, autorización y verificación. No mezclar datos sintéticos con métricas de negocio reales.
