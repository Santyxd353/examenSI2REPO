# B02 — Predicción de demanda y evaluación temporal

Fecha: 2026-11-01 (`America/La_Paz`)

## Identidad de la corrida

- Rama: `desarrollo/android-ml`.
- Base del bloque: `ed1debd` (`B01`).
- Dataset: `demo-femenino-seed42-v1`.
- Fuente: `DEMOSTRACION_SINTETICA`.
- SHA-256 del panel: `6c7fd89c040318fd81d9533c139e18dbee42064db4b8f167a1f64432cb1c1b02`.
- Modelo: `RandomForestRegressor`, versión `demand-rf-seed42-v1`.
- Árboles: 200; `min_samples_leaf=2`; `random_state=42`; `n_jobs=1`.

## Features sin fuga temporal

- Retardos de unidades: 1, 7, 14 y 28 días.
- Medias de los 7 y 28 días anteriores, calculadas después de `shift(1)`.
- Día de semana, mes, día de año y tendencia desde el inicio del panel.
- SKU, ubicación, canal, categoría, talla y color mediante
  `OneHotEncoder(handle_unknown="ignore")`.
- Los primeros 28 días se excluyen del ajuste por falta de historia completa.
- El pronóstico 7/30 es recursivo: las predicciones anteriores alimentan los
  retardos futuros; no se leen unidades reales posteriores al origen.

La prueba ancla del plan confirmó para el día 29: `lag_1=28`, `lag_7=22`,
`lag_28=1`, media pasada de 7 días `25` y de 28 días `14,5`.

## Selección en validación

El ajuste candidato usa solo entrenamiento hasta `2026-06-12`. Se compararon
dos profundidades declaradas antes de consultar prueba.

| Profundidad | MAE ponderado | MAE h7 | MAE baseline h7 | MAE h30 | MAE baseline h30 | Duración s |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 0,494131 | 0,490292 | 0,551603 | 0,495819 | 0,553765 | 412,686 |
| 12 | 0,496497 | 0,495428 | 0,551603 | 0,496967 | 0,553765 | 798,342 |

Se seleccionó profundidad 8 por menor MAE ponderado. Después se reajustó sobre
entrenamiento+validación hasta `2026-08-06`, sin cambiar parámetros al observar
prueba.

## Evaluación final congelada

| Horizonte | Orígenes | Observaciones | MAE modelo | MAE baseline | RMSE modelo | RMSE baseline | WAPE modelo | WAPE baseline |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7 días | 49 | 185.220 | 0,490040 | 0,556587 | 0,748583 | 1,036185 | 89,368% | 101,503% |
| 30 días | 26 | 421.200 | 0,492710 | 0,551683 | 0,751934 | 1,028284 | 89,752% | 100,495% |

El modelo supera al baseline sintético en MAE y RMSE para ambos horizontes. Sin
embargo, WAPE permanece alto porque el panel tiene demanda total baja, muchas
series dispersas y numerosos ceros. El resultado demuestra el pipeline y su
evaluación, no precisión comercial ni aptitud productiva.

WAPE con suma real cero se representa como `NO_APLICA`, valor `null` y motivo
`SUMA_REAL_CERO`; nunca se convierte en cero.

## Artefacto

- Ruta privada: `.local/analytics/b02/demand-model.joblib`.
- Tamaño: 2.565.030 bytes.
- SHA-256: `de9e0b7ea1b7528add4f4aeddaf8e9234a735518bfc0f0dc3ce65681cb8fda7c`.
- Tiempo total de corrida: 1.628,083 segundos (aprox. 27 min 8 s).
- Pico de memoria privada observado: aproximadamente 1,35 GB.

El artefacto se recargó desde su directorio autorizado después de validar el
hash. Un pronóstico de prueba de 7 días produjo 3.780 filas finitas y no
negativas, con valores entre 0,1174 y 1,9272 unidades.

## Verificación ejecutada

```powershell
Push-Location workers/analytics
& ../../.local/analytics-venv/Scripts/python.exe -m pytest tests/test_features.py tests/test_temporal_evaluation.py tests/test_demand.py tests/test_artifacts.py -q
& ../../.local/analytics-venv/Scripts/python.exe -m lumina_analytics.demand --panel ../../.local/analytics/b01/panel.csv --output ../../.local/analytics/b02 --estimators 200 --jobs 1
Pop-Location
```

Las pruebas enfocadas cubren features sin futuro, pronóstico recursivo,
baseline, fórmulas y WAPE N/A, categorías desconocidas, demanda no negativa,
hash de artefactos y rechazo de rutas externas.

## Limitaciones

- Entrenamiento y evaluación usan únicamente datos sintéticos diseñados.
- Las ventanas solapadas no son muestras independientes.
- No hay evaluación contra historial comercial real.
- Una serie con menos de 28 días debe devolver `MODEL_DATA_INSUFFICIENT`.
- El modelo no crea pedidos, compras, movimientos ni ajustes de inventario.
- B02 no implementa anomalías ni reposición; corresponden a B03.

## Handoff B02

- **Contrato producido:** pipeline de demanda, features, baseline, evaluación y
  artefacto verificable; todavía no consume el `AnalyticsJobV1` definitivo.
- **Archivos modificados:** `features.py`, `demand.py`, `baseline.py`,
  `evaluation.py`, `artifacts.py`, pruebas, README y este informe.
- **RF/CU cubiertos:** RF50–RF53; base de CU26–CU27.
- **Estado:** `VERIFICADO_LOCAL`; no integrado con API.
- **Toca esquema, raíz, firma o despliegue:** no.
- **Siguiente acción B:** B03, anomalías, reposición y CLI asíncrono.
- **Siguiente acción A requerida:** publicar G0a, `AnalyticsJobV1`, supervisor,
  rutas privadas y política de timeout/concurrencia para integración.
