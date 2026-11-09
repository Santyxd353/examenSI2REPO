# B11 — Asistente de reportes por texto y voz

Estado: `VERIFICADO_LOCAL_CON_PROVEEDOR_OPCIONAL` (09/11/2026).

- La pantalla real de Reportes incorpora pregunta editable y dictado nativo Android.
- El servidor puede usar OpenAI Responses con herramienta de solo lectura; la clave permanece
  exclusivamente en el servidor y el modelo no recibe SQL ni acceso directo a Prisma.
- Si el proveedor no está configurado, usa el intérprete determinista autorizado del servidor.
- Sin conexión, responde únicamente ventas, pedidos y producto líder desde el dashboard cifrado;
  identifica explícitamente el modo offline y no inventa otros datos.
- Permiso de micrófono denegado y proveedor/red no disponible producen mensajes recuperables.

Verificación: pruebas `offlineReportAssistant.test.ts`, módulo nativo `report-speech` enlazado en
la APK ARM64 y typecheck correcto. La prueba de voz real se registra en B15.

En el TECNO KL4, el campo de pregunta mostró «Cuantos pedido uno este mes». La
respuesta en modo local indicó 8 pedidos confirmados por Bs 6070.00, coincidiendo
con el tablero del mismo período. La lectura de pantalla verifica texto y respuesta.

## Dashboard de consultas

Web y Android consultan `POST /analytics/assistant/query`. La respuesta incluye proveedor,
reporte autorizado y cuatro conjuntos de gráficos: ventas diarias, productos, ubicaciones
e inventario. El gráfico inicial depende del tema consultado. La interfaz permite elegir
barras, líneas o dona y consultar los valores exactos. La serie diaria incluye días sin ventas.
Los reportes offline nuevos conservan la serie y el inventario. Las copias antiguas conservan
productos y sucursales y muestran la ausencia de datos en las series que no habían guardado.

El API usa OpenAI Responses cuando existen `OPENAI_API_KEY` y `OPENAI_REPORTS_MODEL` en el
servidor. El entorno local actual carece de ambas variables y responde en modo local.
El proveedor dispone de un plazo total de 15 segundos, con retorno local ante indisponibilidad.
La prueba de integración simula Responses para verificar lectura de mensajes REST y que las
herramientas respeten el período y la ubicación de la consulta.

Validación: 9/9 pruebas API de reportes, 50/50 pruebas móviles y build web/API y typecheck
móvil aprobados. Playwright verificó los tres gráficos en escritorio y ancho de 390 px.
La APK se instaló en el TECNO y una consulta de sucursales mostró el dashboard y sus controles.
Artefacto local: `dist/android/lumina-qa-reportes-arm64.apk`.
