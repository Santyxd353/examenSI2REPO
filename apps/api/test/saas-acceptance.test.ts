import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { executeReport, boliviaDate } from '@lumina/reporting';
import { commerceFixture } from './helpers/commerce';
import { runSyncBatch } from '../../mobile/src/offline/syncEngine';
import { readReportDataset } from '../../mobile/src/modules/reports/datasetDownload';
import { defaultMobileReport } from '../../mobile/src/modules/reports/reportDefaults';
import type { OfflineIntent } from '../../mobile/src/offline/intentRepository';
import { businessSubscriptionView } from '../../mobile/src/modules/businessSubscription';
import { parseAnalysisJobs } from '../../mobile/src/modules/analysis/analysisResults';

let a: Awaited<ReturnType<typeof commerceFixture>>, b: Awaited<ReturnType<typeof commerceFixture>>;
const digest = async (text: string) => createHash('sha256').update(text).digest('hex');
beforeAll(async () => {
  process.env.OFFLINE_MASTER_KEY = randomBytes(32).toString('base64');
  a = await commerceFixture();
  b = await commerceFixture();
}, 120000);
afterAll(async () => {
  await a?.close();
  await b?.close();
}, 120000);
const day = () => boliviaDate(new Date().toISOString());

test('Esencial mantiene reportes manuales; Profesional permite un análisis durable que lee el adaptador móvil', async () => {
  const input = {
    operationId: randomUUID(),
    action: 'GENERATE_DATASET',
    source: 'DEMOSTRACION_SINTETICA',
  };
  expect((await b.http('post', '/analytics/jobs', input, 'APP')).status).toBe(403);
  await b.registry.pool.query('UPDATE platform.subscription SET plan_code=$1 WHERE tenant_id=$2', [
    'pro',
    b.tenant.id,
  ]);
  const created = await b.http('post', '/analytics/jobs', input, 'APP');
  expect(created.status).toBe(202);
  const list = await b.http('get', '/analytics/jobs', undefined, 'APP');
  expect(list.status).toBe(200);
  expect(parseAnalysisJobs(list.body).find((row) => row.id === input.operationId)?.status).toBe(
    'QUEUED',
  );
  expect((await b.http('post', '/analytics/jobs', input, 'APP')).body.id).toBe(input.operationId);
});

async function downloaded(f: typeof a) {
  const manifest = await f.http(
    'post',
    '/reports/datasets',
    { source: 'REAL', period: { from: day(), to: day(), inclusive: true } },
    'APP',
  );
  expect(manifest.status).toBe(201);
  return readReportDataset(
    { tenantId: f.tenant.id, actorId: f.actorId, deviceId: randomUUID() },
    manifest.body,
    {
      digest,
      guard: () => {},
      get: async (id, offset) => {
        const page = await f.http(
          'get',
          `/reports/datasets/${id}/rows?offset=${offset}&pageSize=500`,
          undefined,
          'APP',
        );
        expect(page.status).toBe(200);
        return page.body;
      },
    },
  );
}

