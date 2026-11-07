# A10 · Motor de reportes compartido

El paquete `@lumina/reporting` ejecuta la misma definición sobre el mismo conjunto de datos en servidor, web y Android. El motor recibe hechos separados, fechas de corte y cobertura. No necesita acceso a la base ni a la red. El servidor y los clientes deben verificar la procedencia y el hash al descargar el conjunto.

| Función | Resultado |
| --- | --- |
| `validateReport(definition, dataset)` | Comprueba esquema, grano, rangos, ámbito, campos disponibles y límites. Devuelve problemas estructurados. |
| `executeReport(definition, dataset)` | Devuelve KPIs, grupos, widgets, comparación, detalle, cobertura y advertencias. Las métricas de dinero usan centavos. |
| `applyCrossFilter(base, selection)` | Deriva una definición nueva con el filtro seleccionado. Usar la definición base al cambiar o borrar una selección. |
| `pageReportDetail(result, offset, pageSize)` | Pagina el detalle local con páginas de hasta 500 filas. |
| `exportReportCsv(result)` | Exporta contexto, cobertura, filtros, totales y detalle. Los valores BOB se presentan con dos decimales y se neutralizan fórmulas en celdas de texto. |

Los pagos se consultan por pedido. Una línea se cuenta una vez aunque el pedido tenga dos pagos. Al agrupar por método, un pago dividido se muestra en una combinación explícita y se puede seleccionar desde el gráfico. Cada grupo cuenta pedidos distintos. El total vuelve a deduplicar en toda la selección. Las ventas brutas, las unidades devueltas y los reembolsos mantienen sus propios importes y fechas. El stock calcula disponible como físico menos reservado y comprometido en la fecha del corte.

La fecha comercial usa `America/La_Paz` y la semana sigue el año ISO. El ticket promedio conserva numerador y denominador. Se redondea al centavo y devuelve N/A si no hay pedidos. Un límite de grupos solo reduce lo mostrado. El motor informa cobertura parcial y rechaza solicitudes que excedan las fechas, ubicaciones o columnas descargadas.

El caso base mantiene 22 000 centavos, cuatro unidades, dos pedidos y un ticket de 11 000 centavos. La devolución aceptada suma una unidad y el reembolso confirmado 5000 centavos. El stock del caso base deja siete unidades disponibles. Se comprobó la paridad del resultado completo y del CSV en CommonJS y Chromium/Vite. El estado histórico `PAGADO` de la fixture cuenta como venta confirmada junto con los estados comerciales actuales.

```powershell
npm run test:shared
npm run build
node scripts/check-shared-bundles.cjs
```

La paridad en Hermes y la integración con datos de tienda, interfaz y archivos privados se verifican en B10 y A11–A12.
