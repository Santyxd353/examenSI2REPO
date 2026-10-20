# Estado de Lúmina SaaS

Actualización: 20/10/2026.

| Área | Estado | Evidencia |
| --- | --- | --- |
| Alcance y prioridades | Definidos inicialmente | ALCANCE_Y_ENTREGA.md; decisiones del usuario sobre SaaS, offline web/Android, Stripe y QR simulado |
| Base SaaS y aislamiento | Implementado en rama de trabajo | Contexto por petición, base y archivos por tienda, tokens vinculados, cookies y claves móviles separadas; pruebas HTTP, ORM, SQL, transacciones, eventos y purga |
| Provisión y planes | Implementado en rama de trabajo | CLI de alta, migraciones por tienda, prueba de 14 días, expiración y límites transaccionales ante altas concurrentes; precios sin publicar |
| Administración por módulos | Implementado en web | Inicio, catálogo, inventario, ubicaciones, ventas, pedidos, equipo, reportes y negocio; prueba de administradora, vendedora y analista |
| Identidad de tienda Android | Implementado en código | Selector en inicio de sesión, tokens y WebSocket por tienda; tipos y compatibilidad Expo aprobados. No se ha generado un APK nuevo |
| Inventario y paquete offline | Pendiente | Requiere contexto de tienda y protocolo durable |
| Reportes y dashboards offline | Pendiente | Requiere conjunto local y definición común de reportes |
| IA por texto/voz | Pendiente | Proveedor y credenciales por configurar |
| ML evaluado | Pendiente | Producción contiene siete ventas; se requiere historial adicional o demostración etiquetada |
| Suscripciones Stripe/QR | Pendiente | Métodos confirmados, precios y credenciales por configurar |
| Documento ICONIX nuevo | Primera especificación en Markdown | ICONIX.md: requisitos, reglas, dominio, actores, casos iniciales, secuencias y trazabilidad. Word final con dos carátulas e índice aún pendiente |

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