test('WEB, APP y mostrador aparecen una sola vez en el dashboard móvil descargado y solo en su tienda', async () => {
  const plan = await a.http('get', '/tenant/subscription', undefined, 'APP');
  expect(plan.status).toBe(200);
  expect(businessSubscriptionView(plan.body).subscription.planName).toBe('Esencial');
  const item = await a.item(20),
    ids: string[] = [];
  for (const channel of ['WEB', 'APP']) {
    expect(
      (
        await a.http(
          'post',
          '/commerce/cart/items',
          { variantId: item.variantId, quantity: 1 },
          channel,
        )
      ).status,
    ).toBe(201);
    const order = await a.http(
      'post',
      '/commerce/checkout',
      {
        locationId: item.locationId,
        address: 'Calle de integración 123, La Paz',
        idempotency: randomUUID(),
      },
      channel,
    );
    expect(order.status).toBe(201);
    const input = { decision: 'APROBAR', idempotency: randomUUID() };
    const paid = await a.http('post', `/commerce/orders/${order.body.id}/payment`, input, channel);
    expect(paid.status).toBe(201);
    ids.push(paid.body.id);
    expect(
      (await a.http('post', `/commerce/orders/${order.body.id}/payment`, input, channel)).body.id,
    ).toBe(paid.body.id);
  }
  const input = {
    locationId: item.locationId,
    paymentMethod: 'QR',
    idempotency: randomUUID(),
    items: [{ variantId: item.variantId, quantity: 1 }],
  };
  const sale = await a.http('post', '/sales', input);
  expect(sale.status).toBe(201);
  ids.push(sale.body.id);
  expect((await a.http('post', '/sales', input)).body.id).toBe(sale.body.id);
  const orders = await a.http('get', '/admin/orders');
  expect(orders.body.filter((row: { id: string }) => ids.includes(row.id))).toHaveLength(3);
  const data = await downloaded(a),
    definition = defaultMobileReport(data);
  definition.dimensions = ['canal'];
  const local = executeReport(definition, data),
    remote = await a.http('post', '/reports/execute', { definition });
  expect(remote.status).toBe(200);
  expect(remote.body).toEqual(local);
  expect(local.kpis.pedidos_distintos?.value).toBe(3);
  expect(local.kpis.ventas_confirmadas_bob?.value).toBe(15000);
  expect(
    local.groups
      .map((group) => [group.dimensions.canal, group.metrics.pedidos_distintos?.value])
      .sort(),
  ).toEqual([
    ['APP', 1],
    ['TIENDA', 1],
    ['WEB', 1],
  ]);
  expect((await downloaded(b)).sales).toHaveLength(0);
  expect((await b.http('get', `/reports/datasets/${data.datasetId}`)).status).toBe(404);
  expect(await a.inStore(() => a.db.pedido.count({ where: { id: { in: ids } } }))).toBe(3);
}, 120000);

test('el protocolo móvil confirma +3, el web -2 deja 11 y un conteo viejo conserva conflicto sin reemplazar stock', async () => {
  const item = await a.item(10),
    scope = { tenantId: a.tenant.id, actorId: a.actorId, deviceId: randomUUID() };
  expect(
    (await a.http('post', '/offline/bootstrap', { deviceId: scope.deviceId }, 'APP')).status,
  ).toBe(201);
  const draft = (kind: string, payload: unknown): OfflineIntent => ({
    scope,
    operationId: randomUUID(),
    entityId: item.inventoryId,
    createdAt: new Date().toISOString(),
    kind,
    baseVersion: 1,
    dependsOn: [],
    state: 'PENDING',
    payload: JSON.stringify(payload),
  });
  let rows = [
    draft('STOCK_DELTA', {
      variantId: item.variantId,
      locationId: item.locationId,
      deltaFisico: 3,
      reason: 'Recepción móvil offline',
    }),
  ];
  const repository = {
    listIntents: async () => rows,
    reconcile: async (_scope: unknown, next: readonly OfflineIntent[]) => {
      rows = [...next];
    },
  };
  const send = async (body: unknown) => {
    const response = await a.http('post', '/offline/sync', body as object, 'APP');
    expect(response.status).toBe(201);
    return response.body;
  };
  await runSyncBatch(repository, scope, { digest, send, guard: () => () => {} });
  expect(rows[0].state).toBe('APPLIED');
  const web = await a.http('post', `/locations/${item.locationId}/inventory/adjustments`, {
    varianteId: item.variantId,
    delta: -2,
    motivo: 'Ajuste web de integración',
  });
  expect(web.status).toBe(201);
  rows = [
    draft('STOCK_COUNT', {
      variantId: item.variantId,
      locationId: item.locationId,
      observedPhysical: 10,
      reason: 'Conteo descargado antiguo',
    }),
  ];
  await runSyncBatch(repository, scope, { digest, send, guard: () => () => {} });
  expect(rows[0].state).toBe('CONFLICT');
  const stock = await a.inStore(() =>
    a.db.inventario.findUniqueOrThrow({ where: { id: item.inventoryId } }),
  );
  expect(stock.fisico).toBe(11);
}, 120000);
