# Despliegue en VM Azure

La VM ejecuta tres contenedores con Docker Compose:

- `proxy`: Caddy publica HTTPS y renueva el certificado.
- `app`: web React, API NestJS, worker MediaPipe/Blender y worker analítico en dos entornos Python independientes.
- `database`: PostgreSQL 16, accesible solo desde la red interna de Docker.

Los datos PostgreSQL, archivos privados y certificados usan volúmenes persistentes. Cada tienda tiene su base comercial; el registro de control conserva las conexiones y suscripciones. Las claves maestras y sus versiones forman parte del material de recuperación y se guardan fuera de Git.

## Código de la instancia publicada

### Estado de la VM, actualizado el 11 de noviembre de 2026

- Instancia `vm-lumina`, IP pública `20.25.26.113`, proyecto en `/opt/vestidor18-repo`.
- Código funcional desplegado desde `main` en `78ee5c5`, incluida la corrección de cambio Stripe/QR (`7c52003`) y la ejecución persistente de analítica en Docker. Los 48 cambios locales anteriores coincidían con la base publicada `47b3e2f`; se conservaron en un respaldo privado y un stash antes de actualizar Git. Las posteriores actualizaciones de documentación no requieren reconstruir esta imagen.
- Git, Docker, Compose y Buildx instalados. Imagen Linux compilada y los tres contenedores iniciados; PostgreSQL no publica su puerto.
- Se restauró la base local con 6 cuentas, 15 productos y 24 pedidos, además de los archivos de almacenamiento. Se añadió una cuenta administradora exclusiva para Azure y se aplicaron las migraciones pendientes. La base inicial del servidor se conserva como `vestidor18_beforeimport_20261110`.
- Respaldo SQL PostgreSQL 18 importado en PostgreSQL 16 en una base separada y dentro de una transacción; se omitió únicamente `SET transaction_timeout`, que PostgreSQL 16 no admite. Los recuentos se contrastaron antes de activar la copia.
- Credenciales y claves permanecen fuera de Git. Hay respaldos privados en `/home/azureuser/lumina-backups/20261110` y en `C:\Users\HP\AppData\Local\Lumina\azure-deploy-20261110`.
- Pruebas internas correctas: salud, página web, inicio de sesión administrador, catálogo, Stripe TEST, Groq, interpretación y ejecución de reportes `bar` y `donut`, y validación de un webhook firmado.
- Sitio publicado: `https://lumina.20-25-26-113.sslip.io`. TCP 80/443 habilitado por el usuario en Azure. Caddy obtuvo un certificado de Let's Encrypt de producción; se verificaron desde internet la cadena de confianza y el nombre del host. HTTP redirige a HTTPS.
- Comprobaciones públicas correctas: salud HTTP 200, landing y bundle web HTTP 200, inicio de sesión administrador con cookie Secure, 12 productos publicados visibles, interpretación Groq y ejecución del reporte HTTP 200.

### Portada comercial SaaS

