# Cambio de forma de pago del registro público

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir volver de Stripe TEST y elegir QR sin perder el registro ni habilitar dos pagos para la misma tienda.

**Architecture:** Una operación autenticada por la capacidad del registro cambia su proveedor pendiente. Un bloqueo de sesión por registro y bloqueo de fila serializan cambios, confirmaciones y webhooks, incluso al confirmar la intención antes de llamar a Stripe; antes de pasar de Stripe a QR se comprueba y vence el checkout remoto. Cada nuevo intento Stripe tiene su propia clave de idempotencia, conservando la clave histórica del intento cero.

**Tech Stack:** NestJS, PostgreSQL, Stripe TEST, React, Jest/Supertest, Playwright.

**Spec:** Solicitud del usuario del 11/11/2026: volver tras elegir Stripe y poder seleccionar QR en la última versión oficial (base `47b3e2f`).

## Global Constraints

- Conservar tienda, credenciales, plan, importe y capacidad existentes.
- Solo se puede cambiar una solicitud PENDING no vencida; un pago completado se reconoce, no se reemplaza.
- No modificar precios ni activar cobros LIVE.
- Desplegar en la VM cuando el usuario facilite acceso SSH. La credencial se recibió después de publicar la corrección y se usó para completar el despliegue el 11/11/2026.
- Agregar una migración nueva; no modificar migraciones ya aplicadas.

## Review Focus

- Respuesta perdida al crear Stripe: recuperar la misma sesión antes de habilitar QR.
- Pago simultáneo al cambio: reconocer Stripe si se completó, sin habilitar QR ni duplicar altas.
- Stripe→QR con Stripe no disponible: conservar Stripe y permitir reintentar. QR→Stripe con respuesta incierta: conservar la intención Stripe para poder recuperar y cerrar un posible checkout antes de volver a QR.
- Rechazo definitivo del primer envío Stripe: conservar QR solamente si un único envío HTTP confirma que no se creó checkout; los reintentos implícitos del SDK cuentan como resultado incierto.
- Cambio de ida y vuelta: crear otra sesión Stripe, nunca reutilizar una vencida.
- Recarga y solicitudes simultáneas: conservar capacidad y datos, serializar operaciones y mantener una sola activación.

### Task 1: Cambio de proveedor en API

**Files:** `apps/api/src/tenancy/signup.ts`, `apps/api/src/billing/stripe.adapter.ts`, nueva migración `prisma/platform/migrations/202611110002_signup_payment_attempt.sql`, `apps/api/test/public-signup.test.ts`, `apps/api/test/public-signup-payment.test.ts`, `apps/api/test/saas-schema.test.ts`.

**Interfaces:** POST `/api/public/signup/:id/payment-method`, cabecera `X-Signup-Token`, cuerpo estricto `{provider: 'STRIPE_TEST' | 'QR_SIMULATED'}`; responde con la vista pública existente.

- [x] Ejecutar las cinco pruebas actuales como línea base.
- [x] Añadir regresiones HTTP: Stripe→QR conservando datos; autenticación/DTO; Stripe→QR→Stripe con nuevo intento; errores de Stripe; pago antes/durante el cambio; confirmación QR concurrente; recuperación tras respuesta perdida.
- [x] Ejecutar pruebas y observar fallo por ruta ausente.
- [x] Agregar contador de intentos, expiración Stripe y operación serializada. Sacar el aprovisionamiento de la transacción de cambio.
- [x] Ejecutar pruebas hasta que pasen, incluidos reintentos y webhooks.

### Task 2: Selección en pantalla pendiente

**Files:** `apps/web/src/PublicSignup.tsx`, `apps/web/src/signup.css` si requiere estilos, `scripts/check-public-signup.cjs`.

**Interfaces:** Consumir la operación de Task 1, sin recrear el registro ni borrar `lumina.signup.pending`.

- [x] Añadir prueba de navegador de registro Stripe recuperado: cambiar a QR, recargar, volver a Stripe; conservar id y datos; ocultar selector al activar.
- [x] Observar fallo por control ausente.
- [x] Mostrar selector durante PENDING y conservar errores recuperables; limpiar QR al pasar a Stripe y bloquear acciones mientras hay una solicitud.
- [x] Verificar flujo y tamaños 320/390/768/1440 sin desbordamiento.

### Task 3: Verificación e integración

- [x] Ejecutar build, pruebas compartidas, suite API y prueba de navegador sobre aplicación local.
- [x] Revisión independiente del diff: capacidades, carreras, idempotencia, migración y accesibilidad del selector.
- [x] Corregir hallazgos relevantes y repetir las comprobaciones afectadas.
- [x] Publicar la corrección en GitHub y comunicar commit y límite de despliegue.

## Resultado verificado

- Código probado y publicado en `main`: `7c52003` (base `47b3e2f`).
- API: 52 suites, 277 pruebas aprobadas; contratos/reporting compartidos: 25 aprobadas.
- Compilación de API y web aprobada. Navegador: formulario y cambio Stripe→error recuperable→QR→recarga→Stripe→QR→activación en 320, 390, 768 y 1440 px; sin errores JavaScript ni desbordamiento.
- Revisión independiente: el único hallazgo importante quedó corregido y comprobado con SDK real y transporte HTTP de prueba, incluidos reintentos implícitos.
- Migración de altas existentes conserva credenciales y checkout e inicializa el intento cero sin alterar su clave de idempotencia.
- Despliegue posterior en la nueva VM completado con acceso SSH proporcionado por el usuario: código `9ab049f`, migración aplicada, respaldo privado y recuentos conservados. Prueba real publicada Stripe→QR→recarga→Stripe→QR y limpieza del registro sintético aprobadas. No se confirmó ningún pago durante esta prueba ni se ejecutó APK.
