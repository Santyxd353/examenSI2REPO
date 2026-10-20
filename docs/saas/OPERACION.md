# Operación de las tiendas SaaS

## Identificar el negocio

Lúmina conserva el identificador `lumina`. En web se elige una tienda en la cabecera o se abre `/?tienda=identificador`. En Android se escribe el identificador en el inicio de sesión. Las cuentas pertenecen a su tienda; usar el mismo correo en otra no comparte permisos ni compras.

Las peticiones de API usan `X-Tenant-Slug`. Omitirlo conserva la compatibilidad con Lúmina. La tienda se valida antes de consultar datos, servir archivos o autenticar. El registro de control no expone credenciales, nombres de bases ni funciones administrativas públicas.

## Crear una tienda

Aplica primero las migraciones de la base inicial. Desde la raíz del proyecto, configura `DATABASE_URL`, `JWT_SECRET` y `STORAGE_ROOT` como en `.env.example`. La identidad PostgreSQL de provisión debe poder crear bases; esa capacidad no se entrega a las cuentas administradoras de la aplicación.

La contraseña inicial se pasa como variable de entorno de la terminal. No debe guardarse en un archivo versionado. Ejemplo de ejecución una vez configurada:

```powershell
npm run tenant:create -- --slug boutique-ejemplo --name "Boutique Ejemplo" --email duena@ejemplo.com --plan pro
```

Se crea una base con nombre generado, se ejecutan todas las migraciones de negocio, se registran roles y cuenta administradora y se prepara el directorio de archivos. El catálogo empieza vacío; las prendas de Lúmina no se copian a otro negocio. La prueba inicial dura catorce días. `esencial`, `pro` y `negocio` son plantillas de capacidad; aún no tienen un precio comercial publicado.

Una preparación fallida queda marcada `FAILED`, con identificador reservado. El operador debe revisar la causa antes de reintentar; la herramienta no borra automáticamente bases ni archivos que puedan requerir recuperación.

La capacidad se comprueba en servidor dentro de la transacción: productos almacenados, ubicaciones activas y personal activo, incluyendo a la administradora. Los clientes compradores no consumen puestos del equipo. Las solicitudes concurrentes no pueden saltarse esos límites. El espacio inicial `lumina` con plan `piloto` conserva sus datos sin estas cuotas comerciales.

## Actualizar el servidor

1. Respaldar el registro de control, todas las bases comerciales y el volumen de archivos. Respaldar solo `vestidor18` no cubre las tiendas adicionales.
2. Construir la imagen con `Dockerfile.azure`.
3. Al arrancar, el contenedor migra la base inicial y ejecuta `tenant:migrate` en cada tienda preparada, incluidas las suspendidas. Si una migración falla, no inicia esa versión de la API.
4. Verificar `/api/health`, el catálogo inicial y los accesos a dos tiendas. Conservar la imagen anterior para revertir el código si es necesario. Los cambios de esquema requieren su propio plan de reversión.

En desarrollo, después de las migraciones de Lúmina:

```powershell
npm run tenant:migrate
```

El servidor conserva hasta veinticuatro clientes Prisma adicionales con dos conexiones por tienda. Al alcanzar esa capacidad rechaza una conexión nueva con 503; no reasigna peticiones a otra tienda. La ampliación del servicio requiere ajustar capacidad y gestión de conexiones antes de admitir más tiendas.

## Suscripción y archivos privados

Una suscripción vencida mantiene las consultas, el inicio de sesión y la renovación de sesión. Bloquea las escrituras comerciales con 402. Una tienda suspendida no entrega su catálogo. El mantenimiento sigue purgando fotos vencidas y avatares eliminados de todas las tiendas preparadas; dejar de pagar no prolonga la conservación de fotografías.

Stripe y QR simulado son las formas de cobro elegidas para el siguiente incremento. Los planes no ejecutan cobros todavía. El QR se identificará como demostración; no se presentará una confirmación simulada como una transferencia bancaria real.

## Comprobar cambios

Jest y la prueba de navegador redirigen las conexiones de negocio y control a `vestidor18_test`. Preparar esa base primero:

```powershell
npm run db:prepare-test
npm test
npm run test:admin-ui
npm run mobile:typecheck
npm run mobile:check
npm run mobile:pose-test
```

La prueba de navegador necesita Chromium instalado para Playwright. Verifica navegación administrativa, anchos de escritorio y móvil, venta persistida y confirmación visual, y módulos permitidos para administradora, vendedora y analista. Las pruebas de aislamiento crean bases temporales y las eliminan al terminar con nombres y rutas validados.
