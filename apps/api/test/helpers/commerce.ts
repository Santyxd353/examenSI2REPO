import request from 'supertest';
import { randomUUID } from 'crypto';
import { billingFixture } from './billing';
import { Db } from '../../src/db';
import { AuthService, AuthRequest } from '../../src/auth';
import { runForTenant } from '../../src/tenancy/context';

export async function commerceFixture() {
  const f = await billingFixture(),
    db = f.app.get(Db);
  const inStore = <T>(work: () => T) => runForTenant(f.tenant, work);
  const actor = await inStore(() => f.app.get(AuthService).verify(f.token));
  const req = (channel = 'WEB') =>
    ({ user: actor, headers: { 'x-client-channel': channel } }) as unknown as AuthRequest;
  const http = (method: 'post' | 'patch' | 'get', path: string, body?: object, channel = 'WEB') => {
    const call = request(f.app.getHttpServer())
      [method](`/api${path}`)
      .set('X-Tenant-Slug', f.tenant.slug)
      .set('X-Client-Channel', channel)
      .auth(f.token, { type: 'bearer' });
    return body ? call.send(body) : call;
  };
  async function item(physical = 10) {
    return inStore(async () => {
      const key = randomUUID();
      const category = await db.categoria.create({
        data: { nombre: `Vestidos ${key}`, activa: true },
      });
      const product = await db.producto.create({
        data: {
          categoria_id: category.id,
          nombre: 'Vestido de prueba',
          descripcion: 'Prenda femenina QA',
          material: 'Algodón',
          estado: 'PUBLICADO',
          creado_en: new Date(),
        },
      });
      const variant = await db.variante.create({
        data: { producto_id: product.id, sku: key, talla: 'S', color: 'Rosa', activa: true },
      });
      const location = await db.ubicacion.create({
        data: { nombre: `Tienda ${key}`, tipo: 'TIENDA', activa: true },
      });
      const inventory = await db.inventario.create({
        data: {
          variante_id: variant.id,
          ubicacion_id: location.id,
          fisico: physical,
          reservado: 0,
          comprometido: 0,
          version: 1,
        },
      });
      for (const canal of ['WEB', 'APP', 'TIENDA']) {
        await db.precio_canal.create({
          data: {
            variante_id: variant.id,
            canal,
            moneda: 'BOB',
            importe: 50,
            descuento_pct: 0,
            desde: new Date(),
          },
        });
        await db.disponibilidad_canal.create({
          data: {
            variante_id: variant.id,
            ubicacion_id: location.id,
            canal,
            habilitada: true,
            stock_seguridad: 0,
            plazo_reposicion_dias: 1,
          },
        });
      }
      return {
        variantId: variant.id,
        locationId: location.id,
        inventoryId: inventory.id,
        productId: product.id,
      };
    });
  }
  async function paidOrder(quantity = 3, channel = 'WEB') {
    const product = await item();
    expect(
      (
        await http(
          'post',
          '/commerce/cart/items',
          { variantId: product.variantId, quantity },
          channel,
        )
      ).status,
    ).toBe(201);
    const ordered = await http(
      'post',
      '/commerce/checkout',
      {
        locationId: product.locationId,
        address: 'Calle de prueba 123, La Paz',
        idempotency: randomUUID(),
      },
      channel,
    );
    expect(ordered.status).toBe(201);
    const paid = await http(
      'post',
      `/commerce/orders/${ordered.body.id}/payment`,
      { decision: 'APROBAR', idempotency: randomUUID() },
      channel,
    );
    expect(paid.status).toBe(201);
    return { ...product, order: paid.body, detail: paid.body.detalle_pedido[0] };
  }
  return { ...f, db, inStore, actor, req, http, item, paidOrder };
}
