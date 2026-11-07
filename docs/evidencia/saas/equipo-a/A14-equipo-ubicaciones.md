# A14 — Incremento temprano de equipo y ubicaciones

04/11/2026. Base: `9a58ef6`. Implementación en `desarrollo/servidor-web`; referencia del commit de este incremento en el historial Git. No desplegado.

## Resultado

Equipo incluye administradoras, vendedoras, analistas y suspendidas. Permite alta, edición, cambio de rol y asignaciones, suspensión con motivo y reactivación. Serializa las modificaciones y revalida autoridad después de esperar el bloqueo. Protege el último acceso administrador incluso ante dos cambios simultáneos; cupos 3/15/100 se revalidan en altas/reactivaciones, sin contar compradoras. Los cambios de autorización revocan las sesiones, incluido el token de renovación, y conservan ventas/movimientos.

Ubicaciones permite alta, edición, responsable, dependencia, desactivación y reactivación. Responsable pertenece a la tienda y está activo; recibe asignación si no la tenía. Antes de suspenderlo o quitar su ámbito debe reasignarse la responsabilidad. Se rechazan ciclos, padres inactivos y cierres con stock/reservas/compromisos, hijas activas, pedidos pendientes o devoluciones sin resolver. Los estados finales conservan historial sin impedir el cierre.

Ambos recursos usan versiones para evitar sobrescritura. Auditoría conserva actor, estado anterior/posterior y motivo, sin credenciales. Migración aditiva `202611040001_team_locations`: versiones y responsable con FK, sin nuevas tablas. No asigna responsables históricos por inferencia.

La web separa `Team.tsx` y `Locations.tsx`, con búsqueda, filtros de estado, uso del cupo, permisos efectivos, errores recuperables, formularios y estados vacíos. Se cargan como módulos diferidos. Los cambios de accesos/ubicaciones requieren conexión y plan habilitado. La consulta ya cargada sigue visible durante una desconexión; esto no acredita persistencia offline tras reiniciar.

## Evidencia

- RED inicial: ocho casos fallaron por propietario ausente de la lista, PATCH inexistente y responsableId no aceptado; `.local/logs/a14-red.log`.
- Regresión enfocada: cuatro suites, 33 pruebas aprobadas; `.local/logs/a14-focused.log`.
- Caso adicional RED→GREEN: pedido CERRADO seguía impidiendo cierre tras resolver devolución; ahora está entre estados finales. `.local/logs/a14-closed-red.log` y suite completa.
- `npm test -- --cacheDirectory .local/jest`: **31 suites / 169 pruebas aprobadas**, sin omisiones, 141,113 s; `.local/logs/a14-full.log`.
- `npm run test:shared`: **13/13**; normalización UUID, exigencia de versión/motivo y compatibilidad antigua verificadas. `.local/logs/a14-contract.log`.
- Compilación shared/API/web y Chromium: crear/editar/suspender/reactivar integrante; alta/cierre/reactivación de almacén con responsable; verificaciones de persistencia; navegación y roles; catálogo/fotos/archivo; venta visible y persistida. `.local/logs/a14-ui.log`, `.local/saas-ui-result.json`.
- `npm run test:admin-ui`: compilación final y recorrido completo aprobados, incluida pérdida/recuperación de conexión con edición de accesos deshabilitada; `.local/logs/a14-admin-final.log`.
- Capturas inspeccionadas: `.local/team-mobile.png` a 390 px de viewport, `.local/locations-desktop.png` a 1440 px. Sin desbordamiento. La prueba del selector de rol detectó etiqueta accesible ambigua y se corrigió con aria-label explícito.

La prueba histórica de asignaciones ahora exige reautenticación y comprueba HTTP401 del token revocado. No se rebajó la protección para mantener una sesión antigua. La limpieza de catálogo elimina únicamente las asignaciones de su ubicación de prueba antes de retirar esa fixture.

## Alcance pendiente

Este incremento adelanta CU04/CU05 y el núcleo de A14 para B13 según la secuencia del plan. El cierre total de A14 requiere Sincronización real de A09 y Reportes/análisis de A12/A13. No se agregó un botón ficticio de sincronizar. No se modificó Android, Python ni el Word; la validación física del APK y la integración se mantienen en A15/B15. Despliegue/migración de todas las tiendas se realiza en A16, tras sus verificaciones.

El aviso de Vite sobre el paquete principal mayor a 800 kB sigue pendiente para la división de la aplicación y shell offline de A09; los módulos nuevos sí tienen chunks propios. Stripe externo, offline, IA y ML siguen con los pendientes ya registrados en ESTADO.md.

Interfaces y decisiones de compatibilidad: [A14-handoff.md](A14-handoff.md).

Seguimiento de provisión: una tienda nueva asigna su sucursal principal a la propietaria desde el alta. Caso RED (responsable undefined) y GREEN: 15 pruebas de provisión/equipo aprobadas; logs a14-provision-red.log y a14-provision-green.log. La regla de no inferir responsables se aplica únicamente a datos históricos.
