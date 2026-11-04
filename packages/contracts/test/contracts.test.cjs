const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../dist');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const intent = () => ({
  schemaVersion: '1.0',
  tenantId: id(1),
  actorId: id(2),
  deviceId: id(3),
  operationId: id(4),
  kind: 'STOCK_DELTA',
  entityId: id(5),
  baseVersion: 1,
  dependsOn: [],
  createdAt: '2026-11-02T12:00:00.000Z',
  payload: { variantId: id(6), locationId: id(7), deltaFisico: 3, reason: 'Reposición' },
  payloadHash: 'a'.repeat(64),
});
const digest = (v) => createHash('sha256').update(c.canonicalIntentJson(v)).digest('hex');

test('contratos de catálogo respetan SKU/barcode de la BD y descuentos vigentes; transferir es solo online', () => {
  c.CatalogProductSchema.parse(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '../fixtures/catalog-product-v1.json'), 'utf8'),
    ),
  );
  c.OnlineTransferSchema.parse(
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '../fixtures/online-transfer-v1.json'), 'utf8'),
    ),
  );
  assert.equal(c.CatalogProductPatchSchema.safeParse({}).success, false);
  const variant = {
    id: id(8),
    sku: 'VESTIDO-S',
    talla: 'S',
    color: 'Rosa',
    prices: { WEB: 5000, APP: 4500, TIENDA: 4900 },
    barcode: '784000000001',
    discounts: {
      WEB: {
        basisPoints: 1500,
        startsAt: '2026-11-03T12:00:00.000Z',
        endsAt: '2026-11-10T12:00:00.000Z',
      },
    },
  };
  assert.equal(c.CatalogVariantSchema.safeParse(variant).success, true);
  assert.equal(
    c.CatalogVariantSchema.safeParse({ ...variant, sku: 'a'.repeat(61) }).success,
    false,
  );
  assert.equal(
    c.CatalogVariantSchema.safeParse({ ...variant, barcode: 'a'.repeat(81) }).success,
    false,
  );
  assert.equal(
    c.CatalogVariantSchema.safeParse({
      ...variant,
      discounts: { WEB: { ...variant.discounts.WEB, endsAt: variant.discounts.WEB.startsAt } },
    }).success,
    false,
  );
  const transfer = {
    origenId: id(1),
    destinoId: id(2),
    varianteId: id(3),
    cantidad: 3,
    motivo: 'Reposición tienda',
    operationId: id(4),
    deviceId: id(5),
  };
  assert.equal(c.OnlineTransferSchema.safeParse(transfer).success, true);
  assert.equal(
    c.OnlineTransferSchema.safeParse({ ...transfer, deviceId: undefined }).success,
    false,
  );
});

