# Registro público de Lúmina

El modelo de referencia es RR-HH (`juancarlosperezarauco-hue/RR-HH`, `main`): elegir plan, registrar empresa y propietario, pagar y acceder a un negocio independiente. La interfaz conserva la identidad visual de Lúmina. No se importa código ni credenciales de RR-HH.

Precios base comprobados en `PlatformBootstrapService.java` de la referencia:

| Referencia | Lúmina | Mensual USD | Anual USD |
| --- | --- | ---: | ---: |
| Demo | Demo, herramientas Profesional | 0, por 10 días | — |
| Basic | Esencial | 9,99 | 99,99 |
| Professional | Profesional | 19,99 | 199,99 |
| Enterprise | Negocio | A medida | A medida |

Los límites funcionales pertenecen a Lúmina. Las prendas y los reportes comerciales mantienen BOB. Las suscripciones usan USD. Los pagos son Stripe TEST con la misma clave del servidor utilizada por la compra de productos, o QR explícitamente simulado. Cada pago activa un período; esta entrega usa renovación manual, sin débitos automáticos.

## Uso

- Abrir `/?registro=1&plan=demo`, `plan=esencial` o `plan=pro`. `periodo=YEARLY` preselecciona el período anual.
- Completar negocio, identificador y propietario. El propietario se crea con rol Administrador únicamente en su propia base.
- Demo: se prepara un período gratuito de 10 días, una vez por correo. Los planes pagados preparan un registro pendiente; la base de negocio se crea después de confirmar el pago.
- Stripe: continuar al checkout alojado por Stripe, volver al registro y usar Comprobar estado si sigue pendiente. La activación admite el webhook firmado y la consulta autenticada al proveedor; un retorno de navegador nunca confirma por sí solo un pago.
- Mientras el registro siga pendiente, usar **Cambiar forma de pago** para alternar Stripe TEST y QR simulado conservando negocio, propietario, plan, importe y vencimiento. Antes de habilitar QR se cierra el checkout Stripe anterior; si ya se pagó, se reconoce ese pago y se prepara la tienda sin pedir otro. Volver a Stripe crea una sesión nueva. La recarga recupera el método actual.
- QR: escanear desde otro dispositivo o abrir la simulación y confirmar explícitamente. El enlace contiene una capacidad privada en el fragmento, no una clave del servidor. No compartir el QR fuera de la prueba.
- Finalizado el registro, abrir la tienda e iniciar sesión con las credenciales elegidas. No se anuncia ni envía un correo de activación: no hay SMTP configurado.

## Control y recuperación

`platform.signup` conserva datos pendientes, contraseña bcrypt y hash de la capacidad privada. La pestaña guarda solamente id/capacidad en sessionStorage, nunca la contraseña. El importe siempre se calcula en el servidor. La capacidad es necesaria para consultar o reanudar el registro. Mantener la pestaña hasta terminar.

El registro vence en una hora. Los pendientes vencidos eliminan el hash de contraseña al procesar otra alta. Las confirmaciones son idempotentes; una exclusión de aprovisionamiento evita crear varias bases en paralelo. Una preparación fallida queda en REVIEW y conserva la referencia del pago para revisión del operador; nunca se solicita pagar de nuevo. Las altas públicas tienen límite de 10/hora por IP y 30/día en el control. Demo no verifica la titularidad del correo: esta versión está destinada a la presentación académica.

La migración de control es aditiva. No cambia bases de negocios anteriores, sus pagos ni su inventario. Los recibos antiguos BOB conservan el importe y la moneda guardados; las nuevas suscripciones se preparan en USD. El acceso separado del operador permanece en `/?plataforma=1`.

Si al pasar de QR a Stripe el primer envío se rechaza definitivamente, QR permanece disponible. Cuando una respuesta se pierde y no se sabe si se creó el checkout, el registro conserva Stripe hasta poder comprobarlo y cerrarlo: reintentar o usar Comprobar estado. Para crear un checkout nuevo deben quedar al menos 31 minutos del registro; si queda menos tiempo, se puede continuar con el QR actual.

## Comprobaciones

`public-signup.test.ts`: validación estricta, rechazo de importes/privilegios aportados por el cliente, aislamiento entre tiendas, propietario, Demo de diez días, QR repetido, precios anuales, firma Stripe, importe incorrecto y webhook repetido. Las pruebas se ejecutan en `vestidor18_test` y bases sintéticas que se eliminan al finalizar.

`scripts/check-public-signup.cjs`: interfaz compilada en 320/390/768/1440 px, precio anual, identificador automático/manual, visibilidad de contraseña y flujo de QR con API simulada, sin persistir contraseña. El modo UI simulado no sustituye la verificación de Stripe y PostgreSQL.

## APK para Azure

QA autónoma 0.1.3, versionCode 4, paquete `bo.edu.grupo18.vestidorar.qa`, ARM64, API `https://lumina.20-25-26-113.sslip.io/api`. Contiene el bundle y no necesita Metro ni la PC. Firma Android Debug, solo QA; coincide con la APK QA anterior. No es una publicación firmada para Google Play.

- Archivo: `lumina-qa-0.1.3-arm64.apk`, 59.409.647 bytes.
- SHA-256: `1babba849c0c62a8798915dc2ffe69ceab80d3f93c4044e0595eaf00e758817d`.
- Certificado SHA-256: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- Descarga publicada: `/descargas/android/lumina-qa-0.1.3-arm64.apk`; manifiesto público `/descargas/android/latest.json`.

`verify-android-artifact.ps1` verificó firma, paquete, versión, ABI y dirección API dentro del bundle. No había dispositivo ADB conectado en esta compilación, por lo que no se afirma una nueva prueba física. El artefacto y el material de firma no se suben a Git.

## Evidencia de Azure, 11 de noviembre de 2026

- Corrección Stripe/QR desplegada desde `main` `9ab049f` y comprobada en la interfaz publicada con Stripe TEST real, sin cargos: Stripe→QR→recarga→Stripe nuevo→QR. Comprobación responsive en cuatro tamaños, registro de QA retirado y datos existentes conservados. Respaldo y detalle en [Despliegue en VM Azure](DESPLIEGUE_VM_AZURE.md#cambio-de-forma-de-pago-publicado-el-11-de-noviembre-de-2026).

- Aplicación y proxy actualizados; `GET /api/health` 200. Respaldo de fuentes, imagen anterior y dumps por tienda en `/home/azureuser/lumina-backups/20261111-saas`, sin secretos en Git.
- Alta real en el servidor por QR simulado: USD 9,99, confirmación repetida, base propia e inicio de sesión del propietario Administrador.
- Alta Demo real y acceso del propietario a su propia tienda.
- Checkout alojado real de Stripe TEST por USD 199,99 anual Profesional. Tarjeta de prueba oficial, retorno a Lúmina y estado ACTIVE con tienda creada. No se movió dinero real.
- Tres tiendas sintéticas utilizadas en estas comprobaciones, retiradas tras validar el flujo. Las comprobaciones de interfaz con API simulada se identifican por separado en el script correspondiente.
- Sitio comercial y registro comprobados en Azure a 320/390/768/1440 px. Sin desbordamiento horizontal ni errores JavaScript. Tienda de demostración, operador y retornos de pagos anteriores siguen accesibles.
- Descarga pública de la APK completa: 200, tipo Android, cabecera attachment, tamaño y SHA-256 idénticos al artefacto local.
- Pruebas: 12 casos de registro/períodos/proveedor IA, 17 de suscripción/webhook/entitlements y 25 contratos compartidos; compilación API/web y tipos Android correctos.
