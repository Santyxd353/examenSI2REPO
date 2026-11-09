# A16 — preparación local del candidato

Fecha: 08/11/2026. Estado: **en curso; sin despliegue ni cierre de A16**. La VM nueva y la aceptación Android siguen pendientes.

## Dependencias y compatibilidad

La auditoría inicial de producción encontró seis alertas en API/web y cuatro moderadas en las herramientas Expo. Se ajustaron versiones y lockfiles; `node scripts/check-production-dependencies.cjs` ahora informa **cero alertas de producción en ambos árboles**. El comando conserva sus informes en `.local/dependency-audit` y falla si la consulta no termina correctamente o detecta vulnerabilidades.

| Dependencia | Versión utilizada | Referencia primaria |
| --- | --- | --- |
| Multer | 2.5.0 | [Aviso del proyecto](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) |
| body-parser | 2.4.0 | [Aviso del proyecto](https://github.com/advisories/GHSA-27r3-jxmh-p828) |
| Zod, también en contratos compartidos | 4.6.6 | [Aviso](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |
| qs | 6.16.1 | [Aviso del proyecto](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) |
| ip-address | 10.7.4 | [Aviso del proyecto](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) |
| glob del proyecto Android | 14.0.4 | [Aviso del proyecto](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| minimatch de fingerprint | 11.0.5 | [Aviso del proyecto](https://github.com/advisories/GHSA-g3hv-75wg-m249) |

Expo permanece en SDK 57 y Nest en 11. El árbol Android mantiene glob 14 usado por otros paquetes del mismo SDK. La primera sustitución limitada a fingerprint dejó una copia antigua inválida en el lockfile; se reconcilió el árbol y `npm ls` confirmó una única versión válida. Se ejecutó dos veces la función real de fingerprint: **77 fuentes y el mismo hash `4d3666aa41ac42259c136afb178b13b3d19ec2ac`**. Es una comprobación de compatibilidad de la herramienta, no del certificado de un APK.

Compilación API/web y 25 pruebas compartidas: aprobados. La regresión completa ejecutada con `node scripts/check-saas-integrated.cjs --full --api-only` aprobó **49 suites y 243 pruebas**, sin omitidas; cada archivo se ejecutó en un proceso nuevo y los procesos sumaron 978 segundos. El conjunto móvil aprobó **75 pruebas**, TypeScript y compatibilidad Expo. La exportación Android/Hermes final aprobó **1195 módulos**, aproximadamente 3,8 MB; SHA-256 del bundle: `306F4ECD77EE2119FC33E4BF10F87CC3213F6E588AFB794D7C0A8B8EF2AD3DD4`. El bundle no es un APK firmado ni una prueba ejecutada en dispositivo.

Se añadió una regresión de compatibilidad para recibos QR antiguos: repetir el mismo método y referencia conserva el resultado, mientras que cambiarlos se rechaza; la salida de stock sigue siendo única. En Android, comprobar nuevamente un pago muestra el estado actual del pedido, también si ya está en preparación o fue cancelado. Ambos cambios tuvieron una prueba que falló antes de la corrección.

El coordinador ahora conserva código de salida, señal y progreso por archivo y espera a cerrar el log. La primera repetición monolítica con límite de 1024 MiB agotó el heap de Jest; no se usó como resultado aprobado. El resultado final procede de procesos separados, todos con salida cero. Los errores de arranque de Nest se propagan como excepciones únicamente en Jest para conservar su diagnóstico; el arranque de producción no se modificó.

## Árbol que se conservará en el servidor

La auditoría completa, incluidas herramientas de desarrollo, aún señala diez entradas en Jest/Vite y dependencias asociadas. Por ello la imagen elimina los paquetes de desarrollo después de compilar. Prisma y tsx pasan a dependencias de ejecución porque el arranque los utiliza para migrar las tiendas.

`node scripts/check-production-install.cjs` realizó un `npm ci --omit=dev` en una copia temporal independiente: **245 paquetes instalados, Prisma y tsx ejecutables, contratos y motor de reportes cargables, Jest/ts-jest/Vite/plugin React ausentes y auditoría de producción cero**. El ensayo no conecta a una base; conserva su resumen en `.local/production-install`. Requiere ejecutar antes `npm run build` para disponer de los paquetes compartidos compilados. Esta comprobación se hizo en Windows y no sustituye el build Linux del contenedor.

La imagen preparada incorpora los dos entornos Python con sus locks, el worker analítico y los archivos fuente requeridos por las migraciones tsx. Se limita a uno el número de hilos de OpenMP/BLAS; los jobs analíticos conservan la ejecución serial del servidor. La carga automática de datos queda desactivada por defecto.

## Configuración preparada

Compose valida con `docker compose -f infra/vm/compose.yml config --quiet` usando valores temporales de QA. Exige los nombres de configuración de PostgreSQL, JWT, host público, clave maestra offline y operador de plataforma. Pasa al servidor las variables opcionales TEST de Stripe y de asistencia de reportes; no las incorpora a web ni APK. Las claves existentes y sus versiones deben conservarse al restaurar datos.

`RUN_DB_SEED=false` es el valor inicial. Restaurar una instalación existente requiere sus bases y archivos; arrancar no debe reemplazar sus datos mediante una semilla. Los scripts de entrada y Dockerfile conservan finales de línea LF mediante `.gitattributes`.

## Pendientes de esta fase

- Construir y arrancar la imagen Linux desde cero. El daemon Docker local no estaba disponible; no se declara esa prueba aprobada.
- Ensayar respaldo/restauración de control, al menos dos tiendas, archivos privados y material de recuperación de claves; adaptar las conexiones al destino.
- Verificar identidad, versionCode y certificado del APK final; completar aceptación en dispositivo.
- Configurar y probar proveedores TEST/IA con las cuentas autorizadas, verificar HTTPS y salud sobre la nueva VM cuando se habilite esa fase.
- Cerrar A06/B14, revisión final y trazabilidad documental antes de promover el candidato.

No se realizaron operaciones en la VM anterior ni se ejecutó un APK.
