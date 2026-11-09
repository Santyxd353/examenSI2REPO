# B15 — Aceptación Android nativa y pruebas cruzadas

## Estado

**Candidato QA validado en Android físico el 09/11/2026.** Los casos que
requieren dos usuarios simultáneos se respaldan con las pruebas automatizadas
del API y no se presentan como una ejecución física inexistente.

## Candidato probado

| Campo | Valor |
| --- | --- |
| Rama | `desarrollo/android-ml` |
| Commit de código | `6479aad52326` |
| Paquete QA | `bo.edu.grupo18.vestidorar.qa` |
| Versión | `0.1.2` / `3` |
| Dispositivo | TECNO KL4 |
| Android / ABI | Android 14 / `arm64-v8a` |
| API | `http://localhost:3018/api`, exclusivamente mediante túnel USB |

## Registro de ejecución

| Caso | Resultado | Evidencia / observación |
| --- | --- | --- |
| Instalación y navegación | Aprobado | Se abrieron Inicio, Inventario, Ventas y pedidos, Reportes y Mi negocio sin cierres ni excepciones fatales. |
| Reinicio de proceso y ausencia de API | Aprobado | Tras quitar el túnel USB y reiniciar la app, el dashboard cifrado y el catálogo de 12 prendas continuaron disponibles. |
| Reinicio físico | Aprobado con desbloqueo requerido | El paquete y sus datos persistieron al reiniciar el TECNO; Android exige desbloquear el dispositivo para abrir almacenamiento protegido. |
| Cámara y AR | Aprobado | Permiso concedido; abrió la vista AR nativa, procesó cámara local y mostró el aviso de iluminación sin fallos. |
| Dictado de reportes | Aprobado | El módulo nativo usó micrófono durante 5 s y devolvió el estado controlado «No se reconoció una frase» al no hablar. |
| Exportación CSV/PDF | Aprobado | Ambos archivos se generaron y Android abrió el selector de compartir con su nombre y extensión correctos. |
| Sincronización, recibo y conflictos | Aprobado automatizado | Cubierto por las pruebas de cola, dependencias, recibos idempotentes y concurrencia de inventario. |
| Aislamiento entre negocios | Aprobado automatizado | Cubierto por las pruebas de ámbito de sesión y tenant del API. |
| Compra, devolución y administración | Aprobado automatizado/UI | API de comercio y pedidos: 16 pruebas aprobadas; la lista física mostró pedidos y transiciones disponibles. |

No se guardaron capturas de cámara, credenciales ni datos personales. La
prueba de falta de red se hizo retirando el túnel del API, sin alterar las
radios personales del teléfono.

## Automatización complementaria

Los flujos Maestro reproducibles viven en `apps/mobile/e2e/`. Las pruebas
unitarias móviles cubren cifrado offline, cola, catálogo, inventario, AR,
reportes, exportación y asistente. La batería final obtuvo 50/50 casos.
