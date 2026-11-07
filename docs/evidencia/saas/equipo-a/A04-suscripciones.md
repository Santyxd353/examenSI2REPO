# A04 — Suscripciones académicas e idempotencia

Fecha: 03/11/2026. Rama: desarrollo/servidor-web. Base: a4068ac.
RF02, RF03, RF27, RF34; CU02. Estado: VERIFICADO_LOCAL.

## Comportamiento implementado

Esencial149, Profesional299 y Negocio599 BOB por mes. El importe se obtiene
del catálogo del servidor. La pantalla exige aceptar el ciclo completo antes
de preparar Stripe TEST o QR_SIMULATED. No hay cargos LIVE ni renovaciones
automáticas en esta entrega académica: cada renovación requiere confirmación.

Una activación o cambio inmediato inicia un ciclo completo. Una renovación
anticipada del mismo plan extiende el acceso desde su vencimiento y conserva
el ancla y las cuotas del mes actual. Cancelar mantiene el acceso hasta el fin
pagado. La capacidad se revalida al preparar y al confirmar; un descenso
incompatible informa ocupación/límite y conserva todos los datos.

Las intenciones, el historial y los comprobantes se conservan en
platform.billing_event. Se permite una intención pendiente vigente por tienda.
UUID repetido devuelve su resultado; contenido diferente produce409. El evento
y el cambio de suscripción se confirman en una transacción de control usando
el mismo mutex que las escrituras comerciales breves. La llamada a Stripe se
realiza fuera de esa transacción con idempotencyKey estable. No hay promesa de
transacción distribuida entre control y base comercial.

El webhook usa bytes originales y firma del SDK. Su excepción al middleware
de tienda es exactamente POST /api/billing/stripe/webhook. Verifica entorno,
relación con intención/tienda/sesión, estado pagado, BOB e importe. Reenvíos no
extienden dos veces; una intención vencida o cuya versión cambió queda STALE
para revisión, sin reactivar el plan anterior. La redirección de Checkout solo
consulta el estado. El QR se rotula simulación y su confirmación exige permiso.
Se registra quién preparó, confirmó la simulación o canceló la renovación.

## Contrato para Android

Todas las rutas comerciales requieren token de la tienda, X-Tenant-Slug y
suscripcion:gestionar. Los importes del DTO son centavos BOB.

| Método/ruta después de /api | Entrada/salida |
| --- | --- |
| POST /tenant/subscription/checkout | `{planCode,provider,operationId,acceptCycleTerms:true}`; provider STRIPE_TEST o QR_SIMULATED |
| GET /tenant/subscription/checkouts | `{items:[SubscriptionCheckoutView]}`; diez intenciones recientes para recuperar una respuesta perdida |
| GET /tenant/subscription/checkouts/:id | Estado de una intención de la tienda; esta lectura nunca confirma un pago |
| POST /tenant/subscription/qr/:id/confirm | `{simulatedPayment:true}`; UUID de intención estable, confirmación idempotente |
| POST /tenant/subscription/cancel-renewal | `{operationId}`; devolver cancelAtPeriodEnd/periodTo y preservar acceso pagado |

@lumina/contracts exporta SubscriptionCheckoutSchema y
SubscriptionCheckoutViewSchema. El DTO contiene operationId, planCode,
amountMinor, currency, provider, status, cycleAction, expiresAt, checkoutUrl,
simulated y result. QR incluye qrPayload/qrDataUrl. Result incluye periodFrom,
paidThrough, subscriptionVersion y confirmedAt. Estados: INITIALIZING, PENDING,
APPLIED, STALE y EXPIRED. Solo APPLIED significa confirmado.

El UUID de una acción se conserva ante pérdida de respuesta. Una nueva acción
posterior usa otro UUID; por ejemplo, cancelar de nuevo después de renovar.
Recuperar recientes permite continuar tras recargar. B debe mostrar aceptación
de condiciones y consultar el comprobante al volver desde el navegador.

## Verificación y límites de evidencia

Las pruebas usan PostgreSQL local y una tienda nueva con su base independiente.
Stripe se comprueba con eventos firmados por el SDK y un adaptador de creación
de Checkout sustituido en el test. QR sí recorre la API y UI reales. No se ha
ejecutado una sesión contra una cuenta externa de Stripe ni desplegado A04.

Se reprodujeron y corrigieron: rutas inexistentes; retorno que abría catálogo;
UUID inválido que provocaba bloqueo anidado; cancelación duplicada al cambiar
mayúsculas; segunda cancelación que reutilizaba UUID del ciclo anterior; y
falta de identidad en la auditoría de confirmación/cancelación.

La compilación y los recorridos Chromium comprueban móvil390px, elección de
Profesional, QR, confirmación, cancelación, renovación, segunda cancelación y
consulta al regresar a la URL de Checkout. Resultados del03/11:

- npm test -- --cacheDirectory .local/jest:25suites,135pruebas aprobadas.
- npm run test:shared:11pruebas aprobadas.
- npm run build: compilación shared/API/web aprobada.
- node scripts/check-billing-ui.cjs: recorrido real Chromium aprobado;
  captura local billing-checkout-mobile.png revisada visualmente.

No se reprodujo el error transitorio de catálogo500 observado durante el
entorno anterior; el recorrido final y la regresión HTTP de catálogo pasan.
La recuperación PostgreSQL tras la interrupción se verificó antes de las
pruebas. No se eliminaron ni reconstruyeron las bases existentes.

## Configuración y referencias

STRIPE_SECRET_KEY debe empezar por sk_test_; STRIPE_WEBHOOK_SECRET por whsec_.
WEB_ORIGIN fija el retorno. Sin proveedor configurado se informa503 y no se
simula una aprobación Stripe. No se guardaron secretos en Git.

Stripe23.1.0 requiere Node>=20; aquí se verifica con Node22.19.0. El SDK actual
usa allowed_payment_method_types para filtrar tarjetas. Referencias primarias:
[Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[firmas y reenvíos](https://docs.stripe.com/events/manage-webhook-endpoints),
[confirmación por webhook](https://docs.stripe.com/checkout/fulfillment.md?ui=full-page),
[monedas](https://docs.stripe.com/currencies),
[raw body Nest](https://docs.nestjs.com/faq/raw-body),
[SDK y firmas de prueba](https://github.com/stripe/stripe-node),
[generación QR](https://github.com/soldair/node-qrcode).
