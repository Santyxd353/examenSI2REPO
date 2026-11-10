# B11 — Asistente de reportes por texto y voz

Estado: agente integrado y pruebas controladas aprobadas. Generación real bloqueada por el plan del proyecto de Google (09/11/2026).

- La pantalla real de Reportes incorpora pregunta editable y dictado nativo Android.
- El servidor puede usar Gemini GenerateContent u OpenAI Responses con herramienta de solo lectura; la clave permanece
  exclusivamente en el servidor y el modelo no recibe SQL ni acceso directo a Prisma.
- Las consultas del agente exigen proveedor configurado y disponible; los errores se muestran en pantalla.
- Sin conexión, responde únicamente ventas, pedidos y producto líder desde el dashboard cifrado;
  identifica explícitamente el modo offline y no inventa otros datos.
- Permiso de micrófono denegado y proveedor/red no disponible producen mensajes recuperables.

Verificación: pruebas `offlineReportAssistant.test.ts`, módulo nativo `report-speech` enlazado en
la APK ARM64 y typecheck correcto. La prueba de voz real se registra en B15.

En el TECNO KL4, el campo de pregunta mostró «Cuantos pedido uno este mes». La
respuesta en modo local indicó 8 pedidos confirmados por Bs 6070.00, coincidiendo
con el tablero del mismo período. La lectura de pantalla verifica texto y respuesta.

## Dashboard de consultas

Web y Android consultan `POST /analytics/assistant/query`. El agente interpreta la pregunta
y llama a `generar_reporte` con un plan de hasta cuatro representaciones. Cada una declara
métrica, dimensión, período, filtros de prendas y ubicación, límite y orden. Se admiten barras,
líneas, circular, dona, tabla e indicadores. El servidor valida el plan y ejecuta SQL parametrizado
con dimensiones permitidas y alcance de tienda/usuario. El agente recibe los resultados para
redactar la interpretación. Las cifras dibujadas proceden de esa consulta.

`REPORTS_AI_PROVIDER=gemini`, `GEMINI_API_KEY` y `GEMINI_REPORTS_MODEL=gemini-2.5-flash`
seleccionan Gemini. Se conserva la alternativa OpenAI mediante configuración de servidor.
Las claves están excluidas de Git. Android y web permiten dictado. La consulta offline de
un reporte guardado se identifica explícitamente y conserva su funcionamiento local de lectura.

Validación: 10/10 pruebas API de reportes, 50/50 móviles, build web/API y typecheck móvil.
Las pruebas incluyen planes diferentes para ventas por ubicación en circular y unidades por
talla en barras, cifras esperadas y conservación de firmas nativas de Gemini entre herramientas.
Playwright validó seis representaciones y ancho de 390 px con fixture de interfaz.

La prueba real reconoció la clave de Gemini (listado de modelos HTTP 200). La generación
devolvió HTTP 403 con `PERMISSION_DENIED`: Google indica que el nivel gratuito no está
disponible para este proyecto y pide configurar facturación. OpenAI también devolvió cuota
insuficiente. Se requiere que el propietario habilite acceso de generación en su proveedor
para completar la aceptación real. Ninguna respuesta simulada se presenta como generación real.

APK actualizada instalada en el TECNO: `dist/android/lumina-qa-agente-gemini-arm64.apk`.
SHA-256: `65136CE7241C00E6751A9DB944D2EA58E187DD5979A9797B5EE8A13DC9F3DFE5`.
Una consulta real de ventas por sucursal desde Android llegó al servidor y mostró el mensaje
controlado de acceso gratuito bloqueado por Google. La app permaneció abierta sin excepción fatal.
