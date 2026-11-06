# A12 · Dashboard web

Desde **Administración → Reportes y análisis**, el personal autorizado puede preparar un corte de ventas, devoluciones e inventario, o elegir una demostración sintética identificada. El dashboard muestra el período consultado, la fuente, la fecha del corte y los límites de cobertura. El resumen de ventas anterior se abre desde el mismo módulo.

- El diseño admite métricas, hasta cinco agrupaciones, comparación de períodos, filtros tipados y hasta dieciséis gráficos adicionales. El gráfico principal ofrece barras, línea, área, anillo y tabla. La selección cruzada se activa desde las series con el teclado.
- Los diseños privados se guardan, editan y archivan en el servidor con el cupo del plan. Abrir un diseño revalida que el corte actual cubra su fuente, sus fechas y filtros.
- Una copia cifrada por cuenta, tienda y dispositivo permite volver a abrir el dashboard sin red, modificar los filtros y exportar. Los archivos del shell se precargan mediante el service worker. Los resultados privados viven en el almacén cifrado de IndexedDB.
- El CSV identifica la fuente, los filtros y el corte. La impresión local conserva esos datos para guardar un PDF.

## Verificación local

Se ejecutó `npm run build:web` y `node scripts/check-reporting-web.cjs` con PostgreSQL local. El recorrido provisionó una tienda aislada, comprobó Bs 0,00 con datos reales y Bs 220,00 con datos sintéticos, guardó un diseño, cerró Chromium y lo abrió sin red. La selección por teclado redujo el total a Bs 170,00. Un filtro manual obtuvo Bs 50,00 y el CSV exportó ese importe. Se generó PDF y se revisó el ancho de 390 px.

El recorrido prueba la web. La interpretación por texto y voz y la integración Android tienen verificaciones propias.
