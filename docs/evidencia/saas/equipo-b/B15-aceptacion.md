# B15 — Aceptación Android nativa y pruebas cruzadas

## Estado

**Preparado; ejecución física pendiente.** Esta evidencia no declara aprobados
los casos que aún no se ejecutaron en un dispositivo autorizado.

## Candidato

| Campo | Valor |
| --- | --- |
| Rama | `desarrollo/android-ml` |
| Commit candidato | `8e23bdf` |
| Paquete QA | `bo.edu.grupo18.vestidorar.qa` |
| Versión observada | `0.1.2` / `3` |
| APK QA | build local de 2026-11-03; registrar SHA-256 antes de handoff |
| Dispositivo | Pendiente de registrar por la persona que ejecuta la prueba |
| Android / ABI / Hermes | Pendiente de registrar |
| API | Local por USB para laboratorio; HTTPS pendiente para candidato distribuible |

## Automatización preparada

Los flujos Maestro viven en `apps/mobile/e2e/`. Requieren cuentas de QA y se
ejecutan con `maestro test apps/mobile/e2e`. Los escenarios que dependen de red,
cámara o una segunda sesión documentan su precondición y no se declaran
automáticos de forma engañosa.

| Caso | Flujo | Estado |
| --- | --- | --- |
| Persistencia tras reinicio y catálogo | `offlineCatalog.yaml` | Preparado |
| Consulta de reportes de solo lectura | `reportsOffline.yaml` | Preparado |
| Aislamiento entre negocios | `tenantIsolation.yaml` | Preparado; exige dos cuentas |
| Conflicto de stock | `stockConflict.yaml` | Preparado; exige segunda sesión |
| Respuesta perdida / recibo | `lostResponse.yaml` | Preparado; exige corte controlado |
| AR sin red | `outfitsOffline.yaml` | Preparado; revisión física |
| Compra idempotente | `checkoutRecord.yaml` | Preparado; datos QA |

## Registro de ejecución

Completar cada renglón al hacer la ejecución. Adjuntar solo capturas sin datos
personales, rostros ni credenciales.

| Fecha | Caso | Resultado (Aprobado/Fallido/No ejecutado) | Evidencia / observación |
| --- | --- | --- | --- |
| — | Reinicio, modo avión y persistencia | No ejecutado | — |
| — | Sincronización y recibo idempotente | No ejecutado | — |
| — | Conflicto de inventario | No ejecutado | — |
| — | Cambio de negocio / aislamiento | No ejecutado | — |
| — | Cámara, permiso y AR offline | No ejecutado | — |
| — | Dictado de reporte y permiso de micrófono | No ejecutado | — |
| — | Exportación CSV/PDF y volver a la aplicación | No ejecutado | — |
| — | Compra y devolución visible en administración | No ejecutado | — |

## Criterio de cierre

Se cierra B15 solamente cuando las filas obligatorias estén ejecutadas, los
fallos reproducibles estén corregidos o aceptados explícitamente y el candidato
coincida con la API/Web usada en la prueba.
