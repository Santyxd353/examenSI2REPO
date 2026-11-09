# B12 — Planes, consumos y suscripción TEST

Estado: `VERIFICADO_LOCAL` (09/11/2026).

- Mi negocio muestra plan, estado, vencimiento, ubicaciones, productos y equipo activo.
- Planes publicados: Esencial Bs 149, Profesional Bs 299 y Negocio Bs 599 por mes.
- La confirmación académica usa proveedor `QR_SIMULATED`, UUID idempotente y ciclo de 30 días.
- Antes de bajar de plan, el servidor compara límites contra consumo actual y no elimina datos.
- La UI indica de forma visible que no captura tarjeta ni realiza un cobro real.
- Repetir la confirmación con el mismo UUID crea un único evento de facturación.

Verificación: `subscription-test.test.ts` 1/1, build API correcto y respuesta confiable leída de
la plataforma después de confirmar.
