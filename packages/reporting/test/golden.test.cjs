const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../../contracts/fixtures/report-golden-v1.json');
const {
  executeReport,
  validateReport,
  applyCrossFilter,
  exportReportCsv,
  boliviaDate,
  isoWeek,
  pageReportDetail,
} = require('../dist');
const values = (result, metrics) => metrics.map((metric) => result.kpis[metric].value);
const definition = (patch = {}) => ({ ...structuredClone(fixture.definition), ...patch });
const dataset = () => structuredClone(fixture.dataset);
const sales = [
  'ventas_confirmadas_bob',
  'unidades_vendidas',
  'pedidos_distintos',
  'ticket_promedio_bob',
];

test('golden exacto y devoluciones separadas con dos pagos en el mismo pedido', () => {
  const input = definition({
    metrics: [...sales, 'unidades_devueltas', 'reembolsos_confirmados_bob'],
  });
  const actual = executeReport(input, dataset());
  assert.deepEqual(values(actual, input.metrics), [22000, 4, 2, 11000, 1, 5000]);
  assert.equal(actual.detail.total, 3);
  assert.equal(actual.kpis.ticket_promedio_bob.numerator, 22000);
  const card = executeReport(
    {
      ...input,
      filters: [...input.filters, { field: 'metodo_pago', operator: 'eq', value: 'TARJETA' }],
    },
    dataset(),
  );
  assert.deepEqual(values(card, sales), [15000, 3, 1, 15000]);
});

test('pedidos globales se deduplican entre categorías y top N conserva totales', () => {
  const data = dataset();
  const second = data.sales.find((line) => line.orderId === 'O1' && line.id !== 'L1');
  second.dimensions.categoria = 'Categoría adicional';
  const all = executeReport(definition({ dimensions: ['categoria'] }), data);
  assert.equal(all.kpis.pedidos_distintos.value, 2);
  assert.ok(all.groups.reduce((sum, group) => sum + group.metrics.pedidos_distintos.value, 0) > 2);
  const one = executeReport(definition({ dimensions: ['categoria'], limit: 1 }), data);
  assert.equal(one.groups.length, 1);
  assert.equal(one.kpis.ventas_confirmadas_bob.value, 22000);
  assert.match(one.warnings.join(' '), /grupos/);
});

test('la evolución temporal se ordena por fecha antes del límite, conservando el ranking de barras', () => {
  const data = dataset();
  for (const order of data.orders) {
    if (order.id === 'O1') order.confirmedAt = '2026-09-20T16:00:00.000Z';
    if (order.id === 'O2') order.confirmedAt = '2026-09-10T16:00:00.000Z';
  }
  const input = definition();
  input.dashboard.widgets = [
    { id: 'evolucion', chart: 'line', dimension: 'dia', metric: 'ventas_confirmadas_bob' },
    { id: 'area', chart: 'area', dimension: 'dia', metric: 'ventas_confirmadas_bob' },
    { id: 'ranking', chart: 'bar', dimension: 'dia', metric: 'ventas_confirmadas_bob' },
  ];
  const result = executeReport(input, data);
  for (const widget of result.widgets.slice(0, 2)) {
    assert.deepEqual(
      widget.groups.map((group) => group.dimensions.dia),
      ['2026-09-10', '2026-09-20'],
    );
  }
  assert.equal(result.widgets[2].groups[0].dimensions.dia, '2026-09-20');
  const limited = executeReport({ ...input, limit: 1 }, data);
  assert.equal(limited.widgets[0].groups[0].dimensions.dia, '2026-09-10');
  assert.equal(limited.kpis.ventas_confirmadas_bob.value, 22000);
});

test('stock es un corte separado y no acepta pagos o períodos históricos', () => {
  const input = definition({
    fact: 'stock_al_corte',
    dimensions: ['ubicacion'],
    metrics: [
      'fisico_al_corte',
      'reservado_al_corte',
      'comprometido_al_corte',
      'disponible_al_corte',
    ],
    order: [],
    dashboard: {
      widgets: [],
      crossFilter: true,
      detailAvailableColumns: ['ubicacion', 'disponible_al_corte'],
    },
  });
  assert.deepEqual(values(executeReport(input, dataset()), input.metrics), [10, 2, 1, 7]);
  assert.equal(
    validateReport(
      { ...input, filters: [{ field: 'metodo_pago', operator: 'eq', value: 'EFECTIVO' }] },
      dataset(),
    ).ok,
    false,
  );
  assert.equal(
    validateReport(
      { ...input, period: { from: '2026-09-01', to: '2026-09-10', inclusive: true } },
      dataset(),
    ).ok,
    false,
  );
});