test('dinero BOB usa centavos exactos, signo y rango seguro', () => {
  assert.equal(c.moneyToMinor('149.00'), 14900);
  assert.equal(c.moneyToMinor('0.10'), 10);
  assert.equal(c.moneyToMinor('-0.25'), -25);
  assert.equal(c.minorToDecimal(29900), '299.00');
  assert.equal(c.moneyToMinor('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  for (const value of ['149.001', '1e3', 'NaN', '', ' 1 ', '90071992547409.92'])
    assert.throws(() => c.moneyToMinor(value), value);
  assert.throws(() => c.minorToDecimal(0.1));
});

test('solo cinco tipos offline y payload estricto, sin saldo ni permisos del cliente', () => {
  assert.equal(c.OfflineIntentSchema.parse(intent()).payload.deltaFisico, 3);
  for (const kind of ['SALE_OFFLINE', 'TRANSFER', 'ONLINE_TRANSFER'])
    assert.equal(c.OfflineIntentSchema.safeParse({ ...intent(), kind }).success, false);
  for (const deltaFisico of [0, 1.5, NaN, Infinity])
    assert.equal(
      c.OfflineIntentSchema.safeParse({
        ...intent(),
        payload: { ...intent().payload, deltaFisico },
      }).success,
      false,
    );
  assert.equal(c.OfflineIntentSchema.safeParse({ ...intent(), admin: true }).success, false);
  assert.equal(
    c.OfflineIntentSchema.safeParse({ ...intent(), payload: { ...intent().payload, fisico: 30 } })
      .success,
    false,
  );
});

test('conteo exige versión; dependencia no puede referirse a sí misma ni repetirse', () => {
  const count = {
    ...intent(),
    kind: 'STOCK_COUNT',
    payload: {
      variantId: id(6),
      locationId: id(7),
      observedPhysical: 12,
      reason: 'Conteo de almacén',
    },
  };
  assert.equal(c.OfflineIntentSchema.parse(count).baseVersion, 1);
  assert.equal(c.OfflineIntentSchema.safeParse({ ...count, baseVersion: null }).success, false);
  assert.equal(
    c.OfflineIntentSchema.safeParse({
      ...count,
      payload: { ...count.payload, observedPhysical: -1 },
    }).success,
    false,
  );
  assert.equal(c.OfflineIntentSchema.safeParse({ ...intent(), dependsOn: [id(4)] }).success, false);
  assert.equal(
    c.OfflineIntentSchema.safeParse({ ...intent(), dependsOn: [id(8), id(8)] }).success,
    false,
  );
});

test('JSON canónico es idéntico con orden distinto y Unicode equivalente', () => {
  const { payloadHash, ...v } = intent();
  const reverse = Object.fromEntries(Object.entries(v).reverse());
  assert.equal(digest(v), digest(reverse));
  assert.equal(digest(v), digest({ ...v, payload: { ...v.payload, reason: 'Reposicio\u0301n' } }));
  assert.notEqual(digest(v), digest({ ...v, payload: { ...v.payload, deltaFisico: 4 } }));
  assert.throws(() => c.canonicalIntentJson({ ...v, payload: { ...v.payload, deltaFisico: NaN } }));
  assert.throws(() => c.canonicalIntentJson({ ...v, state: 'PENDING' }));
  assert.throws(() => c.canonicalIntentJson({ ...v, createdAt: undefined }));
});

test('recibo terminal tipado conserva identidad y versión confirmada', () => {
  const v = intent();
  const receipt = {
    tenantId: v.tenantId,
    actorId: v.actorId,
    deviceId: v.deviceId,
    operationId: v.operationId,
    payloadHash: v.payloadHash,
    status: 'APPLIED',
    entityId: v.entityId,
    confirmedVersion: 2,
    result: { physical: 13 },
    committedAt: v.createdAt,
    correlationId: id(9),
  };
  assert.equal(c.OperationReceiptSchema.parse(receipt).confirmedVersion, 2);
  assert.equal(
    c.OperationReceiptSchema.safeParse({ ...receipt, status: 'PENDING' }).success,
    false,
  );
});

test('claves Unicode normalizadas se ordenan igual y colisiones no se firman', () => {
  assert.equal(c.canonicalJson({ 'e\u0301': 1, f: 2 }), c.canonicalJson({ é: 1, f: 2 }));
  assert.throws(() => c.canonicalJson({ 'e\u0301': 1, é: 2 }));
});

test('planes exactos y prestaciones por nivel, sin cobros reales', () => {
  assert.equal(c.PLAN_CATALOG.esencial.priceMinor, 14900);
  assert.equal(c.PLAN_CATALOG.pro.priceMinor, 29900);
  assert.equal(c.PLAN_CATALOG.negocio.priceMinor, 59900);
  assert.deepEqual(
    Object.values(c.PLAN_CATALOG).map((p) => p.limits.locations),
    [1, 5, 20],
  );
  assert.deepEqual(
    Object.values(c.PLAN_CATALOG).map((p) => p.limits.staff),
    [3, 15, 100],
  );
  assert.deepEqual(
    Object.values(c.PLAN_CATALOG).map((p) => p.limits.products),
    [200, 2000, 10000],
  );
  assert.deepEqual(
    Object.values(c.PLAN_CATALOG).map((p) => p.limits.avatarsPerPeriod),
    [30, 150, 500],
  );
  assert.deepEqual(
    Object.values(c.PLAN_CATALOG).map((p) => p.limits.savedReports),
    [3, 15, 50],
  );
  assert.deepEqual(
    Object.values(c.PLAN_CATALOG).map((p) => p.limits.aiPerPeriod),
    [0, 100, 500],
  );
  assert.equal(c.PLAN_CATALOG.esencial.features.demand, false);
  assert.equal(c.PLAN_CATALOG.pro.features.anomalies, false);
  assert.equal(c.PLAN_CATALOG.negocio.features.anomalies, true);
});

test('DSL limita métricas/dimensiones/filtros y rechaza SQL, campos y granos incompatibles', () => {
  const spec = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../docs/saas/iconix/especificacion.json'),
      'utf8',
    ),
  );
  const { status, coverage_example, export_label, note, ...definition } =
    spec.report_definition_example;
  assert.equal(c.ReportDefinitionSchema.parse(definition).timezone, 'America/La_Paz');
  assert.equal(
    c.ReportDefinitionSchema.safeParse({ ...definition, sql: 'SELECT * FROM usuario' }).success,
    false,
  );
  assert.equal(
    c.ReportDefinitionSchema.safeParse({
      ...definition,
      dimensions: ['dia', 'mes', 'canal', 'producto', 'marca', 'talla'],
    }).success,
    false,
  );
  assert.equal(
    c.ReportDefinitionSchema.safeParse({
      ...definition,
      filters: Array(21).fill(definition.filters[0]),
    }).success,
    false,
  );
  assert.equal(
    c.ReportDefinitionSchema.safeParse({
      ...definition,
      filters: [{ field: 'clave_hash', operator: 'eq', value: 'x' }],
    }).success,
    false,
  );
  assert.equal(
    c.ReportDefinitionSchema.safeParse({ ...definition, metrics: ['disponible_al_corte'] }).success,
    false,
  );
  assert.equal(
    c.ReportDefinitionSchema.safeParse({
      ...definition,
      period: { from: '2026-09-31', to: '2026-09-30', inclusive: true },
    }).success,
    false,
  );
});

