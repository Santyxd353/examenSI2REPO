# A03 — Planes, provisión y cuotas

Fecha: 02/11/2026. Rama: desarrollo/servidor-web. Base: 484f53b.
Estado: VERIFICADO_LOCAL. RF01–RF07, RF20, RF34; CU01–CU05.

Se publican `GET /api/tenant/plans` y `GET /api/tenant/subscription` con
contrato @lumina/contracts 1.0. Esencial149/Profesional299/Negocio599 BOB;
ubicaciones1/5/20, personal3/15/100, productos200/2000/10000,
avatares30/150/500, reportes3/15/50 e IA0/100/500.
La lectura de consumo requiere suscripcion:gestionar; Cliente no consume
personal. Productos archivados siguen contando como registros.

El piloto Lúmina se conserva sin cargo y se identifica con legacyPilot=true,
priceMinor=0. Su compatibilidad no constituye un cuarto plan comercial.
paidThrough separa acceso prepagado del período mensual de cuotas.
Períodos usan aniversario civil America/La_Paz, mantienen el día original31
y límites [desde,hasta). El trial conserva su ventana de14días.

QuotaService reserva, confirma y libera en transacciones de negocio con
bloqueos por referencia/período. Repetir UUID no consume otra unidad y una
reserva confirmada no se libera por reintento tardío. El servicio está probado
en PostgreSQL; su conexión con trabajos de avatar e interpretación corresponde
a A06/A12. No se presenta como proveedor ya conectado.

Las escrituras cortas autenticadas usan un mutex de control por tienda y
revalidan autorización/vigencia. Cambios de suscripción deben usar el mismo
subscriptionLockKey. No hay transacción distribuida entre bases. Uploads,
proveedores, cobros y sincronización tienen que adquirir su lease breve en el
servicio correspondiente; el interceptor no retiene conexiones durante I/O.

Portal global `/?plataforma=1`: login separado y provisión real de tienda con
propietaria, plan y base independiente. Rutas /api/platform/operator/login y
/tenants; JWT con issuer/audience/scope separados de los tokens comerciales.
Configuración opcional documentada en .env.example; sin ella el portal informa
indisponibilidad. No se persistió una contraseña de operadora en Git ni VM.
El CLI de provisión se mantiene. Una provisión fallida conserva estado FAILED.

## Evidencia

- RED→GREEN en períodos, cuotas, separación de operadora y pantallas.
- npm test: 23 suites,124 pruebas aprobadas, sin omitidas.
- npm run test:shared:11 pruebas aprobadas.
- npm run build: API y web aprobados.
- Chromium: alta real desde portal, login aislado, planes/consumos, ancho390px,
  recuperación de error de conexión y controles sin solapamiento.
- Concurrencia real: mutex impide cambio de versión de suscripción durante
  escritura; cuota29confirmados+dos reservas paralelas permite solo una.

Handoff B: consumir las dos lecturas con X-Tenant-Slug. No deducir vigencia del
reloj móvil ni usar priceMinor como prueba de pago. G0b/Hermes sigue pendiente
de evidencia B. Checkout, QR y webhook se publican en A04. No desplegado.
