# B03 — Anomalías, reposición y CLI analítico

Fecha: 2026-11-01 (`America/La_Paz`)

## Alcance entregado

La rama `desarrollo/android-ml` incorpora un worker Python local sin acceso a
PostgreSQL, HTTP, roles, planes ni mutaciones comerciales. El comando:

```powershell
python -m lumina_analytics.cli --job request.json
```

acepta el contrato local `AnalyticsJobV1` (`schemaVersion: "1.0"`) y las cinco
acciones `GENERATE_DATASET`, `TRAIN_DEMAND`, `TRAIN_ANOMALY`, `FORECAST` y
`SUGGEST_RESTOCK`. El stdout final es un único JSON de protocolo; eventos se
envían a stderr. Las rutas se resuelven dentro de `.local`, el resultado queda
relativo a `workDir` y cada resultado/artefacto tiene SHA-256 verificable.

## Anomalías

- Modelo: `IsolationForest`, `random_state=42`, `n_jobs=1`.
- Features: unidades observadas, retardo 1, media y desviación de los siete
  días anteriores, variante, ubicación, canal, categoría, talla y color.
- Las etiquetas, tipo, intensidad y columnas derivadas de la inyección no se
  entregan al modelo. Solo se unen por clave para calibrar/evaluar.
- Umbral seleccionado enteramente en validación y congelado antes de prueba.

Corrida real sobre `demo-femenino-seed42-v1`, fuente
`DEMOSTRACION_SINTETICA`:

| Medición | Validación | Prueba |
| --- | ---: | ---: |
| Umbral congelado | 0.4276531582 | 0.4276531582 |
| TP / FP / TN / FN | 131 / 1.632 / 27.712 / 225 | 115 / 1.704 / 27.656 / 225 |
| Precisión | 0,0743 | 0,0632 |
| Recall | 0,3680 | 0,3382 |
| F1 | 0,1236 | 0,1065 |

Este resultado mide inyecciones sintéticas en un panel disperso; no expresa
precisión sobre ventas reales ni habilita alertas comerciales automáticas.

## Reposición

`suggested_quantity` aplica exactamente:

```text
max(0, ceil(demanda_durante_plazo + stock_seguridad - disponible - entrante_confirmado_no_incluido))
```

El valor `available` ya incorpora reservas/compromisos y no se descuenta por
segunda vez. Si falta una predicción, se declara `REGLA_BASICA` y la limitación
`MODEL_DATA_INSUFFICIENT`; en todos los casos el efecto es `SUGGESTION_ONLY`.
El worker no crea compras ni ajusta stock.

## Evidencia ejecutada

```powershell
$taskMlPython = Join-Path (Resolve-Path ../..) '.local/analytics-venv/Scripts/python.exe'
Push-Location workers/analytics
& $taskMlPython -m pytest tests/test_anomalies.py tests/test_restock.py tests/test_cli.py tests/test_job_scope.py -q
& $taskMlPython -m lumina_analytics.cli --job examples/generate-demo.json
& $taskMlPython -m lumina_analytics.cli --job examples/train-anomaly-demo.json
& $taskMlPython -m lumina_analytics.cli --job examples/suggest-restock-demo.json
Pop-Location
```

- B03: `6 passed` en 21,90 s.
- Regresión B01/B02: `18 passed` en 6,94 s.
- Artefacto de anomalías: `anomaly-model.joblib`, 269.268 bytes,
  SHA-256 `72ef6b5c25ab4ea0d210276b7c284dfd2e2b00b9b334847dbe27af8385a4e91e`.
- Resultado de entrenamiento: SHA-256
  `72bcc617f7a2299bfd675822d9603003b016cff2f8452f37ebc6666a401605a7`.
- Entorno usado: Python 3.11, NumPy 2.3.4, pandas 2.3.3,
  scikit-learn 1.7.2 y joblib 1.5.2 fijados en `requirements.lock.txt`.

## Handoff a A

**Entrada:** A debe validar/autorizar `tenantId`, `actorId`, cuota y solicitud
antes de invocar el worker. El worker recibe solo JSON y rutas privadas ya
preparadas; no acepta URLs, shell ni rutas fuera de `.local`.

**Salida:** A debe validar el JSON final, el `resultPath` relativo, el SHA-256,
el tamaño, la versión de esquema y el ámbito de tenant/fuente antes de
persistir o mostrar resultados. Los artefactos incluyen `scope` con tenant,
job, fuente y dataset; un hash alterado o ámbito distinto se rechaza.

**Pendiente de integración:** A13 debe aportar supervisor, timeout/concurrencia
e interfaz `AnalyticsJobV1` definitiva. Hasta entonces el estado es
`VERIFICADO_LOCAL`; no se declara integrado con la API, Android, web ni datos
comerciales reales.