test('worker job v1 acepta IDs demo y rechaza acciones/horizontes/rutas libres', () => {
  const job = {
    schemaVersion: '1.0',
    jobId: 'demo-job-001',
    tenantId: id(1),
    actorId: id(2),
    source: 'DEMOSTRACION_SINTETICA',
    action: 'FORECAST',
    horizonDays: 7,
    workDir: '.local/analytics/tenant-001/job-001',
    parameters: {},
  };
  assert.equal(c.AnalyticsJobSchema.parse(job).horizonDays, 7);
  assert.equal(c.AnalyticsJobSchema.safeParse({ ...job, action: 'EXEC_SQL' }).success, false);
  assert.equal(c.AnalyticsJobSchema.safeParse({ ...job, horizonDays: 90 }).success, false);
  assert.equal(c.AnalyticsJobSchema.safeParse({ ...job, workDir: '../private' }).success, false);
  assert.equal(
    c.AnalyticsJobSchema.safeParse({ ...job, workDir: '.local/x/../../outside' }).success,
    false,
  );
  assert.equal(
    c.AnalyticsJobSchema.safeParse({ ...job, action: 'TRAIN_DEMAND', source: 'REAL' }).success,
    false,
  );
  assert.equal(c.AnalyticsJobSchema.safeParse({ ...job, datasetId: 'otra-tienda' }).success, false);
});

test('sobre cifrado declara scope y algoritmo, sin aceptar bytes mal formados', () => {
  const v = {
    schemaVersion: '1.0',
    algorithm: 'A256GCM',
    keyVersion: 1,
    nonce: Buffer.alloc(12, 1).toString('base64'),
    tag: Buffer.alloc(16, 2).toString('base64'),
    ciphertext: Buffer.from('ciphertext').toString('base64'),
    aad: 'tenant:actor:device:key',
  };
  assert.equal(c.VaultEnvelopeSchema.parse(v).algorithm, 'A256GCM');
  assert.equal(c.VaultEnvelopeSchema.safeParse({ ...v, nonce: 'bad' }).success, false);
  assert.equal(c.VaultEnvelopeSchema.safeParse({ ...v, algorithm: 'NONE' }).success, false);
});

test('fixtures públicas son válidas y el hash canónico publicado es reproducible', () => {
  const fixtureDir = path.join(__dirname, '../fixtures');
  const op = c.OfflineIntentSchema.parse(
    JSON.parse(fs.readFileSync(path.join(fixtureDir, 'offline-intent-v1.json'), 'utf8')),
  );
  const { payloadHash, ...unsigned } = op;
  assert.equal(digest(unsigned), payloadHash);
  c.AnalyticsJobSchema.parse(
    JSON.parse(fs.readFileSync(path.join(fixtureDir, 'analytics-job-v1.json'), 'utf8')),
  );
  const golden = JSON.parse(
    fs.readFileSync(path.join(fixtureDir, 'report-golden-v1.json'), 'utf8'),
  );
  c.ReportDefinitionSchema.parse(golden.definition);
  c.ReportDatasetSchema.parse(golden.dataset);
  assert.equal(golden.expected.salesMinor, 22000);
});

test('equipo y ubicaciones exigen versiones y motivos sin perder compatibilidad de clientes anteriores', () => {
  const id = 'AAAAC3F0-1234-4567-8123-000000000001';
  assert.equal(c.StaffUpdateSchema.safeParse({ nombres: 'Ana' }).success, false);
  assert.equal(
    c.StaffUpdateSchema.safeParse({ expectedVersion: 1, estado: 'SUSPENDIDO' }).success,
    false,
  );
  assert.equal(c.StaffUpdateSchema.safeParse({ expectedVersion: 1 }).success, false);
  assert.equal(
    c.StaffUpdateSchema.parse({ expectedVersion: 1, ubicaciones: [id] }).ubicaciones[0],
    id.toLowerCase(),
  );
  assert.equal(
    c.LocationUpdateSchema.safeParse({ expectedVersion: 1, activa: false }).success,
    false,
  );
  assert.equal(c.LocationUpdateSchema.safeParse({ activa: false }).success, true);
  assert.equal(
    c.LocationUpdateSchema.parse({ expectedVersion: 1, direccion: null }).direccion,
    null,
  );
});