test('cobertura fuera de fechas, ubicaciones o columnas se informa sin inventar ceros', () => {
  const input = definition();
  const partial = dataset();
  partial.authorizedLocationIds.push('segunda-tienda');
  partial.complete = false;
  partial.omittedCoverage = ['segunda-tienda aún sin descargar'];
  assert.equal(executeReport(input, partial).coverage.complete, false);
  for (const query of [
    { ...input, filters: [{ field: 'ubicacion', operator: 'eq', value: 'segunda-tienda' }] },
    { ...input, period: { from: '2026-08-01', to: '2026-09-01', inclusive: true } },
    {
      ...input,
      comparison: { from: '2026-08-01', to: '2026-08-31', mode: 'custom', requiresCoverage: true },
    },
  ]) {
    const valid = validateReport(query, partial);
    assert.equal(valid.ok, false);
    assert.ok(valid.problems.some((issue) => issue.code === 'DATASET_COVERAGE_INSUFFICIENT'));
    assert.throws(
      () => executeReport(query, partial),
      (error) => error.problems.some((issue) => issue.code === 'DATASET_COVERAGE_INSUFFICIENT'),
    );
  }
  partial.availableColumns = partial.availableColumns.filter((column) => column !== 'categoria');
  assert.equal(validateReport(input, partial).ok, false);
});

test('la fecha comercial y semana ISO son estables al cruzar el año', () => {
  assert.equal(boliviaDate('2026-01-01T02:00:00.000Z'), '2025-12-31');
  assert.equal(boliviaDate('2026-01-01T04:00:00.000Z'), '2026-01-01');
  assert.equal(isoWeek('2025-12-31'), '2026-W01');
  assert.equal(isoWeek('2021-01-01'), '2020-W53');
});

test('selección cruzada inmutable, intersección de filtros y CSV con procedencia', () => {
  const input = definition(),
    data = dataset();
  data.sales[0].dimensions.producto = '=HYPERLINK("unsafe")';
  const filtered = applyCrossFilter(input, { dimension: 'canal', value: 'APP' });
  assert.equal(input.filters.length, 2);
  assert.equal(filtered.filters.length, 3);
  const result = executeReport(filtered, data);
  const csv = exportReportCsv(result);
  assert.match(csv, /DEMOSTRACION_SINTETICA/);
  assert.match(csv, /2026-09-30/);
  assert.match(csv, /canal/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /100\.00/);
});

test('operadores tipados, rango invertido y ticket no disponible sin pedidos', () => {
  const base = definition(),
    data = dataset();
  const count = (filters) =>
    executeReport({ ...base, filters }, data).kpis.ventas_confirmadas_bob.value;
  const unit = (operator, value) => ({ field: 'precio_unitario', operator, value });
  assert.equal(count([unit('between', [5000, 6000])]), 15000);
  assert.equal(count([unit('gte', 5001), unit('lte', 7000)]), 7000);
  assert.equal(count([unit('in', [5000, 7000]), unit('not_in', [5000])]), 7000);
  assert.equal(count([unit('neq', 7000)]), 15000);
  assert.equal(
    validateReport({ ...base, filters: [unit('between', [7000, 5000])] }, data).ok,
    false,
  );
  data.sales[0].dimensions.marca = null;
  assert.equal(count([{ field: 'marca', operator: 'is_null' }]), 10000);
  assert.equal(
    executeReport({ ...base, filters: [unit('eq', 1)] }, data).kpis.ticket_promedio_bob.value,
    null,
  );
});

test('grupo de pagos divididos admite selección cruzada sin multiplicar ventas', () => {
  const input = definition({ dimensions: ['metodo_pago'] });
  const result = executeReport(input, dataset());
  const split = result.groups.find(
    (group) => group.dimensions.metodo_pago === 'EFECTIVO + TARJETA',
  );
  assert.equal(split.metrics.ventas_confirmadas_bob.value, 15000);
  assert.equal(
    result.groups.reduce((total, group) => total + group.metrics.ventas_confirmadas_bob.value, 0),
    22000,
  );
  const filtered = applyCrossFilter(input, {
    dimension: 'metodo_pago',
    value: split.dimensions.metodo_pago,
  });
  assert.deepEqual(values(executeReport(filtered, dataset()), sales), [15000, 3, 1, 15000]);
});

test('compara períodos cubiertos y pagina el detalle sin cambiar las cifras', () => {
  const input = definition({
    period: { from: '2026-09-10', to: '2026-09-15', inclusive: true },
    comparison: { from: '2026-09-01', to: '2026-09-09', mode: 'custom', requiresCoverage: true },
  });
  const actual = executeReport(input, dataset());
  assert.deepEqual(values(actual, sales), [22000, 4, 2, 11000]);
  assert.deepEqual(values(actual.comparison, sales), [0, 0, 0, null]);
  assert.equal(pageReportDetail(actual, 0, 2).nextOffset, 2);
  assert.equal(pageReportDetail(actual, 2, 2).rows.length, 1);
  assert.equal(pageReportDetail(actual, 2, 2).nextOffset, null);
});