- `/` presenta la plataforma: funcionalidades, planes con precios y límites obtenidos de `PLAN_CATALOG`, acceso a la tienda mediante su identificador y preguntas frecuentes. No enumera los negocios registrados.
- `/?tienda=lumina` conserva la tienda demo. `/?tienda=identificador` abre el espacio de otro negocio.
- `/?plataforma=1` conserva el acceso independiente del operador. Los botones comerciales conducen al registro del cliente: `/?registro=1&plan=demo|esencial|pro`, con selección mensual/anual. El registro se inspira en RR-HH y conserva el diseño de Lúmina.
- Precios de la referencia: Demo gratis 10 días; Esencial (Basic) USD 9,99/mes o 99,99/año; Profesional USD 19,99/mes o 199,99/año; Negocio (Enterprise) a medida. Las prendas mantienen BOB. Misma clave Stripe TEST del servidor y QR simulado, con renovación manual sin débito automático.
- La tienda se prepara tras la confirmación del pago, o inmediatamente para Demo. Registro estricto, contraseña bcrypt, capacidad privada por pestaña, límites de altas y confirmación idempotente. Detalles y pruebas en [Registro público SaaS](REGISTRO_PUBLICO_SAAS.md).
- Android QA 0.1.3, código 4, ARM64, bundle autónomo y API HTTPS de Azure. Descarga desde la portada o `/descargas/android/lumina-qa-0.1.3-arm64.apk`; firma QA anterior conservada y SHA-256 público en `latest.json`. No se certifica una nueva prueba física: no había dispositivo conectado.
- Los retornos de Stripe y suscripciones mantienen el acceso a la tienda, incluso los enlaces anteriores que no incluyen `tienda`.
- `node scripts/check-commercial-home.cjs` comprueba el build local en preview. Con `COMMERCIAL_TEST_URL=https://lumina.20-25-26-113.sslip.io` comprueba el sitio publicado. Verifica 320, 390, 768 y 1440 píxeles, menú móvil, ausencia del directorio público y de peticiones a este, acceso por identificador, plataforma, retornos de pago y ausencia de errores JavaScript.
- Imagen anterior disponible para reversión: `vestidor18-app:before-commercial-20261110`; fuentes anteriores en el respaldo privado `before-commercial-source.tar.gz`.
- Corte previo a esta actualización: imagen `vestidor18-app:before-saas-20261111`, respaldo privado por base y fuentes en `/home/azureuser/lumina-backups/20261111-saas`. Se detuvo la aplicación brevemente para los dumps, conservando PostgreSQL y volúmenes.
- Verificación real en Azure: QR USD 9,99, Demo y Stripe Checkout alojado TEST USD 199,99, creación aislada e inicio de sesión de propietario. Se eliminaron únicamente las tres tiendas QA creadas por estas pruebas. La tienda original conserva 7 cuentas, 15 productos y 24 pedidos.
- Mejora posterior del operador, conforme al manual entregado: resumen global, búsqueda y filtros, ficha por negocio, alta manual existente con 14 días y ficha de entrega sin contraseña. En las tiendas, el encabezado muestra solo el negocio actual. Véase [Operador de plataforma](OPERADOR_PLATAFORMA.md).
- Esta actualización preservó Lúmina y universidad. Respaldo por base/fuentes en `/home/azureuser/lumina-backups/20261111-operator-wFbZhs`, imagen anterior `vestidor18-app:before-operator-20261111`. Comprobación autenticada de solo lectura en Azure a 320/390/768/1440 px; sin crear ni modificar negocios durante esa verificación.
- Ajuste posterior de privacidad: la portada ya no enumera tenants ni llama al directorio. `/api/platform/stores` exige sesión global del operador y devuelve 401 a visitantes o cuentas comerciales. Verificado en Azure: listado autorizado 200, portada responsive sin nombres/enlaces de negocios, acceso y panel del operador conservados. Corte previo en `/home/azureuser/lumina-backups/20261111-directory-privacy-VGNWTs`, imagen `vestidor18-app:before-directory-privacy-20261111`.
- Hero y acceso global mejorados con la jerarquía de RR-HH y el diseño de Lúmina: ingresar al negocio, planes/registro y Superadmin. Se conservan título, marca, vista de producto, credenciales y flujos existentes. Pruebas de navegación y login real correctas en Azure; respaldo de fuentes `/home/azureuser/lumina-backups/20261111-hero-8F01mk`, imagen `vestidor18-app:before-hero-20261111`.

### Cambio de forma de pago, publicado el 11 de noviembre de 2026

- Acceso SSH a `azureuser@20.25.26.113` comprobado con la clave facilitada por el propietario; clave y configuración permanecen fuera de Git.
- Se compiló la nueva imagen manteniendo el servicio anterior en marcha. Antes del reinicio se detuvo únicamente la aplicación para respaldar bases, roles, almacenamiento y certificados. PostgreSQL, proxy y volúmenes se conservaron.
- Respaldo privado: `/home/azureuser/lumina-backups/20261111-payment-method-ksWyKt`, con manifiesto SHA-256, fuentes, configuración, dumps y referencia del stash. Imagen anterior: `vestidor18-app:before-payment-method-20261111-payment-method-ksWyKt`.
- Aplicada la migración aditiva `202611110002_signup_payment_attempt.sql`. Inventario y recuentos anteriores/posteriores coinciden: dos tenants, dos suscripciones, dos registros públicos y un evento de facturación; también se contrastaron usuarios, productos, pedidos y pagos de cada tienda.
- Verificación pública real por HTTPS: salud 200; alta sintética pendiente con Stripe TEST; cambio a QR; recarga; regreso a Stripe con checkout nuevo; segundo cambio a QR. Ambas sesiones abandonadas quedaron cerradas, sin confirmar ningún pago ni crear una tienda de prueba. Después se eliminó únicamente ese registro sintético pendiente.
- Interfaz publicada comprobada a 320/390/768/1440 px, sin desbordamiento ni errores JavaScript. Evidencia local privada: `D:/SI2-builds/azure-payment-20261111/live-verification.json`. Los 277 tests de API y 25 compartidos se ejecutaron previamente en el entorno local aislado.
- Esta corrección actualiza web/API y conserva la APK existente; no se ejecutó una APK.

