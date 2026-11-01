# Worker analítico de Lúmina

Este directorio alojará el worker Python del equipo B para generación del
dataset sintético, entrenamiento y evaluación de demanda, detección de
anomalías, pronósticos y sugerencias de reposición.

## Estado

Baseline B00 preparado. Todavía no hay implementación analítica ni resultados
de ML. Los bloques B01–B03 crearán el paquete `lumina_analytics`, sus pruebas,
los requisitos fijados y el CLI acordado con el equipo A.

## Entorno local

El worker analítico utiliza Python 3.11 en un entorno separado del worker de
avatar:

```powershell
py -3.11 -m venv .local/analytics-venv
$taskMlPython = Join-Path (Get-Location) '.local/analytics-venv/Scripts/python.exe'
& $taskMlPython --version
```

`.local` está excluido de Git. No se deben modificar los pines del worker de
avatar para instalar pandas, NumPy o scikit-learn.

## Límites de integración

- No accede directamente a PostgreSQL ni decide roles, planes o cuotas.
- Los datos sintéticos deben usar `source=DEMOSTRACION_SINTETICA` y un
  namespace separado de datos comerciales reales.
- Los artefactos completos y modelos permanecen en almacenamiento privado; el
  repositorio conserva código, pruebas, fixtures pequeñas y manifiestos.
- El CLI y sus esquemas se implementarán cuando el equipo A publique
  `AnalyticsJobV1` y los contratos compartidos de G0a.
