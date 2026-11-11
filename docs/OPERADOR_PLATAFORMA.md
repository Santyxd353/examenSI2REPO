# Operador de plataforma — adaptación al manual de tenants

Base funcional: `Manual_Creacion_Tenants_Lumina.md`, entregado por el usuario el 11/11/2026. El documento describe `integracion/android` en `d4915bb`; se aplica sobre el avance actual sin revertir el registro público, Stripe TEST, QR, precios de RR-HH ni la publicación de Azure.

## Alcance conservado

- `/?plataforma=1`: acceso independiente del operador, identificado en pantalla como Superadministración.
- Las cuentas y sesiones comerciales no acceden a estos endpoints; el token del operador tampoco permite administrar una tienda como si fuera su propietaria.
- Alta manual con los mismos cinco campos y validaciones del documento: nombre, slug, correo, contraseña inicial y plan.
- Provisión existente: base propia, contraseña bcrypt, administradora, Sucursal principal, directorios y recursos disponibles. Catálogo y stock comerciales vacíos.
- Alta manual: 14 días de prueba, proveedor NONE, sin cargo. La Demo pública ya desarrollada conserva su período separado de 10 días.
- El plan y sus límites se administran dentro del negocio. Se conservan los precios de la referencia RR-HH pedidos expresamente por el usuario; los precios anteriores BOB del manual no sustituyen los actuales USD.

## Mejoras del panel

1. **Resumen:** recuentos del control, suscripciones activas/en prueba, negocios que requieren atención, altas del mes en hora de Bolivia, vencimientos próximos y distribución por plan. No representa un reporte de ventas ni ingresos reales.
2. **Tiendas registradas:** búsqueda literal por nombre/slug, filtros de estado del negocio y plan, recuento de resultados y páginas de 50. Un estado del negocio y una vigencia de suscripción se presentan por separado.
3. **Ficha:** UUID, estado, plan, fechas de prueba/vigencia, proveedor, enlace explícito, capacidades y solicitudes recientes de suscripción académica. No devuelve conexiones, claves, contraseñas ni tokens de negocio.
4. **Preparar un negocio:** mantiene el alta manual del documento. El formulario evita dobles envíos mientras prepara, valida el límite UTF-8 de la contraseña y orienta a consultar el listado tras una pérdida de conexión.
5. **Entrega:** ficha copiable con nombre, slug, URL, correo, plan y fin de prueba. La contraseña queda fuera del texto copiado y se entrega por separado. No se promete correo automático de bienvenida.
6. **Guía de entrega:** comprobaciones del manual, acceso web/Android y primeros pasos de la administradora.
7. **Interfaz del negocio:** muestra únicamente el nombre de la tienda actual; dejó de consultar el directorio global y de ofrecer un selector de otros tenants dentro del negocio. La portada tampoco muestra un directorio de negocios: conserva el formulario para abrir la tienda mediante su identificador y luego iniciar sesión con correo y contraseña.

Los estados se consultan. Se respeta el alcance del manual: no se añaden suspensión/reactivación manual, eliminación, cambio de slug, recuperación de contraseña ni reintento automático de provisiones parciales. Las preparaciones fallidas continúan reservadas para diagnóstico técnico.

## API

Todas las rutas siguientes exigen el token global, excepto login:

- `POST /api/platform/operator/login` (sin cambios de credenciales).
- `POST /api/platform/operator/tenants` (misma provisión y contrato del manual).
- `GET /api/platform/operator/tenants?offset=0&search=&state=ALL&plan=ALL`.
- `GET /api/platform/operator/dashboard`.
- `GET /api/platform/operator/tenants/:uuid`.

La sesión permanece en memoria, con 15 minutos de duración. Al vencer se limpian los datos del panel y se solicita iniciar sesión nuevamente. No se necesita cabecera de tienda para estas rutas. Las respuestas de control usan `Cache-Control: no-store`.

Los nuevos endpoints consultan solo el registro de plataforma. El dashboard usa una transacción de solo lectura con un corte consistente. Consultar una prueba vencida deriva EXPIRED sin cambiar la suscripción, sus fechas o el estado físico del negocio.

## Validación

