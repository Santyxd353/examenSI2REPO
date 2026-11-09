# A16 — ensayo local de recuperación

Fecha: 08/11/2026. Base de aplicación: `8a71168`. Resultado: **aprobado localmente; A16 continúa abierto**.

## Qué se comprobó

El ensayo crea seis bases PostgreSQL temporales con un prefijo aleatorio propio: control y dos tiendas de origen, y sus tres destinos vacíos. No lee ni respalda las tiendas comerciales existentes. Aplica las migraciones reales de Prisma, prepara el control con `TenantRegistry` y crea datos identificados como sintéticos.

Las tiendas tienen el mismo usuario, SKU e IDs comerciales, pero inventarios distintos: cuatro y nueve unidades. Se conservaron los planes Esencial y Negocio, los IDs de tienda y las versiones de inventario. Esto comprueba que las conexiones restauradas no intercambian los negocios.

Se ejecutaron `pg_dump` y `pg_restore` reales sobre las tres bases. Se actualizaron los destinos físicos en el control y se resolvieron de nuevo las tiendas con el registro de la aplicación. Prisma volvió a ejecutar `migrate deploy` sobre ambas bases recuperadas sin migraciones pendientes.

Se copiaron cuatro archivos de QA, incluidos dos pendientes cifrados con AES-GCM. Se verificaron rutas relativas, tamaños y SHA-256. Los otros archivos son binarios sintéticos para probar integridad; no se presentan como avatares o modelos entrenados válidos.

El servicio real `DeviceKeysService` generó y rotó la envoltura de claves de la versión 1 a la 2, conservando cada DEK. El respaldo de QA conservó ambas versiones. Tras restaurar:

- Una clave de envoltura incorrecta fue rechazada sin insertar una clave de reemplazo.
- El anillo correcto recuperó exactamente las claves anteriores.
- Cada pendiente cifrado volvió a abrirse con el contenido esperado.
- La misma identidad y dispositivo en tiendas distintas conservaron claves diferentes.

El proceso cerró sus conexiones y eliminó únicamente las seis bases temporales que había creado, comprobando sus nombres. El resultado exitoso se escribe después de completar esa limpieza.

## Resultados observados

La ejecución final terminó con salida cero en **48 segundos**: tres bases restauradas, cuatro archivos verificados, recuperación aprobada en dos tiendas y `cleanupCompleted=true`. Evidencia local ignorada por Git: `.local/saas-recovery/lumina_recovery_29b74b376e7f/summary.json`.

El verificador de archivos tuvo una prueba inicial fallida por módulo ausente y después aprobó **cuatro pruebas**, sin omitidas: bytes/tamaño/hash, corrupción del mismo tamaño, archivos faltantes/adicionales y rechazo de rutas externas, duplicadas o hashes inválidos. También rechaza enlaces simbólicos al recorrer el árbol.

La plantilla `infra/vm/.env.example` incluye las variables requeridas y el valor inicial `RUN_DB_SEED=false`. Compose volvió a validar con valores temporales de QA, sin iniciar servicios.

## Cómo repetir

Requiere Node, dependencias instaladas, Prisma generado y PostgreSQL local preparado. `PG_BIN` permite indicar la carpeta de `pg_dump` y `pg_restore`; en Windows se usa por defecto PostgreSQL 18.

```powershell
node --test scripts/test-recovery-manifest.cjs
$env:SAAS_QA_DATABASE_URL='postgresql://postgres@127.0.0.1:55419/vestidor18_test?schema=public&connection_limit=2'
node scripts/check-saas-recovery.cjs
```

El ensayo se rechaza si la conexión no corresponde a localhost y `vestidor18_test`. Los dumps, archivos y claves **sintéticas** quedan dentro de `.local`; no se imprimen las claves ni se versionan. Es un ensayo de QA y no una herramienta para respaldar producción.

## Límites y siguiente fase

- Se ejecutó en Windows con PostgreSQL 18. Falta comprobar la imagen Linux y PostgreSQL 16 configurado actualmente en Compose, incluidos roles, permisos y volúmenes.
- Una migración real requiere un corte con escrituras y workers detenidos, de control, todas las tiendas y archivos. Los secretos y versiones de claves reales se conservan en una bóveda separada; el archivo de claves de QA no se utiliza en producción.
- No se midieron RPO/RTO de producción ni se ensayó recuperación de certificados HTTPS, proveedores externos o firma del APK.
- La nueva VM, el respaldo real y la restauración sobre ella permanecen pendientes. No se hicieron operaciones en la VM anterior ni se ejecutó un APK.
