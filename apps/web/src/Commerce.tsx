import { useEffect, useState } from 'react';
import { ArrowRight, ShoppingBag } from 'lucide-react';
import { api } from './api';
import { useOperationIdentity } from './useOperationIdentity';

type Cart = {
  item_carrito: {
    variante_id: string;
    cantidad: number;
    variante: { sku: string; talla: string; color: string; producto: { nombre: string } };
  }[];
};
type Order = {
  id: string;
  numero: string;
  estado: string;
  total: string;
  creado_en: string;
  detalle_pedido: {
    id: string;
    descripcion_snapshot: string;
    talla_snapshot: string;
    cantidad: number;
    returnEligible: number;
  }[];
  pago: { estado: string; proveedor: string }[];
  devolucion: { id: string; estado: string }[];
};
type Location = { id: string; nombre: string; tipo: string };
const money = (value: number) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(value);

export function Commerce({
  locations,
  onInventoryChanged,
}: {
  locations: Location[];
  onInventoryChanged: () => Promise<void>;
}) {
  const checkoutIdentity = useOperationIdentity();
  const [returnOrder, setReturnOrder] = useState<Order | null>(null);
  const [cart, setCart] = useState<Cart | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [locationId, setLocationId] = useState('');
  const [address, setAddress] = useState('');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [available, setAvailable] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    const [nextCart, nextOrders] = await Promise.all([
      api('/commerce/cart'),
      api('/commerce/orders'),
    ]);
    setCart(nextCart);
    setOrders(nextOrders);
  }
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!locationId) return;
    void api(`/catalog?location=${locationId}`)
      .then((data) => {
        const nextPrices: Record<string, number> = {};
        const nextAvailable: Record<string, number> = {};
        for (const product of data.products)
          for (const variant of product.variantes) {
            nextPrices[variant.id] = variant.precio;
            nextAvailable[variant.id] = variant.disponible;
          }
        setPrices(nextPrices);
        setAvailable(nextAvailable);
      })
      .catch((e) => setError(e.message));
  }, [locationId]);

  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      await reload();
      await onInventoryChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pending = orders.filter((order) => order.estado === 'PENDIENTE_PAGO');
  return (
    <section className="commerce-page">
      <div className="section-title">
        <span className="eyebrow">TU COMPRA</span>
        <h1>Carrito y pedidos.</h1>
        <p>
          Elige una sucursal o almacén con existencias. El stock se reserva durante 15 minutos al
          confirmar.
        </p>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="message" role="status">
          {message}
        </div>
      )}
      <div className="commerce-grid">
        <div className="commerce-panel">
          <h2>
            <ShoppingBag size={20} /> Mi carrito
          </h2>
          {!cart?.item_carrito.length ? (
            <p>Aún no agregaste prendas. Ve a la colección para elegirlas.</p>
          ) : (
            <>
              <label>
                Sucursal o almacén
                <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Selecciona una ubicación</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'} {location.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <div className="commerce-lines">
                {cart.item_carrito.map((item) => (
                  <div className="commerce-line" key={item.variante_id}>
                    <div>
                      <b>{item.variante.producto.nombre}</b>
                      <small>
                        {item.variante.sku} · {item.variante.talla} · {item.variante.color}
                      </small>
                      <small>
                        {locationId
                          ? `${available[item.variante_id] ?? 0} disponibles aquí`
                          : 'Elige una ubicación para consultar stock'}
                      </small>
                    </div>
                    <input
                      aria-label={`Cantidad de ${item.variante.producto.nombre}`}
                      type="number"
                      min="0"
                      max="100"
                      value={item.cantidad}
                      disabled={busy}
                      onChange={(e) => {
                        const quantity = Number(e.target.value);
                        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100) return;
                        void run(async () => {
                          await api('/commerce/cart/items', {
                            method: 'POST',
                            body: JSON.stringify({ variantId: item.variante_id, quantity }),
                          });
                        });
                      }}
                    />
                    <strong>
                      {locationId && prices[item.variante_id] != null
                        ? money(prices[item.variante_id] * item.cantidad)
                        : '—'}
                    </strong>
                  </div>
                ))}
              </div>
              {locationId && (
                <p className="commerce-total">
                  Total estimado{' '}
                  <b>
                    {money(
                      cart.item_carrito.reduce(
                        (sum, item) => sum + (prices[item.variante_id] ?? 0) * item.cantidad,
                        0,
                      ),
                    )}
                  </b>
                </p>
              )}
              <label>
                Dirección de entrega o retiro
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  minLength={10}
                  maxLength={400}
                  placeholder="Ciudad, zona, calle y número; o retiro en la sucursal seleccionada"
                />
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  !locationId ||
                  address.trim().length < 10 ||
                  cart.item_carrito.some(
                    (item) =>
                      !available[item.variante_id] || available[item.variante_id] < item.cantidad,
                  )
                }
                onClick={() =>
                  void run(async () => {
                    const payload = { locationId, address };
                    const order = await api('/commerce/checkout', {
                      method: 'POST',
                      body: JSON.stringify({
                        ...payload,
                        idempotency: checkoutIdentity.forPayload(payload),
                      }),
                    });
                    checkoutIdentity.complete(payload);
                    setMessage(
                      `Pedido ${order.numero} creado. Completa el pago de prueba antes de que venza la reserva.`,
                    );
                  })
                }
              >
                Confirmar pedido <ArrowRight size={17} />
              </button>
              <small>Pago de demostración. No se cobra dinero real.</small>
            </>
          )}
        </div>
        <div className="commerce-panel">
          <h2>Mis pedidos</h2>
          {!orders.length && <p>Todavía no tienes pedidos.</p>}
          {orders.map((order) => (
            <article className="commerce-order" key={order.id}>
              <div>
                <b>{order.numero}</b>
                <span className="status">{order.estado.replaceAll('_', ' ')}</span>
              </div>
              <small>
                {new Date(order.creado_en).toLocaleString('es-BO')} · {money(Number(order.total))}
              </small>
              <ul>
                {order.detalle_pedido.map((line) => (
                  <li key={line.id}>
                    {line.cantidad} × {line.descripcion_snapshot} · {line.talla_snapshot}
                  </li>
                ))}
              </ul>
              {order.estado === 'PENDIENTE_PAGO' && (
                <div className="commerce-actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/commerce/orders/${order.id}/payment`, {
                          method: 'POST',
                          body: JSON.stringify({
                            decision: 'APROBAR',
                            idempotency: crypto.randomUUID(),
                          }),
                        });
                        setMessage('Pago de prueba aprobado. Tu pedido está confirmado.');
                      })
                    }
                  >
                    Aprobar pago de prueba
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/commerce/orders/${order.id}/payment`, {
                          method: 'POST',
                          body: JSON.stringify({
                            decision: 'RECHAZAR',
                            idempotency: crypto.randomUUID(),
                          }),
                        });
                        setMessage('Pago rechazado; la reserva se liberó.');
                      })
                    }
                  >
                    Simular rechazo
                  </button>
                </div>
              )}
              {['CONFIRMADO', 'PREPARANDO', 'DESPACHADO', 'ENTREGADO', 'CERRADO'].includes(
                order.estado,
              ) &&
                order.detalle_pedido.some((line) => line.returnEligible > 0) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setReturnOrder(order)}
                  >
                    Solicitar devolución
                  </button>
                )}
              {returnOrder?.id === order.id && (
                <form
                  className="return-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const items = order.detalle_pedido
                      .map((line) => ({
                        detailId: line.id,
                        quantity: Number(form.get(line.id) || 0),
                      }))
                      .filter((item) => item.quantity > 0);
                    if (!items.length) {
                      setError('Selecciona al menos una unidad para devolver.');
                      return;
                    }
                    void run(async () => {
                      const payload = { orderId: order.id, reason: form.get('reason'), items };
                      await api(`/commerce/orders/${order.id}/returns`, {
                        method: 'POST',
                        body: JSON.stringify({
                          reason: payload.reason,
                          items,
                          idempotency: checkoutIdentity.forPayload(payload),
                        }),
                      });
                      checkoutIdentity.complete(payload);
                      setReturnOrder(null);
                      setMessage('Solicitud registrada para revisión.');
                    });
                  }}
                >
                  <h3>Prendas a devolver</h3>
                  {order.detalle_pedido
                    .filter((line) => line.returnEligible > 0)
                    .map((line) => (
                      <label key={line.id}>
                        {line.descripcion_snapshot} · {line.talla_snapshot} (máximo{' '}
                        {line.returnEligible})
                        <input
                          aria-label={`Cantidad a devolver: ${line.descripcion_snapshot}`}
                          name={line.id}
                          type="number"
                          min="0"
                          max={line.returnEligible}
                          defaultValue="0"
                          disabled={busy}
                        />
                      </label>
                    ))}
                  <label>
                    Motivo
                    <textarea
                      name="reason"
                      minLength={10}
                      maxLength={500}
                      required
                      disabled={busy}
                    />
                  </label>
                  <div className="commerce-actions">
                    <button disabled={busy}>Enviar solicitud</button>
                    <button type="button" disabled={busy} onClick={() => setReturnOrder(null)}>
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
              {order.devolucion.map((row) => (
                <small key={row.id}>Devolución: {row.estado.toLowerCase()}</small>
              ))}
            </article>
          ))}
          {pending.length > 0 && (
            <small>
              Los pedidos pendientes se cancelan al vencer su reserva. Actualiza esta vista para ver
              el estado.
            </small>
          )}
        </div>
      </div>
    </section>
  );
}
