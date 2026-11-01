# Worker analítico de Lúmina

Este directorio alojará el worker Python del equipo B para generación del
dataset sintético, entrenamiento y evaluación de demanda, detección de
anomalías, pronósticos y sugerencias de reposición.

## Estado

B00, B01, B02 y B03 preparados localmente. Existe un generador reproducible del dataset
`demo-femenino-seed42-v1`, su catálogo demo, manifiesto, copia para anomalías y
etiquetas separadas. B02 agrega features históricas, baseline semanal,
RandomForest y evaluación walk-forward 7/30 días. B03 agrega IsolationForest
con umbral calibrado sin filtrar etiquetas, sugerencias de reposición sin
mutar stock y un CLI `AnalyticsJobV1` local. Sigue pendiente conectarlo al
supervisor/API del equipo A y a las pantallas administrativas.

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

## Entrenamiento B02

Desde `workers/analytics`, después de generar B01:

```powershell
$taskMlPython = Join-Path (Resolve-Path ../..) '.local/analytics-venv/Scripts/python.exe'
& $taskMlPython -m pytest tests/test_features.py tests/test_temporal_evaluation.py tests/test_demand.py tests/test_artifacts.py -q
& $taskMlPython -m lumina_analytics.demand --panel ../../.local/analytics/b01/panel.csv --output ../../.local/analytics/b02 --estimators 200 --jobs 1
```

La salida privada contiene `demand-model.joblib`, `metadata.json` y
`evaluation.json`. Los artefactos joblib solo se cargan desde el directorio
confiable y después de validar su SHA-256.

## Jobs B03

Desde `workers/analytics`, el ejecutable recibe una solicitud JSON y emite un
solo JSON final por stdout; el progreso estructurado se escribe en stderr.
Los resultados y artefactos se limitan a `.local`, se vinculan a tienda/fuente
y se verifican por SHA-256. El worker no consulta PostgreSQL, no hace HTTP y
no puede escribir inventario.

```powershell
$taskMlPython = Join-Path (Resolve-Path ../..) '.local/analytics-venv/Scripts/python.exe'
& $taskMlPython -m lumina_analytics.cli --job examples/generate-demo.json
& $taskMlPython -m lumina_analytics.cli --job examples/train-anomaly-demo.json
& $taskMlPython -m lumina_analytics.cli --job examples/suggest-restock-demo.json
```

Los ejemplos usan exclusivamente `source=DEMOSTRACION_SINTETICA`. Una solicitud
`REAL` sin historia/modelo autorizado responde `MODEL_DATA_INSUFFICIENT`; nunca
se sustituye con ventas sintéticas.

## Límites de integración

- No accede directamente a PostgreSQL ni decide roles, planes o cuotas.
- Los datos sintéticos deben usar `source=DEMOSTRACION_SINTETICA` y un
  namespace separado de datos comerciales reales.
- Los artefactos completos y modelos permanecen en almacenamiento privado; el
  repositorio conserva código, pruebas, fixtures pequeñas y manifiestos.
- El CLI usa un contrato local estricto mientras se recibe el DTO final de A01;
  A13 sigue siendo responsable del supervisor, timeout y concurrencia.
