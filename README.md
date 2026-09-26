# Vestidor 3D · Grupo 18

**Instancia publicada:** [Lúmina · moda femenina y vestidor 3D](https://172-191-104-91.sslip.io/). El catálogo inicial reúne 12 vestidos y faldas de Nike, adidas, Levi's y PUMA. Consulta [alcance, fuentes y límites del catálogo](docs/CATALOGO_LUMINA.md).

Primera entrega ejecutable basada en el documento actualizado [Plataforma_Vestidor3D_Grupo18.docx](docs/Plataforma_Vestidor3D_Grupo18.docx), también disponible en [PDF](docs/Plataforma_Vestidor3D_Grupo18.pdf). La línea base estructurada se conserva en [docs/linea-base.json](docs/linea-base.json) y la versión original del Word permanece en el historial de Git. El estado requisito por requisito está en [docs/AUDITORIA_ALCANCE_2026-09-20.md](docs/AUDITORIA_ALCANCE_2026-09-20.md). Esta versión todavía no representa el sistema final.

Repositorio oficial: [Santyxd353/examenSI2REPO](https://github.com/Santyxd353/examenSI2REPO). Rama principal: `main`.

La instancia pública se despliega desde `main` en una VM Azure con Docker Compose. Instrucciones: [docs/DESPLIEGUE_VM_AZURE.md](docs/DESPLIEGUE_VM_AZURE.md). La configuración para Azure Container Apps permanece en [docs/DESPLIEGUE_AZURE.md](docs/DESPLIEGUE_AZURE.md) como alternativa.

Para obtener el proyecto:

```powershell
git clone https://github.com/Santyxd353/examenSI2REPO.git
cd examenSI2REPO
```

## Abrir en este equipo

Desde PowerShell, dentro de esta carpeta:

```powershell
./scripts/start.ps1
```

Abre **http://localhost:5173**. Elige **Iniciar sesión → ¿Primera vez? Crea tu cuenta**. No hay contraseñas compartidas ni usuarios administradores predeterminados.

Para habilitar de forma local la primera cuenta administradora, registra una cuenta normal y ejecuta:

```powershell
npm run user:grant-admin -- correo@ejemplo.com
```

La siguiente sesión mostrará **Inventario**, desde donde se crean, editan y desactivan sucursales o almacenes; se asignan vendedores o analistas a una o varias ubicaciones; se consulta el detalle físico, reservado, comprometido y disponible; se realizan conteos y conciliaciones; se configuran mínimos con alertas; se ajustan y transfieren existencias; y se consulta el historial. El catálogo muestra las unidades disponibles y permite filtrar las prendas por sucursal o almacén.

Los roles Administrador y Analista también ven **Reportes**. El panel resume ventas confirmadas por período, ubicación, producto y vendedor, además del inventario y sus alertas. Desde allí se puede ejecutar una proyección local de demanda, detectar valores semanales atípicos, obtener propuestas de reposición o traslado y formular consultas de solo lectura. Los resultados se guardan con la versión del modelo y explican los datos utilizados; son estimaciones estadísticas, no garantías de ventas futuras.

Los roles Administrador y Vendedor ven **Vender**. La pantalla permite seleccionar una ubicación autorizada, agregar varias prendas, indicar cliente y método de pago, y confirmar una venta de mostrador. La operación crea pedido, detalle y pago confirmado, descuenta el stock y registra el movimiento en una sola transacción. Los métodos Efectivo, Tarjeta y QR son registros internos de esta versión local; todavía no ejecutan cobros en una pasarela bancaria.

Puedes explorar el catálogo y girar el maniquí de referencia sin una cuenta. Para enviar las tres fotos, entra a **Mi avatar**, declara tu altura y acepta el consentimiento. Los resultados pasan a revisión antes de poder usarse en el vestidor. Si las imágenes no superan la validación, se muestra el fallo y se purgan las fotos.

**Estado del generador:** hay un proceso real MediaPipe/OpenCV → geometría paramétrica → Blender → GLB. Se han probado cálculos, exportación y rechazo/purga de entradas inválidas. Falta validar el recorrido satisfactorio y la calidad corporal con tres fotografías reales autorizadas; tampoco está terminado el ajuste de las prendas a distintos cuerpos. El maniquí inicial es una referencia identificada en pantalla.

Para detener los servicios y conservar la base de datos:

```powershell
./scripts/stop.ps1
```

Después de cambiar el servidor, detén los servicios y arranca con `./scripts/start.ps1 -Rebuild`. Para trabajar con recarga automática: `npm run dev:api` y `npm run dev:web` en terminales separadas, con PostgreSQL ya iniciado y los puertos libres.

## Primera instalación en otro Windows

Requisitos: Node.js 22.12 o superior, npm, Python 3.12 con el lanzador `py`, PostgreSQL 18 y un navegador con WebGL. El equipo debe tener espacio para las dependencias y Blender; la descarga comprimida de Blender ronda 400 MB.

```powershell
./scripts/setup.ps1
./scripts/start.ps1
```

El instalador:

1. Crea secretos aleatorios en `.env` solo si no existe.
2. Prepara un clúster propio en `.local/pgdata`, puerto **55418**. Conserva las bases existentes.
3. Instala las dependencias bloqueadas, aplica la migración y genera Prisma.
4. Instala Python aislado, descarga el modelo y Blender de sus proveedores oficiales y comprueba sus SHA-256.
5. Genera los recursos 3D propios y carga tres prendas de desarrollo, tallas S/M/L, precios y existencias.
6. Prepara `vestidor18_test` y compila API y web.

Si PostgreSQL está en otro directorio, configura `VESTIDOR_PG_BIN` con su carpeta `bin`. Si la política de PowerShell bloquea un script descargado, revisa su contenido y desbloquea ese archivo con `Unblock-File`; no es necesario cambiar la política del equipo.

Los scripts actuales usan los puertos locales **55418 / 3018 / 5173**. Una conexión distinta requiere configurar y arrancar los componentes manualmente. No hay despliegue en Azure ni acceso desde teléfonos físicos en esta entrega.

## Estructura y stack

| Carpeta          | Responsabilidad                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/api`       | NestJS + TypeScript: autenticación, permisos, catálogo, inventario, reportes, analítica, avatares y vestidor |
| `apps/web`       | React + TypeScript + Three.js: colección, inventario, reportes, captura, revisión y visor                    |
| `apps/mobile`    | React Native/Expo: sesión móvil, catálogo, cámara, base AR y WebSocket                                       |
| `prisma`         | PostgreSQL, migración de las 49 tablas documentadas y cliente Prisma                                         |
| `workers/avatar` | Python, MediaPipe, OpenCV y exportación Blender a GLB                                                        |
| `scripts`        | Preparación, arranque, semilla y verificación de navegador                                                   |
| `docs`           | Línea base aprobada, avance y evidencia de pruebas                                                           |

Existe una base Android/iOS en `apps/mobile`: React Native con Expo, sesión móvil renovable en almacenamiento seguro, catálogo por ubicación, cámara frontal, seguimiento corporal experimental mediante MediaPipe en Android, superposición aproximada y actualización de inventario por WebSocket. La detección usa capturas periódicas; todavía faltan flujo continuo, deformación, oclusión, calibración amplia e implementación nativa para iOS.

Para iniciar Metro y abrir la base móvil con Expo Go:

```powershell
npm run mobile:start
```

En un teléfono físico, copia `apps/mobile/.env.example` como `.env` y usa la IP local de la computadora en `EXPO_PUBLIC_API_URL`. La API debe ser accesible desde la misma red. La futura integración nativa de MediaPipe necesitará un development build; compilar Android localmente requiere Android Studio/SDK y compilar iOS requiere macOS con Xcode.

## Verificación

Con la base local y los recursos de referencia preparados:

```powershell
npm run build
npm run mobile:typecheck
npm run mobile:check
npm run db:prepare-test
npm test
./workers/avatar/.venv/Scripts/python.exe -m pytest workers/avatar/tests -q
npm audit --omit=dev
```

Con API y web iniciadas, la prueba de navegador necesita Chromium:

```powershell
npx playwright install chromium
node scripts/check-ui.cjs
```

Esta última crea una cuenta de prueba y utiliza una copia del maniquí como **fixture de prueba**, para comprobar acceso privado, aprobación, cambio de prenda y borrado. No acredita una reconstrucción desde fotografías. Guarda las capturas en `.local/ui-*.png` y el resultado en `.local/ui-result.json`.

## Datos privados y configuración

- `.env`, `.local`, la base, fotografías, avatares y entornos instalados quedan fuera de Git. No compartas esas carpetas con el código.
- Las fotos permanecen en `private/captures`, separadas de `public`; se eliminan al terminar o fallar el trabajo. La cola revisa además el plazo máximo de 24 horas mientras el servicio está en ejecución. Después de una interrupción, purga primero las capturas vencidas al arrancar.
- El servidor comprueba sesión y propietario para entregar un avatar. La revisión, aprobación y eliminación operan sobre datos persistidos.
- El borrado bloquea el acceso inmediatamente; solo pasa a `ELIMINADO` tras purgar archivo, medidas y parámetros.
- El almacenamiento actual es local. Retención de respaldos, cifrado en infraestructura, supervisión y disponibilidad continua se resolverán al preparar el despliegue previsto.
- Los registros de aplicación no incluyen fotografías, medidas, contraseñas ni tokens.

Detalles del procesador y sus límites: [WORKER_AVATAR.md](docs/WORKER_AVATAR.md).

## Integrantes

- Pérez Arauco Juan Carlos — 223093637
- Sanchez Paniagua Felix Santiago — 222115203