- `operator.test.ts` y `tenant-http.test.ts`: 11 casos correctos. Comprueban scopes separados, provisión real con 14 días, una administradora, sucursal principal y catálogo vacío, filtros literales, validación, paginación de 50, lectura sin cambios y ausencia de conexiones/secretos en respuestas.
- `scripts/check-operator-ui.cjs`: aplicación compilada contra `vestidor18_test`, alta manual completa, copia sin contraseña, búsqueda y ficha, 1440/768/390/320 px, tienda propia sin selector global y cierre de sesión. El script elimina solo su base y archivos QA.
- El módulo no cambia la APK publicada ni las credenciales del operador o de las tiendas.

## Publicación comprobada en Azure

11/11/2026, `https://lumina.20-25-26-113.sslip.io/?plataforma=1`. Imagen anterior conservada como `vestidor18-app:before-operator-20261111`; fuentes y dumps por tienda en `/home/azureuser/lumina-backups/20261111-operator-wFbZhs`.

El respaldo y la actualización conservaron ambos negocios existentes: Lúmina (7 cuentas, 15 productos, 24 pedidos) y universidad (1 cuenta, catálogo y pedidos vacíos). La prueba web del destino fue de solo lectura: acceso con el operador existente, resumen, búsqueda y ficha de universidad en 1440/768/390/320 px, formulario conforme al manual, tienda sin selector global y cierre de sesión. No se crearon, suspendieron ni eliminaron tiendas en Azure para esta comprobación.

Salud pública 200, dashboard sin sesión 401 y manifiesto de descarga Android 200.

## Privacidad del listado de negocios

Por indicación posterior del usuario, se retiró de la portada la enumeración pública de tenants, incluidos sus nombres, slugs y enlaces. `GET /api/platform/stores`, también en sus variantes HEAD y mayúsculas, exige ahora el mismo guard del operador global que el panel. Una sesión de clienta o de administradora de tienda no autoriza ese listado. Las respuestas llevan `Cache-Control: no-store`.

La portada permite introducir el identificador entregado a cada administradora. El correo y la contraseña se validan dentro de esa tienda; no se hace una búsqueda pública de negocios por correo. Se conserva el acceso del operador al listado global y el catálogo público de cada tienda para sus compradoras mediante su enlace conocido.

Comprobado y publicado en Azure el 11/11/2026: portada sin directorio ni peticiones a su API en 320/390/768/1440 px; ruta de listado 401 sin sesión y 200 con sesión del operador; panel global y acceso de universidad operativos. Las 16 pruebas de API incluyen rechazo de cuentas Cliente/Administrador de negocio y de HEAD/rutas con mayúsculas. Ambos tenants y sus recuentos se conservaron. Respaldo: `/home/azureuser/lumina-backups/20261111-directory-privacy-VGNWTs`; imagen anterior `vestidor18-app:before-directory-privacy-20261111`.

## Hero y acceso de Superadmin

Se tomó como referencia `hrcore-web/src/app/widgets/landing/landing-hero/landing-hero.component.ts` y el acceso de plataforma de RR-HH. Se conserva el formato de Lúmina: título, colores crema/ciruela, tipografía, vista ilustrativa del dashboard y prenda existente. El hero destaca tres accesos: Ingresar a mi negocio, Planes y registro, y Superadmin. Este último aparece también en la navegación de escritorio, tablet y móvil, además del pie.

Superadmin abre el acceso existente `/?plataforma=1`. La presentación distingue el rol global del acceso de una tienda, incorpora mostrar/ocultar contraseña y enlaces para volver a la portada o entrar al negocio. Conserva el usuario, contraseña, validación y sesión del operador ya configurados. El formulario no incluye credenciales de ejemplo ni autocompletado de claves de la referencia.

El menú se adapta hasta 1100 px, se cierra con Escape o tras elegir una sección y recupera la navegación de escritorio al ampliar la ventana. Las ventajas destacadas corresponden a funciones actuales de Lúmina: datos separados, reportes y web/Android; no se trasladan prestaciones de RR-HH ajenas al proyecto.

Publicado y verificado en Azure el 11/11/2026. Portada comprobada a 1440/1101/1100/1024/768/390/320 px, tres accesos, imagen de producto existente cargada, menú/Escape, enlace al formulario global, visibilidad de contraseña y ausencia de directorio público. Formulario global a 1440/768/390/320 px, login real con el operador existente y consulta de universidad correctos. Conservados los dos tenants y los recuentos previos. Respaldo de fuentes en `/home/azureuser/lumina-backups/20261111-hero-8F01mk`, imagen anterior `vestidor18-app:before-hero-20261111`. Cambios de presentación: no requieren migración ni nueva APK.
