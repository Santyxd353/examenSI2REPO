import { useEffect, useState } from 'react';
import { ArrowRight, QrCode, ShieldCheck, ShoppingBag, X } from 'lucide-react';
import { QrPaymentPanel } from './QrPayment';
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
const locationLabel = (location: Location) => {
  const kind = location.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén';
  return location.nombre.toLocaleLowerCase('es-BO').startsWith(kind.toLocaleLowerCase('es-BO'))
    ? location.nombre
    : `${kind} ${location.nombre}`;
};

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
  const [paymentOrder, setPaymentOrder] = useState<Order | null>(null);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [paymentChoice, setPaymentChoice] = useState<'STRIPE' | 'QR'>('QR');

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
    void api('/commerce/payment-options')
      .then((options) => setStripeEnabled(Boolean(options.stripeTest)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('stripe_return') === 'app') {
      setMessage(
        'Vuelve a Lúmina en Android y pulsa «Comprobar pago de Stripe». Tu pedido y sesión de prueba están guardados.',
      );
      return;
    }
    const sessionId = new URLSearchParams(window.location.search).get('stripe_session_id');
    if (!sessionId) return;
    let active = true;
    setBusy(true);
    void api(`/commerce/stripe-test-checkout?session_id=${encodeURIComponent(sessionId)}`)
      .then(async (result) => {
        if (!active) return;
        await reload();
        setMessage(
          result.pagado && result.estado === 'CONFIRMADO'
            ? 'Stripe confirmó el pago de prueba. Tu pedido está confirmado.'
            : `El pedido está ${result.estado.replaceAll('_', ' ').toLowerCase()}.`,
        );
        void onInventoryChanged().catch(() => {});
        const url = new URL(window.location.href);
        url.searchParams.delete('stripe_session_id');
        window.history.replaceState({}, '', url);
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setBusy(false));
    return () => {
      active = false;
    };
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
      // El pedido y el carrito ya están actualizados. El catálogo puede recalcularse en segundo
      // plano sin dejar al cliente esperando por todas las ubicaciones y variantes.
      void onInventoryChanged().catch(() => {
        setError('El pedido se registró, pero no se pudo actualizar el stock mostrado todavía.');
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!paymentOrder || paymentChoice !== 'QR') return;
    let active = true;
    const refreshPayment = async () => {
      try {
        const nextOrders = (await api('/commerce/orders')) as Order[];
        if (!active) return;
        setOrders(nextOrders);
        const paid = nextOrders.find((order) => order.id === paymentOrder.id);
        if (paid && paid.estado !== 'PENDIENTE_PAGO') {
          setPaymentOrder(null);
          setMessage(
            paid.estado === 'CONFIRMADO'
              ? 'QR escaneado. Pago de demostración confirmado.'
              : `El pedido cambió a ${paid.estado.replaceAll('_', ' ')}.`,
          );
          void onInventoryChanged().catch(() => {});
        }
      } catch {
        /* La conexión puede recuperarse en el siguiente intento. */
      }
    };
    const interval = window.setInterval(() => void refreshPayment(), 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [paymentChoice, paymentOrder]);

  const pending = orders.filter((order) => order.estado === 'PENDIENTE_PAGO');
  const insufficientItem = locationId
    ? cart?.item_carrito.find((item) => (available[item.variante_id] ?? 0) < item.cantidad)
    : undefined;
  const checkoutBlocker = busy
    ? 'Estamos procesando tu pedido.'
    : !locationId
      ? 'Selecciona una sucursal o almacén para continuar.'
      : address.trim().length < 10
        ? 'Escribe la dirección de entrega o retiro (mínimo 10 caracteres).'
        : insufficientItem
          ? `No se puede realizar la compra por falta de stock: solo hay ${available[insufficientItem.variante_id] ?? 0} unidades disponibles de ${insufficientItem.variante.producto.nombre} en esta ubicación.`
          : null;
  async function openStripeTest() {
    if (!paymentOrder) return;
    setBusy(true);
    setError('');
    try {
      const checkout = await api(`/commerce/orders/${paymentOrder.id}/stripe-test-checkout`, {
        method: 'POST',
      });
      window.location.assign(checkout.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function openPayment(order: Order) {
    setPaymentOrder(order);
    setPaymentChoice(stripeEnabled || order.pago[0]?.proveedor === 'STRIPE_TEST' ? 'STRIPE' : 'QR');
  }

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
                      {locationLabel(location)}
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
                      {locationId && (available[item.variante_id] ?? 0) < item.cantidad && (
                        <small className="commerce-line-warning" role="alert">
                          No se puede realizar la compra: faltan unidades para la cantidad elegida.
                        </small>
                      )}
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
                disabled={Boolean(checkoutBlocker)}
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
                {busy ? (
                  'Procesando pedido…'
                ) : (
                  <>
                    Confirmar pedido <ArrowRight size={17} />
                  </>
                )}
              </button>
              {checkoutBlocker && (
                <small className="commerce-validation" role={insufficientItem ? 'alert' : 'status'}>
                  {checkoutBlocker}
                </small>
              )}
              <small>Stripe en modo de prueba o QR de demostración. No se cobra dinero real.</small>
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
                  <button disabled={busy} onClick={() => openPayment(order)}>
                    {stripeEnabled ? 'Elegir Stripe o QR' : 'Abrir QR de prueba'}
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
      {paymentOrder && (
        <div className="modal-overlay" onClick={() => !busy && setPaymentOrder(null)}>
          <section
            className="auth-modal payment-demo"
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-demo-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Cerrar pasarela"
              disabled={busy}
              onClick={() => setPaymentOrder(null)}
            >
              <X size={18} />
            </button>
            <span className="payment-demo-badge">
              <ShieldCheck size={15} /> MODO DE PRUEBA · SIN COBRO REAL
            </span>
            <h2 id="payment-demo-title">Finaliza tu compra</h2>
            <p>
              Pedido <b>{paymentOrder.numero}</b> · total <b>{money(Number(paymentOrder.total))}</b>
              . Revisa el resumen y selecciona cómo probar el pago.
            </p>
            <div className="payment-order-summary">
              {paymentOrder.detalle_pedido.map((line) => (
                <span key={line.id}>
                  <span>
                    {line.cantidad} × {line.descripcion_snapshot} · {line.talla_snapshot}
                  </span>
                </span>
              ))}
              <strong>
                <span>Total</span>
                <span>{money(Number(paymentOrder.total))}</span>
              </strong>
            </div>
            {stripeEnabled && (
              <div className="payment-choice" role="group" aria-label="Pasarela de pago">
                <button
                  type="button"
                  className={paymentChoice === 'STRIPE' ? 'active' : ''}
                  onClick={() => setPaymentChoice('STRIPE')}
                >
                  Stripe <small>Checkout de prueba</small>
                </button>
                <button
                  type="button"
                  className={paymentChoice === 'QR' ? 'active' : ''}
                  disabled={paymentOrder.pago[0]?.proveedor === 'STRIPE_TEST'}
                  onClick={() => setPaymentChoice('QR')}
                >
                  QR <small>Escaneo de prueba</small>
                </button>
              </div>
            )}
            {paymentChoice === 'STRIPE' && stripeEnabled ? (
              <div className="payment-stripe-panel">
                <ShieldCheck size={28} aria-hidden="true" />
                <h3>Pago seguro con Stripe</h3>
                <p>
                  Continuarás en Stripe Checkout para ingresar una tarjeta de prueba. El importe y
                  las prendas se enviarán desde este pedido.
                </p>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void openStripeTest()}
                >
                  {busy
                    ? 'Abriendo Stripe…'
                    : `Continuar y pagar ${money(Number(paymentOrder.total))}`}
                  {!busy && <ArrowRight size={17} />}
                </button>
                <small>Solo modo de prueba. No uses una tarjeta bancaria real.</small>
              </div>
            ) : (
              <>
                <QrPaymentPanel
                  endpoint={`/commerce/orders/${paymentOrder.id}/qr-link`}
                  orderNumber={paymentOrder.numero}
                />
                <small className="payment-demo-note">
                  QR de simulación académica. No realiza un cobro bancario.
                </small>
                <span className="payment-awaiting">Esperando escaneo…</span>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
