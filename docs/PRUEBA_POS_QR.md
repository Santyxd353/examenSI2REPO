# Ventas de mostrador y QR de demostración

Actualización: 11 de noviembre de 2026.

## Comportamiento

- El POS admite efectivo y QR. El servidor rechaza tarjeta en ese módulo; Stripe de compras y suscripciones conserva su comportamiento.
- Efectivo confirma el pedido y descuenta stock al registrar la venta.
- QR crea un pedido pendiente y reserva stock durante quince minutos. El importe se calcula en el servidor. El stock físico y los reportes de ventas pagadas cambian al confirmar el pago.
- El QR de compras WEB/APP y POS contiene una URL HTTPS del servidor. La cámara normal del teléfono abre un simulador, sin otra aplicación ni sesión del comprador. También existe el enlace «Abrir simulador de pago».
- Abrir el enlace solo consulta. Para pagar hay que pulsar «Confirmar pago simulado». No se mueve dinero ni se solicitan datos bancarios.
- El enlace usa una capacidad firmada con audiencia exclusiva para QR, limitada a una tienda y un pedido, y vence junto con la reserva. El token se transporta en el fragmento de la URL y no concede acceso a cuentas ni al resto de los pedidos.
- Una confirmación repetida o concurrente no duplica pagos ni movimientos de inventario. Las reservas POS vencidas se liberan con el mantenimiento existente de pedidos.
- El cliente que muestra el QR comprueba el pedido periódicamente y cierra el diálogo al confirmarse el pago.
- Se conserva la lectura del formato antiguo `LUMINA-PAY-DEMO` para compatibilidad con aplicaciones anteriores. Los nuevos QR son enlaces navegables.

## Validación

- `apps/api/test/qr-demo.test.ts`: enlaces WEB/APP, consulta sin pago, confirmación sin sesión, duplicados concurrentes, aislamiento de tienda, firma y audiencia, vencimiento, POS efectivo/QR y liberación de reservas.
- `apps/api/test/sales.test.ts` y `checkout-payments.test.ts`: regresión de precios, canales, stock, idempotencia y Stripe de prueba. Los tres archivos suman 24 pruebas.
- `scripts/check-checkout-ui.cjs`: compra WEB y POS QR desde un segundo navegador sin sesión; persistencia tras recarga; cambio de QR en la misma pestaña; POS sin tarjeta y venta en efectivo; anchos 320, 390, 768 y 1440 píxeles.
- Android: pruebas unitarias de flujo de mostrador/pagos y comprobación de tipos. Los fuentes incluyen enlaces QR y eliminación de tarjeta del POS. Esta actualización del servidor no reemplaza por sí sola una APK ya instalada; esos cambios nativos requieren una nueva compilación.

Las pruebas automatizadas usan bases y prendas de QA, sin modificar ventas ni inventario de clientes en Azure.
