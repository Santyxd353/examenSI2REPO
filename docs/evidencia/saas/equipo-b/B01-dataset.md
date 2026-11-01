# B01 — Dataset sintético femenino reproducible

Fecha: 2026-11-01 (`America/La_Paz`)

## Identidad y procedencia

- Rama: `desarrollo/android-ml`.
- Base del bloque: `2240445` (`B00`).
- Dataset: `demo-femenino-seed42-v1`.
- Fuente obligatoria: `DEMOSTRACION_SINTETICA`.
- Semilla: `42`.
- Versión del generador: `1.0.0`.
- Este corpus no contiene ventas, identidades, fotografías, pedidos ni
  inventario reales.

## Cobertura generada

| Dimensión | Resultado |
| --- | ---: |
| Fechas | 365 (`2025-10-01` a `2026-09-30`) |
| Productos femeninos demo | 12 |
| Variantes | 36, tres por producto |
| Ubicaciones demo | 5 |
| Canales | `WEB`, `APP`, `TIENDA` |
| Filas del panel | 197.100 |
| Filas con unidades cero | 114.858 |
| Mínimo/máximo de unidades | 0 / 8 |
| Claves duplicadas | 0 |
| Etiquetas de anomalía inyectada | 2.336 |

Cada fila representa una fecha, variante, ubicación y canal. Los importes se
guardan como centavos enteros y se comprobó que
`revenue_cents = units * unit_price_cents` en todo el panel.

## Partición temporal

| Partición | Desde | Hasta | Días |
| --- | --- | --- | ---: |
| Entrenamiento | 2025-10-01 | 2026-06-12 | 255 |
| Validación | 2026-06-13 | 2026-08-06 | 55 |
| Prueba | 2026-08-07 | 2026-09-30 | 55 |

Los primeros 28 días están declarados como calentamiento para las features de
B02. La partición se realiza por fechas completas, nunca aleatoriamente por
fila.

## Reglas de generación

- Panel cartesiano completo, incluidos ceros.
- Tasas base distintas por producto y variante.
- Factores explícitos de ubicación, canal y día de semana.
- Estacionalidad anual moderada, tendencia y eventos sintéticos documentados.
- Ruido determinista derivado de SHA-256 de la clave de fila y la semilla.
- Cantidades enteras no negativas y precios en centavos.
- La copia de anomalías se genera después del panel base.
- Etiqueta, tipo y magnitud de anomalía se guardan en un archivo separado y no
  aparecen como columnas del panel alterado.

Estas reglas fueron diseñadas para demostración; no son patrones observados en
el mercado ni acreditan precisión comercial.

## Archivos privados generados

Ubicación local ignorada por Git: `.local/analytics/b01`.

| Archivo | Bytes | SHA-256 |
| --- | ---: | --- |
| `panel.csv` | 33.377.255 | `6c7fd89c040318fd81d9533c139e18dbee42064db4b8f167a1f64432cb1c1b02` |
| `anomaly-panel.csv` | 33.379.592 | `f5d96d49e5148f498a2d75f14f8839521a4b3af263e121fec86456e5e60bf08c` |
| `anomaly-labels.csv` | 271.217 | `a5c32b58b671a98432d492bfbe0481b862f94e23fe66567be64c634ca2f1311c` |
| `catalog.json` | 6.533 | `ba7898f56733fd2ef35ec81c9ecc5a4c507dd8f7cd37619dfea6b2a0a3c564c3` |
| `manifest.json` | 1.961 | hash reproducible `bec47cd8cc9bcb08d8d304400e17dade34ac8f1df244050ed5a9eb95afe9db32` |

El corpus pesado no se agrega a Git. Se regenera mediante código, semilla y
dependencias fijadas.

## Dependencias verificadas

- Python 3.11.6.
- NumPy 2.3.4.
- pandas 2.3.3.
- scikit-learn 1.7.2.
- joblib 1.5.2.
- pytest 8.4.2.

El lock incluye también las dependencias transitivas resueltas. `pip check`
informó `No broken requirements found`.

## Verificación ejecutada

```powershell
$taskMlPython = '.local/analytics-venv/Scripts/python.exe'
& $taskMlPython -m pip install -r workers/analytics/requirements.lock.txt
Push-Location workers/analytics
& $taskMlPython -m pytest tests/test_synthetic.py tests/test_manifest.py -q
& $taskMlPython -m lumina_analytics.synthetic --output ../../.local/analytics/b01
Pop-Location
```

Resultado: `8 passed`. La generación completa tardó aproximadamente 8,5
segundos en este equipo. Se ejecutó dos veces: los hashes de todos los archivos
y el hash reproducible del manifiesto coincidieron; `generatedAt` cambió y no
forma parte de ese hash.

## Límites

- El panel diario no contiene hechos suficientes para calcular pedidos
  distintos, vendedores, pagos, devoluciones ni ticket promedio.
- No se inserta en tablas de pedidos, pagos, stock o movimientos reales.
- No hay entrenamiento ni métricas de modelo en B01; corresponden a B02/B03.
- Las etiquetas de anomalía son solo para evaluación sintética posterior.

## Handoff B01

- **Contrato producido:** panel CSV, catálogo, manifiesto y copia de anomalías
  en namespace demo; todavía no consume `AnalyticsJobV1` de A.
- **Archivos modificados:** `workers/analytics/lumina_analytics/**`, pruebas,
  fixture, requisitos y este informe.
- **RF/CU cubiertos:** RF50/RF51 y base de CU26, verificados localmente.
- **Estado:** `VERIFICADO_LOCAL`; no integrado con API.
- **Toca esquema, raíz, firma o despliegue:** no.
- **Siguiente acción B:** B02, features retardadas y evaluación temporal.
- **Siguiente acción A requerida:** publicar G0a y el DTO definitivo de dataset
  y `AnalyticsJobV1` para adaptar el CLI sin inventar contratos.
