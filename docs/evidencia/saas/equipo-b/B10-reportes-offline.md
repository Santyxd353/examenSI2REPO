# B10 — Reportes, dashboard y exportación offline

Estado: `VERIFICADO_LOCAL` (09/11/2026).

- Dashboard de 7, 30 y 90 días con ventas, pedidos, unidades, ticket, productos y sucursales.
- Cada período consultado se guarda cifrado por tienda, usuario y dispositivo.
- Si la red falla, Inicio y Reportes recuperan la copia local y muestran fecha/origen offline.
- CSV neutraliza fórmulas y escapa separadores/comillas; PDF se genera sin recursos remotos.
- La exportación sigue disponible sobre una copia offline autorizada.
- Barras de productos y sucursales conservan cifras exactas del resumen del servidor.

Verificación: 50/50 pruebas móviles, typecheck correcto y build web/API correcto. Las pruebas
`offlineReport.test.ts` y `reportExport.test.ts` cubren validación, CSV y PDF.
