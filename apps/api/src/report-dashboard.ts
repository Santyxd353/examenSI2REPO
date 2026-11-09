export type ReportChart = {
  id: string;
  title: string;
  unit: 'Bs' | 'unidades';
  defaultType: 'bar' | 'line' | 'donut';
  points: { label: string; value: number }[];
};

type ChartReport = {
  products: readonly { producto: string; sku: string; ventas: number }[];
  locations: readonly { ubicacion: string | null; ventas: number }[];
  inventory?: readonly { ubicacion: string; disponible: number }[];
  timeline?: readonly { fecha: string; ventas: number }[];
};

export function reportDashboard(report: ChartReport, question: string): ReportChart[] {
  const normalized = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const charts: ReportChart[] = [
    {
      id: 'sales',
      title: 'Ventas por día',
      unit: 'Bs',
      defaultType: 'line',
      points: (report.timeline || []).map((row) => ({ label: row.fecha, value: row.ventas })),
    },
    {
      id: 'products',
      title: 'Ventas por producto y talla',
      unit: 'Bs',
      defaultType: 'bar',
      points: report.products.map((row) => ({
        label: row.producto + ' · ' + row.sku,
        value: row.ventas,
      })),
    },
    {
      id: 'locations',
      title: 'Participación de sucursales',
      unit: 'Bs',
      defaultType: 'donut',
      points: report.locations.map((row) => ({
        label: row.ubicacion || 'Sin ubicación',
        value: row.ventas,
      })),
    },
    {
      id: 'stock',
      title: 'Stock disponible por ubicación',
      unit: 'unidades',
      defaultType: 'bar',
      points: (report.inventory || []).map((row) => ({
        label: row.ubicacion,
        value: row.disponible,
      })),
    },
  ];
  const first = /stock|inventario|existencia/.test(normalized)
    ? 'stock'
    : /sucursal|ubicacion/.test(normalized)
      ? 'locations'
      : /producto|prenda|mas vendido/.test(normalized)
        ? 'products'
        : 'sales';
  return charts.sort((a, b) => Number(b.id === first) - Number(a.id === first));
}
