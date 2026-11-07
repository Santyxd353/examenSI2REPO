# A13 · Puente local del worker analítico

Se incorporó `workers/analytics` desde `desarrollo/android-ml` en `aa8d8e9`, junto con la evidencia B01–B03. El código del worker conserva el generador, la evaluación temporal de demanda, las anomalías y la reposición desarrollados por el equipo B.

El adaptador de Node invoca el CLI Python con argumentos separados y un entorno acotado. Genera el directorio privado a partir de la tienda y la cuenta. Limita el tiempo, la salida del proceso y el tamaño del documento, valida el SHA-256 y compara la tienda, cuenta, fuente, acción y ejecución antes de devolver la salida al servicio. El entrenamiento de demanda tiene un límite de 60 minutos por la corrida B02 de 27 minutos. Las demás acciones tienen un límite de cinco minutos.

Para la integración, el servicio debe construir las rutas internas y verificar cada artefacto antes de reutilizarlo. El controlador deberá aceptar campos funcionales del trabajo y resolver el modelo y los archivos en el servidor. El puente se probó con una copia Git local porque el CLI B03 resuelve su raíz desde esa estructura.

## Verificación

- Python 3.11 en un entorno separado con `requirements.lock.txt`. Las 24 pruebas del worker pasaron.
- `npm run build:api` y `npm test -- --cacheDirectory .local/jest --runTestsByPath apps/api/test/analytics-worker.test.ts`. Las dos pruebas del puente comprobaron la salida autorizada y el rechazo de otro tenant, un hash alterado y una ruta fuera del trabajo.
- `node scripts/check-analytics-worker.cjs` generó 197.100 filas sintéticas y comprobó el SHA-256 de los cuatro archivos del manifiesto. El puente recibió métricas del entrenamiento real de `anomaly-iforest-seed42-v1` y una sugerencia de reposición de seis unidades sobre el ejemplo de B03.

El incremento posterior conecta la cola, el guardado de métricas y modelos, los endpoints y la pantalla administrativa. Sus resultados y comandos están en A13-api-handoff.md. Los datos de demostración permanecen sintéticos y el despliegue queda para la nueva VM.
