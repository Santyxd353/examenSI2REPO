# A02 — Ampliación de datos y migraciones

Fecha: 02/11/2026. Estado: VERIFICADO_LOCAL. Base:8012e02.
Rama: desarrollo/servidor-web. No se aplicó esta migración a la VM.

Se agregan las seis tablas del diccionario ICONIX: operacion_sincronizacion,
definicion_reporte, conjunto_reporte, conjunto_entrenamiento, metrica_modelo
y consumo_cuota; con sus campos, FK, índices, unicidad y CHECK.
Producto/variante reciben versión y timestamp; modelos/ejecuciones/consultas
incorporan dataset, procedencia, artefactos, ámbito y canal de entrada.
Legado conserva REGLA_LEGADA, sin presentarlo como entrenamiento ejecutado.

La migración es aditiva y transaccional. Repetirla conserva las versiones de
catálogo ya avanzadas. Normaliza inventario.version antiguo0 a1 para el contrato
de sincronización; A05 deberá mantener1 en los nuevos escritores antes de A07.
No modifica unidades físicas, reservadas, comprometidas o disponibles.

Control tiene migración versionada de suscripción/eventos, con checksum SHA256
normalizado a LF y registro técnico platform.schema_migration. Ese registro es
metadata de despliegue, equivalente al historial Prisma, no una séptima entidad
comercial. TenantRegistry lo ejecuta bajo su transacción/lock de control.
SQL alterado después de aplicado falla con MIGRATION_CHECKSUM_MISMATCH.

El migrador de tiendas incluye ahora Lúmina y ubicaciones suspendidas del
registro; ya no omite el negocio inicial. Preparación de tests aplica también
la ampliación antes de usar el cliente Prisma regenerado.

## Verificación ejecutada

- RED inicial: tablas/migración/módulo inexistentes. RED específico observado
  para N/A sin motivo y modelo entrenado sin hash; corregidos mediante CHECK
  explícitos que no permiten que NULL eluda la restricción.
- `npm test -- --runTestsByPath apps/api/test/saas-schema.test.ts
  apps/api/test/tenant-database.test.ts apps/api/test/tenant-provision.test.ts`:
  **3 suites,20/20**. Dos bases pobladas independientes con mismos UUID/SKU;
  se conservan datos/saldo y las migraciones son repetibles.
- `npm test`: **19 suites,108/108** aprobadas.
- `npm run build`: paquetes, API y web aprobados.
- `node scripts/check-admin-ui.cjs`: módulos, venta persistida y responsive OK.
- `node scripts/check-schema-restore.cjs`: pg_dump/pg_restore local comprobó
  restaurar respaldo anterior para reversión y respaldo migrado con las seis
  tablas; identidad QA conservada. Bases temporales limpiadas por nombre exacto.

Los dumps/logs se guardan en .local del worktree, no Git. No se agregaron
datos sintéticos a pedido, pago, inventario o movimientos. Ninguna tabla por sí
sola acredita que sincronización, reportes o entrenamiento estén integrados;
sus servicios y pantallas corresponden a A03–A15.
