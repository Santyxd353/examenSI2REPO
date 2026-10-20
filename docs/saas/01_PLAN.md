# Plan de implementación — base SaaS

Objetivo: establecer aislamiento real de tiendas y navegación administrativa modular conservando Lúmina.
Diseño: [01_BASE_SAAS.md](01_BASE_SAAS.md). Alcance general: [ALCANCE_Y_ENTREGA.md](ALCANCE_Y_ENTREGA.md).
Ejecución: directa en la rama `desarrollo/saas-offline`, autorizada por la indicación de comenzar inmediatamente.

## Restricciones

- Reutilizar el stack y las migraciones existentes; sin una VM por tienda.
- Bases y archivos de producción se conservan; pruebas en bases identificadas exclusivamente como prueba.
- Web y APK transmitirán el mismo identificador de tienda.
- Stripe y QR simulado son métodos de suscripción distintos y deben conservar su procedencia.
- No declarar terminados offline, IA, ML o ICONIX final por tener solo tablas o pantallas.

## Tarea 1 — contexto y sesiones

Archivos: crear `apps/api/src/tenancy/context.ts`; modificar `auth.ts`, `db.ts`, `storage.ts`; prueba `apps/api/test/tenancy.test.ts`.
Interfaz: `runForTenant(context, callback)`, `currentTenant()`; contexto con `id`, `slug`, `name`, `databaseUrl`, `storageDirectory`, `state`.

- [x] Escribir y ejecutar pruebas de token de otra tienda, renovación cruzada y contexto concurrente; comprobar el fallo.
- [x] Implementar contexto, selección de cliente y vinculación de tokens.
- [x] Verificar aislamiento de directorios y conservación de rutas Lúmina.
- [x] Ejecutar pruebas focalizadas y batería completa antes del commit.

## Tarea 2 — registro de tiendas y provisión

Archivos: crear `prisma/platform/schema.sql`, `tenancy/platform.ts`, `tenancy/defaults.ts`, `scripts/create-tenant.ts`; modificar `app.ts`, `scripts/seed.ts`, `Dockerfile.azure` y ejemplos de configuración.
Interfaz: `TenantRegistry.resolve(slug)`, `listActive()`, `initialize()` y endpoint `/api/tenant`.

- [x] Probar tienda inexistente/suspendida, persistencia del plan y dos bases con identificadores iguales.
- [x] Crear registro de control y herramienta de provisión con nombre de base generado y migraciones existentes.
- [x] Agregar contexto al límite HTTP y separar recursos públicos por tienda.
- [x] Verificar que fallar la provisión no activa un negocio incompleto.

## Tarea 3 — trabajos, eventos y clientes

Archivos: modificar `realtime.ts`, `avatar-jobs.ts`, APIs web/móvil, sesión y URLs de archivos.
Interfaz: selección persistida de tienda; handshake WebSocket con `tenant`; salas por tienda/ubicación.

- [x] Probar eventos y trabajos en el contexto apropiado.
- [x] Implementar prefijos, contexto de colas y cabecera de clientes.
- [x] Revalidar sesión al cambiar tienda; limpiar estado de interfaz y aislar almacenamiento.

## Tarea 4 — navegación por módulos

Archivos: crear un catálogo de módulos y contenedor administrativo; separar vistas de `Admin.tsx` y `AdminDashboard.tsx` por responsabilidad.

- [x] Conservar permisos y recorridos de negocio al dividir la interfaz.
- [x] Mostrar negocio y conexión actuales en web; identidad del negocio en Android.
- [ ] Ampliar navegación administrativa por módulos en Android dentro del incremento offline.
- [x] Comprobar navegación, tipos y compilación con permisos de administrador, vendedor y analista.

## Cierre del incremento

- [x] Revisar criterios de aceptación del diseño y registrar evidencia en `ESTADO.md`.
- [x] Compilar API/web y verificar tipos/compatibilidad Expo.
- [x] Preparar el siguiente diseño: protocolo offline y conflictos, usando la identidad de tienda de este incremento.
