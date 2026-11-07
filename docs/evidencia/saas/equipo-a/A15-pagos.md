# A15 — integración de QR y Stripe TEST

Fecha: 07/11/2026. Candidato de trabajo: rama `integracion/android`, continuación de `3c46292`. Integra los cambios B hasta `89accbf`. Este registro no acredita despliegue ni aceptación física Android.

## Comportamiento implementado

- WEB y APP generan un pedido con reserva. El QR contiene su identificador, importe y moneda BOB. La billetera de demostración solo confirma un pedido propio de la tienda actual. Un pedido WEB escaneado desde APP conserva su canal WEB en los registros.
- Los bloqueos de pedido y evento, el comprobante persistido y la huella de la solicitud evitan otra salida de inventario al repetir. Reutilizar una intención cambiando datos se rechaza. El lector Android reconstruye la misma intención desde el UUID del pedido después de cerrar o perder la respuesta.
- Stripe admite exclusivamente claves TEST. Antes de llamar al proveedor se guarda la intención y un vencimiento fijo. La creación usa una clave de idempotencia que incluye tienda, pago y vencimiento. Reiniciar el controlador o perder la respuesta reutiliza esa intención; no vuelve al QR con una sesión Stripe pendiente.
- La confirmación comprueba modo TEST, tienda, propietaria, canal, pedido, sesión almacenada, moneda y monto exacto. El método se comprueba nuevamente dentro del bloqueo del pedido para evitar una carrera entre QR y Stripe. Solo se confirma con reserva vigente.
- El retorno web conserva `tienda`. Para compras APP muestra la indicación de volver a Android; Android comprueba al regresar o mediante el botón de comprobación. La sesión se recupera del pedido guardado tras reiniciar. No se transfieren tokens por URL.

## Evidencia observada

| Prueba | Resultado |
| --- | --- |
| `checkout-payments`, `commerce`, `commerce-idempotency` | 18 pruebas aprobadas |
| QR concurrente, monto manipulado, cuenta/tienda ajena, vencimiento, UUID reutilizado | Verificados contra PostgreSQL local |
| Stripe concurrente y metadata/moneda/monto/canal alterados | Verificados con proveedor controlado en Jest |
| Respuesta perdida después de crear la sesión | Intención durable y una sola sesión; se vuelve a comprobar con un controlador nuevo |
| Cliente Android | 69 pruebas, TypeScript y compatibilidad Expo aprobados |
| Exportación Hermes | 1192 módulos; SHA-256 `02EB86FE1FBF3D6CFDC3444EDA99BCEDAC7521C92AB56EDD62361F1D1BC8CFE2` |
| API y web | Compilación aprobada |
| `node scripts/check-checkout-ui.cjs` | Chromium: QR visible en escritorio y 390 px, dos confirmaciones APP idénticas, un pago/salida, stock 9 y pedido confirmado tras recargar |

Se revisaron `.local/checkout-qr-desktop.png` y `.local/checkout-qr-mobile.png`. El recorrido crea y elimina una tienda QA propia; solo permite PostgreSQL local y desactiva Stripe externo. No ejecuta un APK ni utiliza datos publicados.

La primera suite general encontró un timeout de 30 s en `analytics-isolation` mientras se creaban bases de prueba en paralelo con el recorrido de navegador. PostgreSQL registró un checkpoint de 26,9 s. La repetición general, sin esas tareas paralelas, pasó **49 suites y 242 pruebas en 461,569 segundos**, incluido el caso con un controlador nuevo tras respuesta perdida. No se ampliaron los tiempos comerciales para ocultarlo.

## Límites que deben conservarse en la entrega

- Stripe retail TEST amplía el alcance original de Stripe de suscripciones. A17 debe reflejar este flujo concreto en ICONIX; no se presenta como cobro de producción.
- Esta entrega confirma Stripe por comprobación del servidor al regresar/solicitarla. No afirma confirmación automática retail mediante webhook. Si se cierra el cliente, debe reabrirse y comprobar el pago. Una reserva vencida no se convierte en venta aunque el proveedor informe un pago.
- Los tests de Stripe sustituyen el proveedor; falta la prueba con su cuenta TEST configurada y el flujo Android en dispositivo.
- El generador heredado `seed-branch-inventory.ts` se conserva como herramienta de QA: requiere base local `vestidor18_test` y `--confirm-demo-stock`. No forma parte del despliegue ni carga stock en tiendas comerciales.
- No se incorporó el comando B `db:seed:reports`: su archivo no existe en el candidato y la demostración ML mantiene sus datos separados de las ventas reales.
- Se conserva el transporte web A con sus guardas de sesión/offline. Los renderizadores QR se añadieron sin sustituir las versiones canónicas de Expo, Stripe o los paquetes compartidos.
