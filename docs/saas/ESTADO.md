# Estado de Lúmina SaaS

Actualización documental: 31/10/2026. Entrega prevista: 07/11/2026.

La prioridad confirmada es terminar primero el documento ICONIX y desarrollar
la ampliación según esa especificación. La evidencia técnica del primer
incremento que figura abajo corresponde al 20/10; no se ha vuelto a ejecutar
ni desplegar la aplicación durante esta actualización documental.

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
| ML evaluado | Parcial, verificado localmente | B01–B03 en `desarrollo/android-ml`: corpus sintético reproducible, demanda con evaluación temporal y anomalías/reposición mediante CLI; falta integración API/UI, datos comerciales autorizados y supervisión de jobs |
| Suscripciones Stripe/QR | Pendiente | Esencial Bs149, Profesional Bs299, Negocio Bs599 por tienda/mes; Stripe TEST y QR_SIMULATED para entrega académica. Configuración y flujos por implementar |
| Documento ICONIX nuevo | Especificación objetivo en Word y JSON | `docs/Lumina_SaaS_ICONIX_Grupo18.docx` y `iconix/especificacion.json`: 54 requisitos, 27 casos, 111 diagramas, 59 tablas; dos carátulas, índice navegable, recomendaciones, bibliografía y QR. No acredita implementación de los incrementos pendientes |

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
