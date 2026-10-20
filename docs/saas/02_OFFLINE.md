# Diseño y plan del segundo incremento

## Resultado esperado

Una usuaria puede reabrir su paquete descargado de prendas sin conexión. Una administradora puede consultar su copia de inventario, registrar altas o cambios y conservar una cola después de cerrar la aplicación. Al volver la red, cada operación se valida y se aplica una sola vez o queda como conflicto visible. Esto debe funcionar en web y Android.

Este archivo define el incremento siguiente; no describe funciones offline terminadas.

## Persistencia y separación

Web usará IndexedDB para catálogo, inventario, identidad local autorizada, operaciones y conjuntos de reportes; un service worker conservará la aplicación y recursos descargados explícitamente. Android usará SQLite para los mismos registros y el sistema de archivos para imágenes y modelos. Los tokens seguirán en cookie segura o SecureStore. Ninguna caché de respuestas privadas se compartirá por URL entre tiendas.

Cada registro local pertenece a tienda y usuario. Cambiar de tienda cambia el almacén completo; cerrar sesión elimina la sesión y bloquea el acceso local. La aplicación no borrará una cola pendiente de otro usuario de forma silenciosa: deberá informar y ofrecer conservarla bloqueada o descartarla antes del cierre definitivo.

La identidad descargada solo autoriza trabajo local limitado. Una sesión expirada requiere autenticación al sincronizar. El servidor revalida los permisos actuales aunque el dispositivo conserve permisos antiguos.

## Contrato de operación

| Campo | Significado |
| --- | --- |
| operationId | UUID durable generado al guardar la intención |
| deviceId | Identificador de la instalación que originó la operación |
| kind | Tipo permitido de alta, edición, archivo, movimiento o conteo |
| entityId | Identificador estable del registro afectado |
| baseVersion | Versión descargada para ediciones y conteos |
| payload | Campos permitidos por el esquema de ese tipo |
| createdAt | Fecha local informativa, sin autoridad sobre el saldo del servidor |

La tienda proviene del contexto validado de la petición y el actor del token; el servidor no acepta esos identificadores como autoridad dentro del cuerpo.

Estados locales: `PENDING`, `SENDING`, `APPLIED`, `CONFLICT`, `BLOCKED`. Un cierre mientras se envía devuelve la operación a pendiente al reabrir. No se elimina de la cola antes de persistir el comprobante del servidor.

El servidor almacenará UUID, actor, dispositivo, tipo, hash canónico de la intención y resultado en un registro de operaciones de la propia base. El comprobante se confirma en la misma transacción que el cambio. Repetir UUID y contenido recupera el resultado; repetir UUID con otra intención produce conflicto. Una respuesta perdida después del commit no duplica unidades al reintentar.

## Reglas por tipo

Los aumentos o disminuciones son deltas, con motivo y trazabilidad. El servidor bloquea el inventario y verifica que el resultado respete físico, reservado y comprometido. No convierte el saldo proyectado del dispositivo en el saldo absoluto del negocio.

Los conteos contienen cantidad observada y versión. Si hubo una venta, reserva o ajuste desde la descarga, el conteo no sustituye ese resultado: devuelve los valores actuales para que la persona decida conciliar.

Las altas de catálogo usan identificadores generados en cliente para que otras operaciones pendientes puedan referenciarlas. Las fotos permanecen guardadas localmente y se envían como recursos validados cuando haya red. La creación y el archivo deben respetar capacidad del plan y las reglas comerciales existentes. El archivo no elimina ventas ni historial.

Las ediciones usan versión de catálogo. Una prenda archivada o editada en otro equipo produce conflicto cuando corresponda. No se aplica la regla de que gana siempre el dispositivo que subió último.

No se añaden ventas ni cobros offline a este incremento.

## API propuesta

`GET /api/offline/snapshot` entregará únicamente las ubicaciones y datos permitidos para la persona autenticada, con versiones, fecha y cobertura. Los datos demasiado grandes tendrán paginación o límites explícitos; el cliente no marcará como completa una descarga parcial.

`POST /api/offline/sync` aceptará un lote acotado y devolverá resultado por operación. La validación, autorización y transacción de cada intención son independientes. Los errores de autenticación o suscripción dejan la cola bloqueada hasta resolverlos; los conflictos conservan la intención original para revisión.

`GET /api/offline/outfits` construirá un manifiesto de hasta diez prendas. La selección prioriza gustos declarados, talla, favoritos e interacciones disponibles, sin prometer personalización aprendida cuando no exista entrenamiento. Cada recurso incluirá tipo, URL, tamaño, versión y hash. Una descarga corrupta o incompleta se reintenta sin marcar el paquete listo.

## Vestidor sin conexión

Web descargará los GLB autorizados y la referencia o avatar aprobado elegido por su propietaria. Android descargará los recursos RA compatibles con el seguimiento local actual. La pantalla distinguirá 3D y superposición AR; una fotografía PNG de ropa no se denominará modelo 3D.

La generación de avatar con tres fotos sigue requiriendo servidor. Se descargan únicamente recursos con autorización y licencia registradas; el paquete no concede acceso al avatar de otra persona.

## Plan de ejecución

1. Añadir versiones de catálogo y registro transaccional de operaciones mediante migración de todas las tiendas.
2. Escribir pruebas de dos dispositivos: repetición, respuesta perdida, delta concurrente, conteo vencido, stock insuficiente, permiso revocado y otro negocio.
3. Implementar el procesador con tipos cerrados y límites; reutilizar reglas de inventario y auditoría.
4. Probar y crear el snapshot con ámbito por ubicación y cobertura explícita.
5. Crear almacén IndexedDB y cola web; verificar persistencia tras recarga y red desactivada en Playwright.
6. Incorporar controles de pendientes, conflictos y conciliación al módulo Inventario y Catálogo.
7. Instalar las dependencias Expo compatibles de SQLite, archivos y conexión; crear el almacén Android equivalente.
8. Ampliar Administración Android con módulos funcionales de catálogo, inventario y sincronización.
9. Crear el manifiesto de prendas, selección por gustos y descarga verificada de recursos.
10. Probar carga sin red del visor web y AR Android con un paquete completo y otro interrumpido.
11. Aplicar migraciones, probar dos tiendas en el entorno de integración y construir un APK firmado compatible con la instalación anterior.
12. Actualizar casos ICONIX, robustez, secuencias, clases, modelo de datos y resultados de las pruebas ejecutadas.

## Aceptación

La evidencia debe mostrar cierre y reapertura sin red, operaciones pendientes intactas, sincronización tras volver la conexión y saldos finales correctos en servidor. Una repetición de la misma intención no añade un segundo movimiento. Una operación conflictiva permanece visible y no se anuncia como sincronizada. El dashboard offline se validará en el incremento de reportes sobre un conjunto descargado identificable.
