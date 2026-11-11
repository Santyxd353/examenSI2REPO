# Manual de creación de tiendas (tenants) — Lúmina SaaS

Fecha: 11/11/2026. Referencia de código revisada: `d4915bb`, rama `integracion/android` del repositorio `Santyxd353/examenSI2REPO`.

Este manual describe la versión SaaS desarrollada. La nueva VM sigue pendiente; el panel estará disponible en los entornos que ejecuten esta versión. No presupone que la instalación anterior ya tenga estos cambios.

## Guía rápida

1. Abre `https://tu-dominio.example/?plataforma=1` o, en desarrollo, `http://localhost:5173/?plataforma=1`.
2. Ingresa con la cuenta del **operador de plataforma**.
3. En **Preparar un negocio**, completa nombre, identificador, correo y contraseña de la administradora y plan inicial.
4. Pulsa **Preparar tienda** y espera **Tienda preparada**.
5. Abre el enlace de la tienda: `https://tu-dominio.example/?tienda=rosa-boutique`.
6. Inicia sesión allí con el correo y la contraseña de su administradora.

La tienda empieza con **14 días de prueba, catálogo vacío y una sucursal principal**. Prepararla no realiza un cargo.

## Contenido

- [Qué es un tenant](#qué-es-un-tenant)
- [Quién puede crear tiendas](#quién-puede-crear-tiendas)
- [Requisitos previos](#requisitos-previos)
- [Datos y reglas del formulario](#datos-y-reglas-del-formulario)
- [Crear desde el panel](#crear-desde-el-panel)
- [Qué crea el sistema automáticamente](#qué-crea-el-sistema-automáticamente)
- [Ingresar a la tienda y prepararla para trabajar](#ingresar-a-la-tienda-y-prepararla-para-trabajar)
- [Planes y suscripción después del alta](#planes-y-suscripción-después-del-alta)
- [Crear por consola](#crear-por-consola)
- [Configurar el operador por primera vez](#configurar-el-operador-por-primera-vez)
- [API de creación para integración técnica](#api-de-creación-para-integración-técnica)
- [Estados y solución de problemas](#estados-y-solución-de-problemas)
- [Verificación y entrega a la propietaria](#verificación-y-entrega-a-la-propietaria)
- [Límites actuales y mantenimiento](#límites-actuales-y-mantenimiento)
- [Archivos que implementan el flujo](#archivos-que-implementan-el-flujo)

## Qué es un tenant

Un tenant es el espacio independiente de una tienda que contrata Lúmina. Por ejemplo, Rosa Boutique y Luna Moda son dos tenants distintos.

Cada tienda conserva su propia base comercial, catálogo, inventario, usuarios, pedidos y reportes. También tiene un directorio de archivos y una suscripción propios. No se crea otra VM ni otra instalación completa de la aplicación por cada tienda: comparten la aplicación y los servicios, con datos separados.

El registro central guarda la identidad de cada tienda, el nombre de su base, estado, plan y suscripción. Las credenciales de una tienda no permiten acceder a las demás.

Tres identificadores distintos:

| Dato | Ejemplo | Uso |
| --- | --- | --- |
| Nombre visible | Rosa Boutique | Identificar el negocio en pantalla. |
| Identificador o slug | `rosa-boutique` | Abrir la tienda y seleccionarla en Android. |
| UUID | Generado automáticamente | Identidad interna, base y archivos. No se escribe en el formulario. |

El sistema genera un nombre de base `store_` seguido del UUID sin guiones. Su directorio se ubica en `STORAGE_ROOT/tenants/UUID/`, con carpetas `public` y `private`. El espacio histórico `lumina` tiene tratamiento propio y está reservado; no se utiliza para crear otra tienda.

## Quién puede crear tiendas

| Cuenta o mecanismo | Alcance |
| --- | --- |
| Operador de plataforma | Inicia sesión en el panel global, consulta tiendas y prepara nuevos negocios. |
| Administradora de una tienda | Administra su negocio, equipo, inventario y suscripción según permisos y plan. No crea otros tenants. |
| Clienta | Compra y usa el vestidor dentro de la tienda elegida. Crear una cuenta de clienta no crea un negocio. |
| CLI del servidor | Herramienta técnica de provisión con acceso a PostgreSQL y almacenamiento. No usa la sesión web del operador. |

La cuenta del operador es independiente de las cuentas comerciales. Una cuenta `admin` de una tienda no se convierte en operador global. El token del operador tampoco sirve para iniciar sesión como administradora de una tienda.

## Requisitos previos

Para utilizar el panel:

- Web y API de la versión SaaS ejecutándose y conectadas a PostgreSQL.
- Conexión al servidor; la creación de tenants no funciona offline.
- Usuario, hash de contraseña y secreto de firma del operador configurados en la API.
- Conexiones de control y comerciales correctamente configuradas.
- La cuenta PostgreSQL utilizada para provisionar debe poder crear bases y aplicar migraciones en ellas.
- Permiso de escritura sobre el almacenamiento de la aplicación.

La API utiliza:

| Variable | Propósito |
| --- | --- |
| `DATABASE_URL` | Conexión general de la aplicación. |
| `PLATFORM_DATABASE_URL` | Registro de control. Si se omite, utiliza `DATABASE_URL`. |
| `TENANT_DATABASE_URL` | Conexión base para administrar y derivar las conexiones comerciales. Si se omite, utiliza `DATABASE_URL`. |
| `STORAGE_ROOT` | Raíz de archivos. Si se omite, utiliza `.local/storage` relativo al proceso. |
| `PLATFORM_OPERATOR_USERNAME` | Nombre del operador global. |
| `PLATFORM_OPERATOR_PASSWORD_HASH` | Hash bcrypt de su contraseña, no la contraseña en texto. |
| `PLATFORM_OPERATOR_JWT_SECRET` | Secreto de firma independiente, con al menos 48 caracteres. |

La configuración general del candidato también requiere las claves offline y demás variables de la plantilla `infra/vm/.env.example`. Para crear otra tienda en una instalación existente no se regeneran sus claves ni se cambian las conexiones.

## Datos y reglas del formulario

Ejemplo de alta:

| Campo en pantalla | Valor de ejemplo | Regla |
| --- | --- | --- |
| Nombre de la tienda | Rosa Boutique | Entre 2 y 120 caracteres; se recortan espacios exteriores. |
| Identificador de tienda | `rosa-boutique` | Entre 1 y 63 caracteres: minúsculas, números y guiones entre grupos. Único en la plataforma. |
| Correo de la administradora | `duena@rosa-boutique.example` | Correo válido, máximo 160 caracteres. Se recortan espacios y se convierte a minúsculas. |
| Contraseña inicial | Una clave elegida para esta cuenta | De 10 a 72 caracteres y máximo 72 bytes en UTF-8. |
| Plan inicial | Profesional | Código técnico `pro`. También existen `esencial` y `negocio`. |

Los valores del ejemplo deben reemplazarse por los del negocio real.

Slugs válidos: `rosa-boutique`, `luna-moda`, `tienda18`.

Slugs inválidos: `Rosa Boutique`, `rosa_boutique`, `-rosa`, `rosa-`, `moda-mujér`. Tampoco se admite un slug ya utilizado o el reservado `lumina`.

Los caracteres con varios bytes, como emojis, pueden superar el límite de contraseña aunque el contador visual muestre menos de 72 caracteres.

El plan predeterminado del formulario y de la CLI es Profesional. Conviene elegirlo explícitamente para evitar altas con un plan distinto al previsto.

## Crear desde el panel

### Entrar al acceso global

1. Abre la dirección del entorno y agrega `?plataforma=1`.
2. Confirma que aparece **Acceso de plataforma**.
3. Completa **Usuario de plataforma** y **Contraseña de plataforma**.
4. Pulsa **Entrar a plataforma**.
5. Debes ver **Administrar tiendas**, **Preparar un negocio** y **Tiendas registradas**.

La sesión del operador dura 15 minutos y se conserva en memoria de la página. Al recargar o vencer la sesión puede ser necesario ingresar otra vez. El acceso limita los intentos de login a diez por cada ventana de quince minutos.

### Preparar el negocio

1. Completa los cinco campos de la tabla anterior.
2. Revisa el slug: será el identificador entregado a la propietaria y sus clientas.
3. Selecciona el plan inicial.
4. Pulsa una vez **Preparar tienda**.
5. Mientras diga **Preparando…**, espera: el servidor crea la base, aplica migraciones y prepara el usuario y los archivos.
6. Cuando aparezca **Tienda preparada**, utiliza **Abrir tienda**.
7. Comprueba que el negocio figura en el listado como **En prueba**.

**Actualizar listado** vuelve a consultar la primera página. **Cargar más tiendas** agrega la siguiente página; el servidor devuelve hasta 50 por solicitud.

Si se pierde la conexión después de pulsar el botón, actualiza el listado antes de repetir el alta. El servidor puede haber terminado aunque el navegador no haya recibido la respuesta.

### Entregar los accesos

Entrega a la propietaria el nombre del negocio, slug, URL, correo administrador, contraseña inicial, plan y fecha de fin de prueba. La contraseña se comunica por un canal privado.

El alta actual no envía automáticamente un correo de bienvenida ni devuelve la contraseña en el listado. El operador debe conservar y entregar los datos de acceso.

## Qué crea el sistema automáticamente

El panel y la CLI usan la misma función de provisión:

1. Validan los campos y reservan un UUID y el slug.
2. Registran el negocio como `PROVISIONING` en control.
3. Registran su suscripción como `TRIALING`, proveedor `NONE`, con 14 días de prueba.
4. Crean una base `store_UUIDSINGUIONES`.
5. Ejecutan las migraciones de Prisma sobre esa nueva base.
6. Crean los roles Cliente, Administrador, Vendedor y Analista, con sus permisos iniciales.
7. Crean la cuenta propietaria con el rol Administrador y contraseña almacenada como hash bcrypt.
8. Crean **Sucursal principal**, de tipo TIENDA, activa y con la administradora como responsable y asignada a ella.
9. Registran la plantilla corporal base.
10. Crean las carpetas del tenant y copian los recursos corporales/de prendas de referencia que ya existan en el almacenamiento general.
11. Cambian el negocio a `TRIAL` y devuelven su enlace.

La plantilla corporal registrada no es un avatar personalizado de la administradora. Las copias de recursos de referencia dependen de que esos archivos estén disponibles; provisionar no ejecuta por sí solo el proceso de generación del avatar.

No se copian los productos, inventario, clientas, empleados, ventas ni reportes del espacio Lúmina. El negocio empieza sin productos ni stock comercial.

## Ingresar a la tienda y prepararla para trabajar

### Web

1. Abre `https://tu-dominio.example/?tienda=rosa-boutique`.
2. Pulsa **Iniciar sesión**.
3. Usa el correo y la contraseña inicial de esa administradora.
4. Entra al espacio administrativo. Deben aparecer los módulos correspondientes a sus permisos.
5. Revisa **Mi negocio y plan** y comprueba el nombre, plan y período de prueba.

El nombre visible y el slug son distintos. No escribas el UUID ni el nombre de la base en la URL.

La página principal sin `?tienda=...` puede recordar una selección anterior del navegador. Para entrar y entregar accesos utiliza siempre la URL explícita de la tienda.

### Android

1. En la pantalla de acceso, completa **Identificador de tienda** con `rosa-boutique`.
2. Elige **Ingresar**.
3. Introduce el mismo correo y contraseña de administradora.
4. Entra al espacio de trabajo.

El botón **Crear cuenta** registra una persona en la tienda seleccionada; no provisiona otra tienda. La creación global de negocios se realiza en el panel web o mediante la CLI técnica.

### Primeras tareas de la administradora

1. Verificar **Sucursal principal** antes de agregar ubicaciones; ya consume una del límite del plan.
2. Crear las primeras prendas desde **Catálogo y vestidor**. El formulario **Nueva prenda** permite elegir **Crear nuevo tipo** para el primer tipo de prenda.
3. Crear variantes y precios según los canales utilizados y cargar existencias desde inventario.
4. Agregar integrantes en **Equipo y permisos** y asignarles ubicaciones.
5. Revisar **Mi negocio y plan**.
6. Preparar las descargas y cortes del modo offline mientras haya conexión, desde los módulos correspondientes.

Crear el tenant no descarga automáticamente paquetes offline ni entrena modelos analíticos.

## Planes y suscripción después del alta

Precios configurados por tienda y mes, expresados en bolivianos:

| Capacidad | Esencial (`esencial`) | Profesional (`pro`) | Negocio (`negocio`) |
| --- | ---: | ---: | ---: |
| Precio mensual | Bs 149 | Bs 299 | Bs 599 |
| Ubicaciones activas | 1 | 5 | 20 |
| Integrantes activos del equipo | 3 | 15 | 100 |
| Productos | 200 | 2.000 | 10.000 |
| Generaciones de avatar por período | 30 | 150 | 500 |
| Reportes guardados | 3 | 15 | 50 |
| Solicitudes IA por período | 0 | 100 | 500 |
| Offline y hasta diez prendas compatibles | Sí | Sí | Sí |
| Reportes manuales | Sí | Sí | Sí |
| Reportes con IA; demanda y reposición | No | Sí | Sí |
| Anomalías y análisis entre ubicaciones | No | No | Sí |

Los cupos por período se calculan conforme al período que informa la suscripción, incluida la prueba. Las funciones con proveedores, workers y recursos necesitan además su configuración operativa.

La administradora inicial cuenta como integrante del equipo: en Esencial quedan dos cupos adicionales para integrantes activos. Las clientas no cuentan como personal. El límite de productos cuenta los registros del catálogo; archivar una prenda no libera automáticamente ese cupo.

### Pasar de prueba a suscripción confirmada

1. La administradora abre **Mi negocio y plan**.
2. Selecciona el plan y revisa las condiciones del ciclo.
3. Acepta las condiciones y utiliza **Generar QR simulado** o **Preparar Stripe TEST**, según la opción disponible.
4. Para QR de demostración, usa **Confirmar pago simulado**.
5. Para Stripe TEST, abre Checkout y completa el flujo de prueba; el servidor debe recibir y verificar el evento correspondiente.
6. Consulta el estado y confirma que la suscripción quedó aplicada y que informa su fecha de vigencia.

Crear el negocio o regresar desde Checkout no confirma un pago. La entrega trabaja con Stripe TEST y QR simulado, sin cobros reales. La confirmación válida activa la suscripción y pasa de prueba a activa la tienda que estaba en `TRIAL`.

Al vencer la prueba o el período sin renovación, el sistema deriva el estado vencido y restringe nuevas modificaciones. No elimina automáticamente los datos. El estado de negocio y el de suscripción son campos diferentes.

## Crear por consola

Ruta para soporte o preparación técnica. La consola debe usar las conexiones y almacenamiento del mismo entorno donde se desea crear la tienda. Ejecutarla contra una base local crea una tienda local, aunque se le entregue después a alguien una URL de la VM.

### Desde una copia del backend en Windows

Requiere dependencias instaladas, Prisma generado y contratos compartidos compilados. En una copia nueva se preparan con `npm ci`, `npm run db:generate` y `npm run build:shared`. El archivo `.env` o las variables del proceso deben apuntar al entorno correcto.

Ejemplo PowerShell, desde la raíz del repositorio:

```powershell
$clave = Read-Host 'Contraseña inicial de la administradora' -AsSecureString
$env:TENANT_ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $clave).Password
try {
    npm run tenant:create -- --slug rosa-boutique --name 'Rosa Boutique' --email duena@rosa-boutique.example --plan pro
    if ($LASTEXITCODE -ne 0) { throw 'El alta no terminó. Revisa el mensaje y el listado antes de repetir.' }
}
finally {
    Remove-Item Env:\TENANT_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $clave = $null
}
```

La clave se pasa mediante `TENANT_ADMIN_PASSWORD`; no existe un argumento `--password` en esta CLI.

Resultado esperado:

```text
Tienda preparada: Rosa Boutique (rosa-boutique). Prueba de 14 días; el catálogo empieza vacío.
Acceso web: ?tienda=rosa-boutique. En Android selecciona el identificador rosa-boutique.
```

Usa `--plan esencial`, `--plan pro` o `--plan negocio`. El correo del ejemplo debe reemplazarse por el de la propietaria.

### Si el backend está en Docker Compose

Este ejemplo es para el futuro entorno Linux que ejecute el Compose del repositorio; no indica que la nueva VM ya esté desplegada. Ejecútalo desde la raíz de esa instalación:

```bash
read -r -s -p "Contraseña inicial de la administradora: " TENANT_ADMIN_PASSWORD
printf '\n'
export TENANT_ADMIN_PASSWORD
docker compose --env-file .env.vm -f infra/vm/compose.yml exec -e TENANT_ADMIN_PASSWORD app ./node_modules/.bin/tsx scripts/create-tenant.ts --slug rosa-boutique --name "Rosa Boutique" --email duena@rosa-boutique.example --plan pro
unset TENANT_ADMIN_PASSWORD
```

Aquí la CLI hereda las conexiones y rutas del servicio `app`. No hace falta crear manualmente una base ni ejecutar una semilla de productos para dar de alta cada negocio.

## Configurar el operador por primera vez

Esta configuración se realiza una vez por instalación. Si el operador ya puede ingresar, utiliza esa cuenta: crear otro tenant no requiere cambiarla.

La API necesita `PLATFORM_OPERATOR_USERNAME`, `PLATFORM_OPERATOR_PASSWORD_HASH` y `PLATFORM_OPERATOR_JWT_SECRET`. No hay una cuenta global `admin/admin` creada automáticamente.

Ejemplo opcional para preparar las tres variables en Windows, desde el repositorio con `bcryptjs` instalado. Genera un archivo local nuevo, no modifica la configuración activa ni imprime los secretos:

```powershell
$clave = Read-Host 'Nueva contraseña del operador (mínimo 10 caracteres)' -AsSecureString
$env:OPERATOR_SETUP_PASSWORD = [System.Net.NetworkCredential]::new('', $clave).Password
try {
@'
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
(async () => {
  const password = process.env.OPERATOR_SETUP_PASSWORD || '';
  if (password.length < 10 || password.length > 72 || Buffer.byteLength(password, 'utf8') > 72)
    throw new Error('La contraseña debe cumplir los límites de 10 a 72 caracteres y 72 bytes.');
  const hash = await bcrypt.hash(password, 12);
  const jwt = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync('.local', { recursive: true });
  const lines = [
    'PLATFORM_OPERATOR_USERNAME=operador',
    "PLATFORM_OPERATOR_PASSWORD_HASH='" + hash + "'",
    'PLATFORM_OPERATOR_JWT_SECRET=' + jwt,
    ''
  ];
  fs.writeFileSync('.local/operador-plataforma.env', lines.join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Variables preparadas en .local/operador-plataforma.env');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@ | node
    if ($LASTEXITCODE -ne 0) { throw 'No se generó el archivo de configuración.' }
}
finally {
    Remove-Item Env:\OPERATOR_SETUP_PASSWORD -ErrorAction SilentlyContinue
    $clave = $null
}
```

Después:

1. Traslada esas tres variables al `.env` utilizado por la API o al `.env.vm` del destino.
2. Conserva las comillas simples del hash bcrypt para que Compose no interprete sus signos `$`.
3. Reinicia el proceso API o recrea el servicio correspondiente en la fase de configuración de ese entorno.
4. Ingresa con usuario `operador` y la contraseña elegida.

El archivo se crea con `flag: 'wx'`: si ya existe, no lo reemplaza. Conserva el archivo de configuración con acceso restringido y fuera de Git. Para una instalación que ya funciona, conserva sus credenciales existentes.

## API de creación para integración técnica

Los siguientes ejemplos describen peticiones HTTP. No incluyen credenciales reales.

### Obtener sesión global

```http
POST /api/platform/operator/login
Content-Type: application/json

{
  "username": "operador",
  "password": "REEMPLAZAR_POR_LA_CLAVE_DEL_OPERADOR"
}
```

Una respuesta correcta devuelve `accessToken`, `scope: "PLATFORM_OPERATOR"` y `expiresIn: 900`. El token se envía como Bearer a las rutas globales. No se necesita `X-Tenant-Slug` para estas rutas.

### Crear

```http
POST /api/platform/operator/tenants
Authorization: Bearer TOKEN_DEL_OPERADOR
Content-Type: application/json

{
  "slug": "rosa-boutique",
  "name": "Rosa Boutique",
  "ownerEmail": "duena@rosa-boutique.example",
  "ownerPassword": "REEMPLAZAR_POR_LA_CLAVE_INICIAL",
  "planCode": "pro"
}
```

El servidor espera exactamente esos campos. `planCode` puede omitirse y toma `pro`; los campos adicionales se rechazan.

El éxito devuelve HTTP 201 y:

- `tenant`: UUID, slug, nombre, estado `TRIAL`, plan, estado de suscripción `TRIALING` y fin de prueba.
- `webPath`: `/?tienda=rosa-boutique`.

La respuesta no devuelve contraseñas ni conexiones PostgreSQL. El token del operador autentica esta operación; no se utiliza como token de administradora de la nueva tienda.

### Consultar el listado

```http
GET /api/platform/operator/tenants?offset=0
Authorization: Bearer TOKEN_DEL_OPERADOR
```

La respuesta contiene `tenants`, `hasMore` y `nextOffset`. La página tiene hasta 50 tiendas; utiliza el siguiente offset si `hasMore` es verdadero.

### Verificar una tienda

`GET /api/platform/stores` ofrece los nombres y slugs de los espacios activos/en prueba. `GET /api/tenant`, con `X-Tenant-Slug: rosa-boutique`, informa la tienda seleccionada y su suscripción. El acceso a los datos comerciales requiere además la sesión comercial y permisos correspondientes.

## Estados y solución de problemas

### Estado del negocio

| Valor interno | Etiqueta en el panel | Significado |
| --- | --- | --- |
| `PROVISIONING` | Preparando | El alta comenzó y aún no terminó. |
| `TRIAL` | En prueba | La tienda terminó de prepararse y puede utilizar su prueba. |
| `ACTIVE` | Activa | Estado activo del negocio. |
| `SUSPENDED` | Suspendida | No disponible para el acceso comercial normal. |
| `FAILED` | Revisión requerida | La provisión falló; su slug continúa reservado. |

La suscripción tiene estados separados: `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELED` y `SUSPENDED`. `EXPIRED` se deriva al consultar un período vencido; no debe confundirse con el estado físico de la tienda.

### Errores frecuentes

| Síntoma o mensaje | Acción |
| --- | --- |
| No aparece **Acceso de plataforma** | Revisar `?plataforma=1` y que ese entorno ejecute el candidato SaaS. |
| El acceso de plataforma todavía no está configurado | Revisar las tres variables del operador, formato bcrypt y secreto JWT de al menos 48 caracteres. |
| Usuario o contraseña incorrectos | Usar la cuenta global; no las credenciales de una tienda. |
| Sesión no válida o vencida | Volver a ingresar. Consultar el listado antes de repetir un alta que pudo completarse. |
| Demasiados intentos | Esperar a que se libere la ventana de quince minutos. |
| Revisa los campos del formulario | Corregir slug, correo, longitudes y bytes de contraseña; verificar el código de plan. |
| El identificador de tienda ya está utilizado | Consultar la tienda existente. Elegir otro slug únicamente si se está creando otro negocio. |
| Ese espacio ya está reservado | No usar `lumina`. |
| La tienda no terminó de prepararse | Revisar estado y logs, permisos de creación de bases, migraciones y almacenamiento. El slug queda reservado. |
| Quedó en **Preparando** tras detenerse el servidor | Revisión técnica de la provisión parcial; no existe reanudación automática garantizada del alta. |
| La tienda está vacía | Es el resultado esperado: cargar su catálogo e inventario. |
| La cuenta existe pero no puede ingresar | Revisar la URL/slug y usar el correo y contraseña de esa tienda. |
| Límite de ubicaciones o integrantes | La sucursal principal y la administradora inicial ya cuentan en sus límites. |
| Plan en solo lectura | Revisar prueba/vigencia en **Mi negocio y plan**. |
| Error de recurso de avatar | Revisar los archivos base y el worker; el alta no genera por sí sola un avatar personalizado. |

No borres las filas del registro para liberar un slug fallido sin revisar primero la base y los archivos que pudieron quedar creados.

### Consulta técnica de diagnóstico

Solo lectura, ejecutada contra la base indicada por `PLATFORM_DATABASE_URL`:

```sql
SELECT t.id, t.slug, t.name, t.database_name, t.state,
       s.plan_code, s.status, s.trial_ends_at, s.current_period_end
FROM platform.tenant AS t
LEFT JOIN platform.subscription AS s ON s.tenant_id = t.id
WHERE t.slug = 'rosa-boutique';
```

Esta consulta ayuda a ubicar la base y el estado; no completa ni repara una provisión fallida.

## Verificación y entrega a la propietaria

- [ ] El listado muestra el negocio correcto, slug y plan elegidos.
- [ ] El estado terminó en **En prueba**, no **Preparando** o **Revisión requerida**.
- [ ] La URL explícita abre la tienda correcta.
- [ ] La administradora puede entrar con su correo y contraseña inicial.
- [ ] **Mi negocio y plan** informa la prueba y su vigencia.
- [ ] Existe **Sucursal principal**, con la administradora asignada.
- [ ] El catálogo comienza vacío; no aparecen productos ni ventas ajenos.
- [ ] La propietaria recibió URL, slug, correo, contraseña inicial, plan y fin de prueba.

Ejemplo de ficha de entrega:

```text
Negocio: Rosa Boutique
Identificador: rosa-boutique
URL: https://tu-dominio.example/?tienda=rosa-boutique
Correo administrador: el correo real registrado
Contraseña inicial: entregada por separado
Plan: Profesional — Bs 299 por mes después de la prueba
Fin de prueba: copiar la fecha real que informa el sistema
```

## Límites actuales y mantenimiento

- El panel actual permite iniciar sesión global, crear tiendas y listarlas. No ofrece botones para cambiar un slug, eliminar un tenant, suspenderlo manualmente o reintentar automáticamente una provisión fallida.
- No existe un alta pública autónoma de tiendas desde **Crear cuenta** de la clienta.
- La creación requiere conexión con el servidor. El modo offline comercial se prepara después y no sustituye la provisión.
- El panel no permite recuperar la contraseña inicial de la administradora; una pérdida de acceso requiere soporte.
- No se debe crear otro tenant para renovar un plan ni para agregar una sucursal. Se utilizan la suscripción y el módulo de ubicaciones de la tienda existente.
- Las actualizaciones posteriores deben aplicar las migraciones a todas las tiendas. El repositorio dispone de `scripts/migrate-tenants.ts`; su ejecución forma parte del mantenimiento del backend.
- Los respaldos deben incluir control, todas las bases comerciales, archivos y versiones de las claves de recuperación. Véase [ensayo local de recuperación](evidencia/saas/equipo-a/A16-recuperacion-local.md).

## Archivos que implementan el flujo

| Archivo | Responsabilidad |
| --- | --- |
| [PlatformProvision.tsx](../apps/web/src/admin/PlatformProvision.tsx) | Login global, formulario, listado y etiquetas. |
| [App.tsx web](../apps/web/src/App.tsx) | Entrada por `?plataforma=1`. |
| [operator.ts](../apps/api/src/tenancy/operator.ts) | Credenciales globales, token, listado y API de provisión. |
| [provision.ts](../apps/api/src/tenancy/provision.ts) | Validación, base, migraciones, administradora, sucursal y archivos. |
| [platform.ts](../apps/api/src/tenancy/platform.ts) | Registro, resolución y conexión de cada tienda. |
| [defaults.ts](../apps/api/src/tenancy/defaults.ts) | Roles y permisos iniciales. |
| [create-tenant.ts](../scripts/create-tenant.ts) | Comando `npm run tenant:create`. |
| [billing.ts](../packages/contracts/src/billing.ts) | Precios, límites y capacidades de los tres planes. |
| [tenant.ts web](../apps/web/src/tenant.ts) | Selección y navegación a una tienda. |
| [Plantilla de entorno VM](../infra/vm/.env.example) | Nombres de variables de configuración. |

El manual se contrastó con el código indicado al inicio. No se crearon tenants, se cambiaron credenciales ni se modificó la VM al redactarlo.
