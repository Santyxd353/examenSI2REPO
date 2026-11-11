import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, ReceiptText, ShoppingBag, Trash2, X } from 'lucide-react';
import { QrPaymentPanel } from './QrPayment';
import { api } from './api';
import { useOperationIdentity } from './useOperationIdentity';

type Variant = {
  id: string;
  product: string;
  sku: string;
  size: string;
  color: string;
  available: number;
  price: number;
};
type Location = {
  id: string;
  nombre: string;
  tipo: 'TIENDA' | 'ALMACEN';
  variants: Variant[];
};
type CartLine = Variant & { quantity: number };
type Sale = {
  id: string;
  estado: string;
  ubicacion_id: string;
  numero: string;
  total: number | string;
  creado_en: string;
  ubicacion: { nombre: string };
  detalle_pedido: { cantidad: number }[];
  pago: { proveedor: string; estado: string }[];
};

const money = (value: number | string) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(Number(value));

export function Sales() {
  const saleIdentity = useOperationIdentity();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');
  const [variantId, setVariantId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [recent, setRecent] = useState<Sale[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [paymentSale, setPaymentSale] = useState<Sale | null>(null);
  const location = locations.find((item) => item.id === locationId);
  const variants = location?.variants ?? [];
  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cart],
  );

  async function reload(preferredLocation?: string) {
    const data: Location[] = await api('/sales/context');
    setLocations(data);
    const nextLocation = preferredLocation || locationId || data[0]?.id || '';
    setLocationId(nextLocation);
    setRecent(await api(`/sales${nextLocation ? `?location=${nextLocation}` : ''}`));
  }

  useEffect(() => {
    void reload().catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!paymentSale) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api(`/sales?location=${paymentSale.ubicacion_id}`)
        .then((sales: Sale[]) => {
          if (!active) return;
          setRecent(sales);
          const sale = sales.find((row) => row.id === paymentSale.id);
          if (sale && sale.estado !== 'PENDIENTE_PAGO') {
            setPaymentSale(null);
            setMessage(
              sale.estado === 'CONFIRMADO'
                ? `Venta ${sale.numero} confirmada por ${money(sale.total)} con QR de prueba.`
                : 'La reserva de la venta venció. Puedes preparar otra venta.',
            );
            void reload(locationId).catch((reason) => setError(reason.message));
          }
        })
        .catch(() => {});
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [paymentSale, locationId]);

  function addLine() {
    const variant = variants.find((item) => item.id === variantId);
    if (!variant) return setError('Selecciona una prenda.');
    const current = cart.find((item) => item.id === variant.id)?.quantity ?? 0;
    if (current + quantity > variant.available)
      return setError(`Solo hay ${variant.available} unidades disponibles.`);
    setCart((lines) => {
      const existing = lines.find((item) => item.id === variant.id);
      return existing
        ? lines.map((item) =>
            item.id === variant.id ? { ...item, quantity: item.quantity + quantity } : item,
          )
        : [...lines, { ...variant, quantity }];
    });
    setVariantId('');
    setQuantity(1);
    setError('');
  }

  async function sell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locationId || !cart.length) return setError('Agrega al menos una prenda a la venta.');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const payload = {
        locationId,
        customerName: String(form.get('customerName') || '').trim() || undefined,
        paymentMethod: form.get('paymentMethod'),
        items: cart.map((item) => ({ variantId: item.id, quantity: item.quantity })),
      };
      const sale = await api('/sales', {
        method: 'POST',
        body: JSON.stringify({ ...payload, idempotency: saleIdentity.forPayload(payload) }),
      });
      saleIdentity.complete(payload);
      setCart([]);
      formElement.reset();
      if (sale.estado === 'PENDIENTE_PAGO') {
        setPaymentSale(sale);
        setMessage(`Venta ${sale.numero} pendiente de pago. Escanea el QR para confirmarla.`);
      } else setMessage(`Venta ${sale.numero} confirmada por ${money(sale.total)}.`);
      await reload(locationId);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sales-page">
      <div className="section-title sales-title">
        <span className="eyebrow">PUNTO DE VENTA</span>
        <h1>
          Registrar una <em>venta.</em>
        </h1>
        <p>
          El efectivo confirma la venta al registrarla. Con QR reservamos las prendas durante 15
          minutos y confirmamos la venta cuando se completa el pago simulado.
        </p>
      </div>
      {error && <div className="message error">{error}</div>}
      {message && (
        <div className="message">
          <CheckCircle2 size={18} /> {message}
        </div>
      )}
      <div className="sales-layout">
        <form className="sale-card" onSubmit={sell}>
          <div className="sale-card-title">
            <ShoppingBag size={22} />
            <div>
              <h2>Nueva venta</h2>
              <p>Elige la ubicación asignada y añade las prendas.</p>
            </div>
          </div>
          <label>
            Sucursal o almacén
            <select
              value={locationId}
              onChange={(event) => {
                setLocationId(event.target.value);
                setCart([]);
                setVariantId('');
                void api(`/sales?location=${event.target.value}`)
                  .then(setRecent)
                  .catch((reason) => setError(reason.message));
              }}
              required
            >
              {!locations.length && <option value="">Sin ubicaciones asignadas</option>}
              {locations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'} · {item.nombre}
                </option>
              ))}
            </select>
          </label>
          <div className="sale-add-row">
            <label>
              Prenda
              <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                <option value="">Selecciona una variante</option>
                {variants.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.product} · {item.size} · {item.color} · {money(item.price)} (
                    {item.available} u.)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Cantidad
              <input
                type="number"
                min="1"
                max="100"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
              />
            </label>
            <button type="button" onClick={addLine} disabled={!variantId}>
              <Plus size={16} /> Añadir
            </button>
          </div>
          <div className="sale-lines">
            {cart.length ? (
              cart.map((line) => (
                <article key={line.id}>
                  <div>
                    <b>{line.product}</b>
                    <span>
                      {line.sku} · {line.size} · {line.color}
                    </span>
                  </div>
                  <span>
                    {line.quantity} × {money(line.price)}
                  </span>
                  <strong>{money(line.quantity * line.price)}</strong>
                  <button
                    type="button"
                    aria-label={`Quitar ${line.product}`}
                    onClick={() => setCart((items) => items.filter((item) => item.id !== line.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))
            ) : (
              <p className="muted">Aún no agregaste prendas.</p>
            )}
          </div>
          <div className="sale-customer">
            <label>
              Cliente (opcional)
              <input name="customerName" placeholder="Nombre para el comprobante" maxLength={160} />
            </label>
            <label>
              Método de pago
              <select name="paymentMethod" defaultValue="EFECTIVO">
                <option value="EFECTIVO">Efectivo</option>
                <option value="QR">QR</option>
              </select>
            </label>
          </div>
          <div className="sale-total">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
          <button className="primary sale-confirm" disabled={busy || !cart.length}>
            {busy ? 'Confirmando…' : 'Confirmar venta'}
          </button>
        </form>

        <aside className="recent-sales">
          <div className="sale-card-title">
            <ReceiptText size={22} />
            <div>
              <h2>Ventas recientes</h2>
              <p>Registradas por ti en la ubicación seleccionada.</p>
            </div>
          </div>
          {recent.length ? (
            recent.map((sale) => (
              <article key={sale.id}>
                <div>
                  <b>{sale.numero}</b>
                  <span>{new Date(sale.creado_en).toLocaleString('es-BO')}</span>
                </div>
                <strong>{money(sale.total)}</strong>
                <small>
                  {sale.detalle_pedido.reduce((sum, line) => sum + line.cantidad, 0)} unidades ·{' '}
                  {sale.pago[0]?.proveedor.replace('POS_', '')}
                </small>
                {sale.estado === 'PENDIENTE_PAGO' && sale.pago[0]?.proveedor === 'POS_QR' && (
                  <button type="button" onClick={() => setPaymentSale(sale)}>
                    Cobrar con QR
                  </button>
                )}
              </article>
            ))
          ) : (
            <p className="muted">Todavía no hay ventas registradas.</p>
          )}
        </aside>
      </div>
      {paymentSale && (
        <div className="modal-overlay" onClick={() => setPaymentSale(null)}>
          <section
            className="auth-modal sales-qr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-qr-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              aria-label="Cerrar QR de venta"
              onClick={() => setPaymentSale(null)}
            >
              <X size={18} />
            </button>
            <h2 id="pos-qr-title">Cobrar venta con QR</h2>
            <p>
              Venta {paymentSale.numero} · <b>{money(paymentSale.total)}</b>
            </p>
            <QrPaymentPanel
              endpoint={`/sales/${paymentSale.id}/qr-link`}
              orderNumber={paymentSale.numero}
            />
            <p role="status">Esperando confirmación del pago simulado…</p>
          </section>
        </div>
      )}
    </section>
  );
}
