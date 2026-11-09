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
