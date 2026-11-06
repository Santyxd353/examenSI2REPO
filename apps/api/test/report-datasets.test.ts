import 'dotenv/config';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { ReportDatasetSchema, type ReportDataset } from '@lumina/contracts';
import { boliviaDate, executeReport } from '@lumina/reporting';
import { AuthService } from '../src/auth';
import { requestHash } from '../src/commerce/idempotency';
import { commerceFixture } from './helpers/commerce';

let f: Awaited<ReturnType<typeof commerceFixture>>;
let order: Awaited<ReturnType<typeof commerceFixture>>['paidOrder'] extends (
  ...args: any
) => Promise<infer T>
  ? T
  : never;
let otherLocation: string;
const day = boliviaDate(new Date().toISOString());
const route = '/reports/datasets';
const capture = (locationIds?: string[]) => ({
  source: 'REAL',
  period: { from: day, to: day },
  locationIds,
});

beforeAll(async () => {
  f = await commerceFixture();
  order = await f.paidOrder();
  otherLocation = (await f.paidOrder(2)).locationId;
  await f.inStore(async () => {
    const paid = await f.db.pago.findFirstOrThrow({ where: { pedido_id: order.order.id } });
    await f.db.pago.update({
      where: { id: paid.id },
      data: { proveedor: 'POS_EFECTIVO', monto: 50, estado: 'REEMBOLSADO' },
    });
    const second = await f.db.pago.create({
      data: {
        pedido_id: order.order.id,
        proveedor: 'POS_TARJETA',
        idempotencia: randomUUID(),
        monto: 100,
        moneda: 'BOB',
        estado: 'CONFIRMADO',
        creado_en: new Date(),
        confirmado_en: new Date(),
      },
    });
    for (const paymentId of [paid.id, second.id]) {
      const now = new Date();
      const returned = await f.db.devolucion.create({
        data: {
          pedido_id: order.order.id,
          usuario_id: f.actorId,
          tipo: 'DEVOLUCION',
          estado: 'RESUELTA',
          motivo: 'Prueba',
          solicitada_en: now,
          resuelta_en: now,
          detalle_devolucion: {
            create: {
              detalle_pedido_id: order.detail.id,
              cantidad: 1,
              cantidad_apta: 1,
              ubicacion_id: order.locationId,
              reintegrada_en: now,
            },
          },
        },
      });
      await f.db.reembolso.create({
        data: {
          pago_id: paymentId,
          devolucion_id: returned.id,
          idempotencia: randomUUID(),
          monto: 50,
          estado: 'CONFIRMADO',
          motivo: 'Prueba',
          creado_en: now,
          confirmado_en: now,
        },
      });
    }
  });
});
afterAll(async () => {
  await f?.close();
});

async function download(manifest: Record<string, any>): Promise<ReportDataset> {
  const { expiresAt: _, ...metadata } = manifest;
  const arrays: Record<string, unknown[]> = {
    sales: [],
    orders: [],
    payments: [],
    returns: [],
    refunds: [],
    stock: [],
  };
  let offset: number | null = 0;
  do {
    const response = await f.http(
      'get',
      `${route}/${manifest.datasetId}/rows?offset=${offset}&pageSize=2`,
    );
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.body).toMatchObject({
      offset,
      datasetId: manifest.datasetId,
      sha256: manifest.sha256,
      asOf: manifest.asOf,
    });
    for (const row of response.body.rows) arrays[row.kind].push(row.fact);
    offset = response.body.nextOffset;
  } while (offset !== null);
  const data = ReportDatasetSchema.parse({ ...metadata, ...arrays });
  const { sha256, ...payload } = data;
  expect(sha256).toBe(requestHash(payload));
  return data;
}

test('pagos y devoluciones múltiples no duplican ventas; el corte conserva datos y hash', async () => {
  const response = await f.http('post', route, capture([order.locationId]));
  expect(response.status).toBe(201);
  expect(response.body).toMatchObject({
    tenantId: f.tenant.id,
    ownerId: f.actorId,
    complete: true,
  });
  expect((await f.http('get', route + '/' + response.body.datasetId)).body).toEqual(response.body);
  await f.inStore(() =>
    f.db.inventario.update({ where: { id: order.inventoryId }, data: { fisico: 99 } }),
  );
  const data = await download(response.body);
  expect(data.sales).toHaveLength(1);
  expect(data.payments).toHaveLength(2);
  expect(data.returns).toHaveLength(2);
  expect(data.refunds).toHaveLength(2);
  expect(data.stock[0].physical).not.toBe(99);
  const definition = {
    schemaVersion: '1.0',
    datasetId: data.datasetId,
    source: 'REAL',
    title: 'Ventas',
    timezone: 'America/La_Paz',
    currency: 'BOB',
    fact: 'ventas_confirmadas',
    period: { from: day, to: day, inclusive: true },
    metrics: [
      'ventas_confirmadas_bob',
      'unidades_vendidas',
      'pedidos_distintos',
      'unidades_devueltas',
      'reembolsos_confirmados_bob',
    ],
    dimensions: ['metodo_pago'],
    filters: [{ field: 'metodo_pago', operator: 'eq', value: 'TARJETA' }],
    order: [],
    limit: 20,
    chart: 'table',
    dashboard: { widgets: [], crossFilter: true, detailAvailableColumns: [] },
  } as const;
  const execution = await f.http('post', '/reports/execute', { definition });
  expect(execution.status).toBe(200);
  expect(execution.body).toEqual(
    executeReport(definition as unknown as Parameters<typeof executeReport>[0], data),
  );
  expect(Object.values(execution.body.kpis).map((kpi: any) => kpi.value)).toEqual([
    15000, 3, 1, 2, 10000,
  ]);
  const csv = await f.http('post', '/reports/export', { definition });
  expect(csv.status).toBe(200);
  expect(csv.headers['content-type']).toContain('text/csv');
  expect(csv.text).toContain('150.00');
});

