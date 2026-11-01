# Worker analítico de Lúmina

Este directorio alojará el worker Python del equipo B para generación del
dataset sintético, entrenamiento y evaluación de demanda, detección de
anomalías, pronósticos y sugerencias de reposición.

## Estado

B00 y B01 preparados. Existe un generador reproducible del dataset
`demo-femenino-seed42-v1`, su catálogo demo, manifiesto, copia para anomalías y
etiquetas separadas. Todavía no hay entrenamiento ni resultados de ML; B02 y
B03 agregarán features, evaluación y el CLI acordado con el equipo A.

## Entorno local

El worker analítico utiliza Python 3.11 en un entorno separado del worker de
avatar:

```powershell
py -3.11 -m venv .local/analytics-venv
$taskMlPython = Join-Path (Get-Location) '.local/analytics-venv/Scripts/python.exe'
& $taskMlPython --version
& $taskMlPython -m pip install -r workers/analytics/requirements.lock.txt
```

`.local` está excluido de Git. No se deben modificar los pines del worker de
avatar para instalar pandas, NumPy o scikit-learn.

## Generación B01

Desde `workers/analytics`:

```powershell
$taskMlPython = Join-Path (Resolve-Path ../..) '.local/analytics-venv/Scripts/python.exe'
& $taskMlPython -m pytest tests/test_synthetic.py tests/test_manifest.py -q
& $taskMlPython -m lumina_analytics.synthetic --output ../../.local/analytics/b01
```

El directorio de salida contiene `panel.csv`, `anomaly-panel.csv`,
`anomaly-labels.csv`, `catalog.json` y `manifest.json`. Es privado, regenerable
y no debe agregarse a Git.

## Límites de integración

- No accede directamente a PostgreSQL ni decide roles, planes o cuotas.
- Los datos sintéticos deben usar `source=DEMOSTRACION_SINTETICA` y un
  namespace separado de datos comerciales reales.
- Los artefactos completos y modelos permanecen en almacenamiento privado; el
  repositorio conserva código, pruebas, fixtures pequeñas y manifiestos.
- El CLI y sus esquemas se implementarán cuando el equipo A publique
  `AnalyticsJobV1` y los contratos compartidos de G0a.
