# B13 — Módulos comerciales, perfil, equipo y ubicaciones

Estado: `VERIFICADO_LOCAL` (09/11/2026).

- Perfil y direcciones: alta, edición, predeterminada y eliminación.
- Compra APP: carrito persistente, ubicación, dirección, reserva, Stripe TEST y QR académico.
- Pedidos: historial, líneas, estado de pago y seguimiento separados.
- Devoluciones: la clienta solicita cantidades compradas; administración aprueba o rechaza y el
  servidor limita reintegro/reembolso de forma transaccional e idempotente.
- Administración móvil: equipo, roles, asignación de ubicación, sucursales/almacenes, inventario,
  estados de pedido y devoluciones.
- Ninguna compra, pago, cancelación o devolución se presenta como completada sin respuesta del
  servidor.

Verificación: `commerce.test.ts`, `orders.test.ts` y `avatar.test.ts`: 16/16; pruebas móviles de
checkout y typecheck correctos.