### Tienda poblada y analítica, publicado el 11 de noviembre de 2026

- Se creó `lumina-demo` como tienda aislada, plan Negocio habilitado sin cargo académico. Se conservaron `lumina`, `universidad` y `ficct`. Las credenciales se entregaron por separado; la cuenta global existente no se modificó.
- Se reutilizó la ropa femenina publicada de Lúmina: 12 prendas, 36 variantes y sus recursos 3D/AR. Se incorporaron 40 clientas ficticias, 4 cuentas de personal, 4 ubicaciones, 3.447 unidades físicas, 540 ventas simuladas, devoluciones, reembolsos y 6 diseños de reportes. Véase [Tienda de demostración](TIENDA_DEMOSTRACION.md).
- Se corrigió la detección de raíz del worker en imágenes sin `.git`: exige las marcas del paquete y la ubicación del módulo instalado. El volumen `application-data` también se monta en `/app/.local` para conservar `.local/analytics-private`; no se añaden servicios ni volúmenes distintos. Verificación: reproducción del fallo anterior y 10 pruebas Python correctas, revisión independiente, compilación y comprobación real del almacenamiento persistente.
- La imagen `78ee5c5` completó dataset sintético, entrenamiento RandomForestRegressor, entrenamiento IsolationForest, pronósticos de 7/30 días y reposición. Los artefactos se verificaron por hash; todos los resultados se identifican como demostración sintética.
- Comprobaciones reales: ambos inicios de sesión en navegador, indicadores comerciales poblados, módulos administrativos, apertura de reporte guardado, ausencia de errores JavaScript, fotos/AR públicos, 36 GLB autenticados, prueba de prenda y paquetes offline de diez prendas para web y Android con hashes correctos. No se ejecutó una APK.
- Respaldo privado: `/home/azureuser/lumina-backups/20261111-demo-store-l6DNGr`. Dump final de la tienda y archivo de modelos persistentes validados por manifiesto SHA-256. Salud HTTPS 200 y configuración privada original conservada.

### Preparación anterior

La preparación inicial usó `main` de `https://github.com/Santyxd353/examenSI2REPO.git` en `/opt/vestidor18-repo`. El candidato SaaS se integró en `fcf24ac`. El estado comprobado del destino se recoge arriba; la publicación web no certifica por sí sola nuevas pruebas físicas ni una nueva firma Android.

El archivo `.env.vm` se conserva fuera de Git, en el destino y su respaldo privado local. La plantilla actual es `infra/vm/.env.example`; sus marcadores deben reemplazarse, incluidas las claves offline y las credenciales del operador. Una restauración conserva todas las versiones de claves anteriores. `RUN_DB_SEED=false` evita cargar semillas al arrancar. Stripe/IA requieren configuración y comprobación con las cuentas autorizadas.

## Preparación y recuperación antes de publicar

Ejecutar el ensayo local descrito en [A16 — recuperación local](evidencia/saas/equipo-a/A16-recuperacion-local.md). Comprueba control, dos tiendas, archivos y claves con datos sintéticos; no genera un respaldo de producción.

Antes de cambiar el destino, bloquear escrituras y detener los workers, inventariar todas las tiendas y obtener dumps consistentes de control y de cada base. Conservar archivos privados, recursos, modelos y certificados con un manifiesto de rutas/tamaños/SHA-256. Guardar `.env.vm`, credenciales y versiones de claves en una bóveda separada. Ensayar la restauración en bases y almacenamiento nuevos; conservar el original hasta aprobar las comprobaciones. El ensayo QA no sustituye ese respaldo real ni valida permisos de los roles de la nueva VM.

Un cambio de imagen no revierte una migración de esquema. Ante una reversión incompatible se recuperan el código, las bases, los archivos y el material de claves del mismo corte. El punto de recuperación y el tiempo de indisponibilidad se medirán sobre el destino definitivo.

## Publicar el SHA verificado

Solo después de cerrar aceptación, build Linux, restauración y firma Android; no ejecutar como actualización automática del candidato actual. El SHA verificado debe estar disponible en el repositorio antes de usar estos comandos.

```bash
cd /opt/vestidor18-repo
git fetch origin
DEPLOY_SHA=REEMPLAZAR_POR_SHA_VERIFICADO
git switch --detach "$DEPLOY_SHA"
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml config --quiet
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml up -d --build
```

Estado:

```bash
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml ps
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml logs --tail=100
```

La base de datos no publica el puerto 5432. Los únicos puertos públicos son SSH 22, HTTP 80 y HTTPS 443.
