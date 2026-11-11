# Tienda de demostración poblada

Instancia verificada el 11 de noviembre de 2026. La tienda independiente `lumina-demo` permite revisar el sistema con inventario, ventas históricas, devoluciones, reportes y análisis de datos. Los clientes y las operaciones comerciales son ficticios; no representan compras ni cobros reales.

## Acceso

- Tienda: <https://lumina.20-25-26-113.sslip.io/?tienda=lumina-demo>.
- Operador global: <https://lumina.20-25-26-113.sslip.io/?plataforma=1>.
- Nombre visible: **Lúmina Demo · datos simulados**.
- Plan: Negocio, habilitado para la demostración académica sin cargo.
- Las credenciales se entregaron por separado al propietario. No se almacenan en el repositorio.

El administrador comercial entra en la tienda y abre **Administración**. El operador global utiliza el segundo acceso para administrar negocios y suscripciones; su contraseña existente se conservó.

## Contenido disponible

| Área | Datos al finalizar la carga |
| --- | --- |
| Catálogo femenino | 12 prendas publicadas, vestidos y faldas del catálogo existente de Lúmina |
| Marcas | Nike, adidas, Levi’s y PUMA |
| Tallas y recursos | 36 variantes, 36 registros de modelos 3D, 12 fotos y 12 imágenes AR asociadas mediante 36 recursos |
| Clientas | 40 cuentas ficticias |
| Personal | Administradora y 3 colaboradoras |
| Ubicaciones | Santa Cruz Centro, Equipetrol y La Paz, más Almacén central |
| Inventario | 144 saldos por variante/ubicación, 3.447 unidades físicas; incluye disponibilidad baja y agotados |
| Historial comercial | 540 ventas pagadas de demostración, con variedad de canales, sucursales, vendedoras y fechas |
| Pedidos | 558 en total, incluidos cancelados y ejemplos pendientes; las reservas vencen según las reglas normales del sistema |
| Posventa | 12 devoluciones y 8 reembolsos confirmados; algunas ventas se reembolsaron por completo |
| Vestidor | 90 sesiones históricas con 270 eventos, además de las comprobaciones funcionales |
| Reportes | 6 diseños guardados y ejecutados |
| Analítica ML | Dataset sintético, dos entrenamientos completos, pronósticos de 7 y 30 días y sugerencias de reposición |

Las ventas históricas cubren aproximadamente seis meses, de mayo a noviembre de 2026. Se generaron usando los controladores comerciales para conservar líneas, pagos simulados, historial y movimientos. Se verificó que el inventario coincida con sus movimientos, los importes de los pedidos con sus detalles y los reembolsos con los pagos. Las otras tiendas existentes se conservaron.

## Revisar los reportes

1. Entrar como administradora de `lumina-demo` y abrir **Administración → Reportes y análisis**.
2. Preparar los datos con fecha inicial **14/05/2026** y fecha final **11/11/2026** para incluir toda la carga histórica.
3. En **Diseño**, seleccionar un diseño guardado y pulsar **Abrir diseño**.
4. Interactuar con sus gráficos y filtros. Preparar un corte nuevo cuando venza el anterior; los cortes conservan la caducidad habitual de la aplicación.

Diseños disponibles:

- Demo · Resumen ejecutivo y evolución.
- Demo · Ventas por sucursal y canal.
- Demo · Marcas, prendas y tallas.
- Demo · Rendimiento de vendedoras.
- Demo · Devoluciones y reembolsos.
- Demo · Stock, tallas y disponibilidad.

En reportes, la fuente de base de datos corresponde a las filas guardadas de **esta tienda de demostración**. Su clasificación técnica como fuente `REAL` no convierte las operaciones simuladas en ventas reales.

## Analítica de machine learning

Se completaron seis ejecuciones: `GENERATE_DATASET`, `TRAIN_DEMAND`, `TRAIN_ANOMALY`, `FORECAST` con horizontes de 7 y 30 días, y `SUGGEST_RESTOCK` para 7 días. Los modelos entrenados son RandomForestRegressor e IsolationForest. Los artefactos se verificaron por SHA-256 en el volumen persistente.

La procedencia es **DEMOSTRACION_SINTETICA**. Se utilizó el contrato sintético fijo `demo-femenino-seed42-v1`; sus entidades no se deben confundir con el catálogo comercial clonado. Estos resultados permiten revisar el flujo de entrenamiento y predicción, sin afirmar precisión sobre datos de un negocio real.

## Vestidor y modo offline

Se reutilizaron los recursos existentes de Lúmina y se comprobaron sus descargas. Los modelos 3D representan siluetas aproximadas de vestidos y faldas; las fotos corresponden al catálogo existente. No se presentan las siluetas como digitalizaciones exactas de las marcas.

La administradora dispone de un avatar **genérico de referencia**, identificado como tal. No procede de fotografías personales. La validación de avatar personal permanece activa y no incluye ese avatar de referencia en el paquete offline.

Se verificaron la prueba de una prenda y dos paquetes offline completos de diez prendas cada uno: `WEB_3D` y `ANDROID_AR`. Se descargaron y contrastaron los hashes de los archivos. La comprobación Android utilizó las API y los recursos del paquete; no se ejecutó una APK ni se certificó seguimiento AR en un dispositivo físico.

## Respaldo y mantenimiento

Los respaldos privados de esta operación están en `/home/azureuser/lumina-backups/20261111-demo-store-l6DNGr`. Incluyen el control anterior, copias de las bases existentes, el almacenamiento, la configuración privada y, al terminar, el dump de la tienda y los artefactos analíticos con manifiesto SHA-256 verificado.

Los scripts de población permanecen fuera de Git y no se ejecutan al arrancar. No volver a aplicarlos sobre la tienda después de empezar a registrar cambios manuales: podrían reemplazar datos de demostración. Para restaurar, conservar tanto las bases como los archivos y las versiones de las claves privadas; los respaldos no se publican en el repositorio.
