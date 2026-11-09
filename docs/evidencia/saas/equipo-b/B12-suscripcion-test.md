# B12 — Planes, consumos y suscripción TEST

Estado: `VERIFICADO_LOCAL` (09/11/2026).

- Mi negocio muestra plan, estado, vencimiento, ubicaciones, productos y equipo activo.
- Planes publicados: Esencial Bs 149, Profesional Bs 299 y Negocio Bs 599 por mes.
- La confirmación académica usa proveedor `QR_SIMULATED`, UUID idempotente y ciclo de 30 días.
- Antes de bajar de plan, el servidor compara límites contra consumo actual y no elimina datos.
- La UI indica de forma visible que no captura tarjeta ni realiza un cobro real.
- Repetir la confirmación con el mismo UUID crea un único evento de facturación.

## Checkout alojado y cancelación

En Mi negocio se puede abrir Stripe Checkout TEST para contratar el plan mensual. La API conserva
el Checkout pendiente por tienda. Android vuelve a consultar al recuperar el primer plano.
Un regreso sin pagar conserva el plan actual y permite retomar o descartar la sesión.
La cancelación de renovación mantiene el acceso hasta la fecha que devuelve Stripe.
Para servir la página de retorno fuera del laboratorio USB, configurar
`SUBSCRIPTION_API_ORIGIN` con el origen público del API.

Validación del 09/11/2026 en base de prueba y tienda temporal:

- Las pruebas de suscripción cubrieron precio, idempotencia, salida sin pago y descarte.
- `node scripts/check-plan-checkout-test.cjs` abrió el Checkout real de Stripe en modo TEST,
  pagó un plan Negocio con tarjeta de prueba y verificó la activación en la base.
  Tras cancelar la renovación, el estado siguió activo con la misma fecha de fin.
  La prueba liberó su suscripción de sandbox y su tienda temporal.