test('ámbito actual en cada página y separación de propietarios y fuentes', async () => {
  const auth = f.app.get(AuthService);
  const analyst = await f.inStore(async () => {
    const user = await auth.mobileRegister({
      nombres: 'Analista',
      apellidos: 'QA',
      correo: randomUUID() + '@qa.test',
      clave: 'AnalistaQA2026!',
    });
    const role = await f.db.rol.findUniqueOrThrow({ where: { nombre: 'Analista' } });
    await f.db.usuario_rol.create({
      data: { usuario_id: user.user.id, rol_id: role.id, asignado_en: new Date() },
    });
    await f.db.usuario_ubicacion.create({
      data: { usuario_id: user.user.id, ubicacion_id: order.locationId },
    });
    return user;
  });
  const asAnalyst = (method: 'post' | 'get', path: string) =>
    request(f.app.getHttpServer())
      [method]('/api' + path)
      .set('X-Tenant-Slug', f.tenant.slug)
      .auth(analyst.accessToken, { type: 'bearer' });
  expect((await asAnalyst('post', route).send(capture([otherLocation]))).status).toBe(403);
  const privateCopy = await asAnalyst('post', route).send(capture());
  expect(privateCopy.status).toBe(201);
  expect(privateCopy.body.downloadedLocationIds).toEqual([order.locationId]);
  const path = route + '/' + privateCopy.body.datasetId;
  expect((await f.http('get', path)).status).toBe(404);
  const rows = await asAnalyst('get', path + '/rows');
  expect(rows.status).toBe(200);
  expect(JSON.stringify(rows.body)).not.toMatch(/direccion|correo|usuario_id|Calle de prueba/);
  await f.inStore(() =>
    f.db.usuario_ubicacion.deleteMany({ where: { usuario_id: analyst.user.id } }),
  );
  expect((await asAnalyst('get', path + '/rows')).status).toBe(403);

  const demo = await f.http('post', route, { source: 'DEMOSTRACION_SINTETICA' });
  expect(demo.status).toBe(201);
  const data = await download(demo.body);
  expect(data.source).toBe('DEMOSTRACION_SINTETICA');
  expect(data.sales.some((row) => row.orderId === order.order.id)).toBe(false);
  const foreign = await commerceFixture();
  try {
    expect((await foreign.http('get', route + '/' + demo.body.datasetId)).status).toBe(404);
  } finally {
    await foreign.close();
  }
});

test('la fecha usa el primer cobro y la medianoche comercial de Bolivia', async () => {
  await f.inStore(async () => {
    await f.db.pago.updateMany({
      where: { pedido_id: order.order.id, estado: 'REEMBOLSADO' },
      data: { confirmado_en: new Date('2026-09-09T03:59:59Z') },
    });
    await f.db.pago.updateMany({
      where: { pedido_id: order.order.id, estado: 'CONFIRMADO' },
      data: { confirmado_en: new Date('2026-09-09T04:00:01Z') },
    });
  });
  for (const [date, count] of [
    ['2026-09-08', 1],
    ['2026-09-09', 0],
  ] as const) {
    const manifest = await f.http('post', route, {
      ...capture([order.locationId]),
      period: { from: date, to: date },
    });
    expect(manifest.status).toBe(201);
    const data = await download(manifest.body);
    expect(data.sales).toHaveLength(count);
    expect(data.stock).toHaveLength(0);
  }
});

test('el límite de 50 000 filas mantiene páginas estables y declara la cobertura parcial', async () => {
  const item = await f.item();
  await f.inStore(async () => {
    await f.db.$executeRaw`
      INSERT INTO variante (producto_id,sku,talla,color,activa)
      SELECT ${item.productId}::uuid, 'REPORTE-LIMITE-'||n, 'S', n::text, true
      FROM generate_series(1,50000) n`;
    await f.db.$executeRaw`
      INSERT INTO inventario (variante_id,ubicacion_id,fisico,reservado,comprometido,version)
      SELECT id,${item.locationId}::uuid,1,0,0,1 FROM variante
      WHERE producto_id=${item.productId}::uuid AND sku LIKE 'REPORTE-LIMITE-%'`;
  });
  const created = await f.http('post', route, capture([item.locationId]));
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ rowCount: 50000, rowLimit: 50000, complete: false });
  expect(created.body.omittedCoverage.join(' ')).toContain('inventario');
  const page = await f.http(
    'get',
    route + '/' + created.body.datasetId + '/rows?offset=49999&pageSize=20',
  );
  expect(page.status).toBe(200);
  expect(page.body).toMatchObject({ offset: 49999, nextOffset: null, sha256: created.body.sha256 });
  expect(page.body.rows).toHaveLength(1);
}, 45000);
