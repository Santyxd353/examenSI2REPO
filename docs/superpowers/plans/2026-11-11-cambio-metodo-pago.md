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
- No desplegar en la VM: todavía faltan sus credenciales.
- Agregar una migración nueva; no modificar migraciones ya aplicadas.

## Review Focus

- Respuesta perdida al crear Stripe: recuperar la misma sesión antes de habilitar QR.
- Pago simultáneo al cambio: reconocer Stripe si se completó, sin habilitar QR ni duplicar altas.
- Stripe no disponible: conservar la forma de pago actual y permitir reintentar.
- Rechazo definitivo del primer envío Stripe: conservar QR solamente si un único envío HTTP confirma que no se creó checkout; los reintentos implícitos del SDK cuentan como resultado incierto.
- Cambio de ida y vuelta: crear otra sesión Stripe, nunca reutilizar una vencida.
- Recarga y solicitudes simultáneas: conservar capacidad y datos, serializar operaciones y mantener una sola activación.

### Task 1: Cambio de proveedor en API

**Files:** `apps/api/src/tenancy/signup.ts`, `apps/api/src/billing/stripe.adapter.ts`, nueva migración `prisma/platform/migrations/202611110002_signup_payment_attempt.sql`, `apps/api/test/public-signup.test.ts`.

**Interfaces:** POST `/api/public/signup/:id/payment-method`, cabecera `X-Signup-Token`, cuerpo estricto `{provider: 'STRIPE_TEST' | 'QR_SIMULATED'}`; responde con la vista pública existente.

- [ ] Ejecutar las cinco pruebas actuales como línea base.
- [ ] Añadir regresiones HTTP: Stripe→QR conservando datos; autenticación/DTO; Stripe→QR→Stripe con nuevo intento; errores de Stripe; pago antes/durante el cambio; confirmación QR concurrente; recuperación tras respuesta perdida.
- [ ] Ejecutar pruebas y observar fallo por ruta ausente.
- [ ] Agregar contador de intentos, expiración Stripe y operación serializada. Sacar el aprovisionamiento de la transacción de cambio.
- [ ] Ejecutar pruebas hasta que pasen, incluidos reintentos y webhooks.

### Task 2: Selección en pantalla pendiente

**Files:** `apps/web/src/PublicSignup.tsx`, `apps/web/src/signup.css` si requiere estilos, `scripts/check-public-signup.cjs`.

**Interfaces:** Consumir la operación de Task 1, sin recrear el registro ni borrar `lumina.signup.pending`.

- [ ] Añadir prueba de navegador de registro Stripe recuperado: cambiar a QR, recargar, volver a Stripe; conservar id y datos; ocultar selector al activar.
- [ ] Observar fallo por control ausente.
- [ ] Mostrar selector durante PENDING y conservar errores recuperables; limpiar QR al pasar a Stripe y bloquear acciones mientras hay una solicitud.
- [ ] Verificar flujo y tamaños 320/390/768/1440 sin desbordamiento.

### Task 3: Verificación e integración

- [ ] Ejecutar build, pruebas compartidas, suite API y prueba de navegador sobre aplicación local.
- [ ] Revisión independiente del diff: capacidades, carreras, idempotencia, migración y accesibilidad del selector.
- [ ] Corregir hallazgos relevantes y repetir las comprobaciones afectadas.
- [ ] Publicar la corrección en GitHub y comunicar commit y límite de despliegue.
