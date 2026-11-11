import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PointOfSaleWorkflow, salePayload } from '../src/modules/pointOfSale/workflow';
import { ApiProblem } from '../src/errors/ApiProblem';

function fixture() {
  let saved: any = null,
    calls = 0,
    loseReply = true,
    locked = false,
    failConfirmationSave = false;
  const receipts = new Map<string, any>();
  const payload = {
    locationId: randomUUID(),
    paymentMethod: 'QR' as const,
    items: [{ variantId: randomUUID(), quantity: 1 }],
  };
  const io = {
    guard: () => {
      if (locked) throw new Error('Sesión bloqueada');
    },
    uuid: randomUUID,
    read: async () => structuredClone(saved),
    save: async (value: any) => {
      if (failConfirmationSave && value.phase === 'CONFIRMED') {
        failConfirmationSave = false;
        throw new Error('Disco no disponible');
      }
      saved = structuredClone(value);
    },
    clear: async () => {
      saved = null;
    },
    send: async (body: any) => {
      calls++;
      let sale = receipts.get(body.idempotency);
      if (!sale) {
        sale = {
          id: randomUUID(),
          numero: 'VTA-QA',
          total: 50,
          estado: 'CONFIRMADO',
          canal: 'TIENDA',
          ubicacion_id: body.locationId,
          idempotencia: body.idempotency,
        };
        receipts.set(body.idempotency, sale);
      }
      if (loseReply) {
        loseReply = false;
        throw ApiProblem.network();
      }
      return sale;
    },
  };
  return {
    io,
    payload,
    receipts,
    getSaved: () => saved,
    calls: () => calls,
    online: () => {
      loseReply = false;
    },
    lock: () => {
      locked = true;
    },
    failSave: () => {
      failConfirmationSave = true;
    },
  };
}

test('POS solo permite efectivo y QR, y actualiza el mismo comprobante después del pago', async () => {
  const f = fixture();
  f.online();
  assert.throws(() => salePayload({ ...f.payload, paymentMethod: 'TARJETA' as any }));
  const send = f.io.send;
  f.io.send = async (body) => ({ ...(await send(body)), estado: 'PENDIENTE_PAGO' });
  const workflow = new PointOfSaleWorkflow(f.io),
    receipt = await workflow.submit(f.payload);
  assert.equal(receipt.estado, 'PENDIENTE_PAGO');
  await assert.rejects(workflow.updateReceipt({ ...receipt, id: randomUUID() }));
  await workflow.updateReceipt({ ...receipt, estado: 'CONFIRMADO' });
  assert.equal(f.getSaved().receipt.estado, 'CONFIRMADO');
});
test('reiniciar tras perder una respuesta reenvía la misma venta y conserva un único comprobante', async () => {
  const f = fixture();
  const first = new PointOfSaleWorkflow(f.io);
  await assert.rejects(first.submit(f.payload));
  assert.equal(f.getSaved().phase, 'PENDING');
  const id = f.getSaved().id;
  const reopened = new PointOfSaleWorkflow(f.io),
    sale = await reopened.submit(f.payload);
  assert.equal(sale.idempotencia, id);
  assert.equal(f.receipts.size, 1);
  assert.equal(f.getSaved().phase, 'CONFIRMED');
  assert.deepEqual(await reopened.submit(f.payload), sale);
  assert.equal(f.calls(), 2);
});
test('no cambia una venta incierta ni crea otra al fallar el guardado del comprobante', async () => {
  const f = fixture();
  f.online();
  f.failSave();
  const flow = new PointOfSaleWorkflow(f.io);
  await assert.rejects(flow.submit(f.payload));
  await assert.rejects(flow.submit({ ...f.payload, paymentMethod: 'EFECTIVO' }), /pendiente/);
  await assert.rejects(flow.startNew(), /pendiente/);
  assert.equal(f.receipts.size, 1);
  await flow.submit(f.payload);
  assert.equal(f.receipts.size, 1);
  await flow.startNew();
  assert.equal(await flow.current(), null);
});
test('validación definitiva permite corregir y logout impide enviar o abrir el recibo de otro ámbito', async () => {
  const f = fixture();
  f.online();
  const io = {
    ...f.io,
    send: async () => {
      throw ApiProblem.fromHttp(400, { message: 'No hay stock' });
    },
  };
  const flow = new PointOfSaleWorkflow(io);
  await assert.rejects(flow.submit(f.payload), /stock/);
  assert.equal(f.getSaved().phase, 'REJECTED');
  await flow.startNew();
  assert.equal(await flow.current(), null);
  f.lock();
  await assert.rejects(flow.submit(f.payload));
  await assert.rejects(flow.current());
  assert.equal(f.calls(), 0);
});
test('dos pulsaciones simultáneas reutilizan el mismo envío y un borrador inválido no llega al servidor', async () => {
  const f = fixture();
  f.online();
  const flow = new PointOfSaleWorkflow(f.io);
  const [one, two] = await Promise.all([flow.submit(f.payload), flow.submit(f.payload)]);
  assert.equal(one.id, two.id);
  assert.equal(f.calls(), 1);
  await flow.startNew();
  await assert.rejects(
    flow.submit({
      ...f.payload,
      items: [{ variantId: f.payload.items[0]!.variantId, quantity: 0 }],
    }),
  );
  assert.equal(f.calls(), 1);
});
