# A13 · API y pantalla de análisis

El módulo **Administración → Análisis de datos** usa una cola persistida en `ejecucion_analitica`. Una petición responde con HTTP 202 y conserva el identificador enviado por la persona. Los resultados completos se consultan individualmente. El listado devuelve hasta treinta resúmenes privados.

| Ruta | Contrato |
| --- | --- |
| `POST /api/analytics/jobs` | Recibe `AnalysisRequestSchema` y devuelve `AnalysisJobViewSchema`. |
| `GET /api/analytics/jobs` | Devuelve `{jobs}` con resúmenes propios. |
| `GET /api/analytics/jobs/:id` | Devuelve estado, fechas, limitaciones y resultado completo autorizado. |
| `GET /api/analytics/results/:id` | Descarga el mismo documento JSON con la fuente en el nombre. |

Cada petición incluye token y `X-Tenant-Slug`. El permiso es `reportes:consultar`. Esencial conserva los reportes manuales. Profesional habilita demanda y reposición. Negocio añade anomalías y comparación entre ubicaciones. El servidor vuelve a verificar permisos, ubicaciones y suscripción antes de procesar y antes de guardar.

## Crear trabajos

`operationId` es un UUID generado una vez por intención. Reenviarlo con el mismo contenido recupera el trabajo. Cambiar el contenido conservando el UUID devuelve conflicto.

Los campos comunes son `action`, `source`, `channel` y `locationIds`. La fuente usa `REAL` o `DEMOSTRACION_SINTETICA`. El canal usa `WEB`, `APP` o `TIENDA`. Las ubicaciones de demostración están en el namespace `demo-ubicacion-01` a `demo-ubicacion-05`. Para datos reales se usan UUID de ubicaciones asignadas.

| Acción | Referencia necesaria |
| --- | --- |
| `GENERATE_DATASET` | Prepara el dataset sintético reproducible. |
| `TRAIN_DEMAND` | `datasetJobId` de una generación completada propia. |
| `TRAIN_ANOMALY` | `datasetJobId` y plan Negocio. |
| `FORECAST` | `modelJobId` de entrenamiento de demanda completo y `horizonDays` de 7 o 30. |
| `SUGGEST_RESTOCK` | En demostración, `forecastJobId` propio. Con datos reales, consulta el stock de las ubicaciones autorizadas. |

El servicio resuelve los archivos y el modelo a partir de esas referencias. El cliente recibe contratos funcionales. Los parámetros internos, rutas y objetos serializados de Python se construyen en el servidor.

## Resultados y recuperación

Los estados públicos son `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED` e `INSUFFICIENT_DATA`. La cola admite dos trabajos pendientes por cuenta y dieciséis por tienda. Un bloqueo global mantiene un proceso de análisis activo entre instancias del servidor. Un trabajo activo que perdió el proceso se marca con `ANALYTICS_INTERRUPTED`. Puede iniciarse otra intención conservando el resultado histórico del intento anterior.

Se guardan el dataset, su hash, la división temporal y el catálogo de referencia en `conjunto_entrenamiento`. Los modelos completos registran algoritmo, versión, procedencia, hash y artefacto. Cada métrica tiene partición, horizonte, valor, referencia estacional, observaciones y motivo de N/A. Los identificadores sintéticos permanecen en resultados de demostración.

El pronóstico conserva la fuente y el período. Las alertas muestran hasta quinientas observaciones sintéticas con mayor puntuación. Las métricas de evaluación corresponden al conjunto completo de prueba. El filtro de ubicación permite explorar las observaciones descargadas.

La reposición de demostración usa la demanda prevista durante siete días, disponible cero, stock de seguridad tres y entrante cero. Estos supuestos aparecen en las limitaciones. Para una tienda sin modelo real, la consulta de reposición propone alcanzar su stock de seguridad y muestra `REGLA_BASICA`. Las sugerencias se presentan para revisión.

## Consulta sin conexión

La web permite guardar un resultado cifrado por tienda, cuenta y dispositivo. El gráfico, los filtros locales y la descarga JSON usan ese corte sin red. Al recuperar la conexión se vuelve a consultar el acceso del servidor. El APK debe consumir los mismos contratos y guardar el documento autorizado en su almacén privado.

## Verificación

Los comandos reproducibles de este incremento son `node scripts/check-analytics-api.cjs`, `node scripts/check-analytics-web.cjs` y `node scripts/check-analytics-live-web.cjs`. El primero usa el worker y PostgreSQL reales en un negocio temporal. El segundo usa resultados controlados para comprobar estados, N/A, referencia estacional y reapertura offline. El tercero lee desde Chromium el negocio de prueba mientras el entrenamiento está activo.

El despliegue queda pendiente para la nueva VM.

## Resultados observados el 7 de noviembre de 2026

La corrida HTTP usó un negocio temporal en PostgreSQL local, el dataset de 197.100 filas y el worker Python 3.11 fijado. La API respondió 202 antes de procesar. El entrenamiento RandomForest de 200 árboles tardó 1.395,736 segundos en este equipo. Se persistieron seis métricas de demanda y catorce de clasificación. Después se generaron 504 predicciones futuras para dos ubicaciones y el canal Web, 72 sugerencias de reposición y una muestra de 48 alertas para ese alcance. La comprobación final encontró cero pedidos comerciales creados por la demostración.

| Horizonte | MAE modelo / referencia | RMSE modelo / referencia | WAPE modelo / referencia |
| --- | --- | --- | --- |
| 7 días | 0,490040 / 0,556587 | 0,748583 / 1,036185 | 89,3676 % / 101,5035 % |
| 30 días | 0,492710 / 0,551683 | 0,751934 / 1,028284 | 89,7521 % / 100,4948 % |

La demanda mejora el error de la referencia estacional en este dataset, con WAPE todavía alto. El detector obtuvo precisión 0,06322, exhaustividad 0,33824 y F1 0,10653. La precisión baja permanece visible en la evaluación y las propuestas requieren revisión.

Las 225 pruebas generales pasaron en 45 suites. Las tres pruebas específicas de la cola pasaron en una base de control temporal separada para mantener aislados sus bloqueos mientras corría el entrenamiento. Verificaron recuperación de intención, exclusión entre procesadores, interrupción, cuentas y tiendas, permisos por plan y consulta de reposición sin cambios en stock. Las 25 pruebas Python y las 25 pruebas compartidas completan las comprobaciones automáticas.

El recorrido de Chromium verificó N/A con motivo, error mayor que la referencia, aviso de fechas fuera del corte, exportación y reapertura cifrada sin red. Un segundo recorrido leyó el dataset persistido y el entrenamiento activo desde la API real. El navegador se revisó a 1.440 y 390 px.

En la primera corrida larga venció el token del script de prueba antes de la consulta final. El script renueva la autenticación al recibir 401 y la repetición completa pasó. La instalación de dependencias de la rama móvil quedó pendiente por espacio disponible en C:.
