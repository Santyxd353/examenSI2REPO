import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, PackageCheck, RefreshCw, Truck } from 'lucide-react';
import { api } from './api';
import { useOperationIdentity } from './useOperationIdentity';

type Order = {
  id: string;
  numero: string;
  canal: 'WEB' | 'APP' | 'TIENDA';
  estado: string;
  total: string | number;
  moneda: string;
  direccion_snapshot: Record<string, unknown>;
  seguimiento?: string | null;
  creado_en: string;
  entregado_en?: string | null;
  usuario_pedido_usuario_idTousuario: {
    nombres: string;
    apellidos: string;
    correo: string;
    telefono?: string | null;
  };
  ubicacion?: { nombre: string; tipo: string } | null;
  detalle_pedido: {
    id: string;
    descripcion_snapshot: string;
    sku_snapshot: string;
    talla_snapshot: string;
    color_snapshot: string;
    cantidad: number;
    total_linea: string | number;
  }[];
  pago: { estado: string; proveedor: string }[];
  historial_pedido: {
    id: string;
    estado_anterior?: string | null;
    estado_nuevo: string;
    motivo: string;
    creado_en: string;
  }[];
  devolucion: {
    id: string;
    estado: string;
    tipo: string;
    motivo: string;
    resolucion?: string | null;
    detalle_devolucion: {
      id: string;
      cantidad: number;
      cantidad_apta: number;
      observacion?: string | null;
      detalle_pedido: {
        descripcion_snapshot: string;
        sku_snapshot: string;
        cantidad: number;
      };
    }[];
    reembolso: { id: string; monto: string | number; estado: string }[];
  }[];
};

const nextStatus: Record<string, string> = {
  CONFIRMADO: 'PREPARANDO',
  PREPARANDO: 'DESPACHADO',
  DESPACHADO: 'ENTREGADO',
  ENTREGADO: 'CERRADO',
};

const actionLabel: Record<string, string> = {
  PREPARANDO: 'Comenzar preparación',
  DESPACHADO: 'Marcar como despachado',
  ENTREGADO: 'Confirmar entrega',
  CERRADO: 'Cerrar pedido',
};

const money = (value: string | number, currency = 'BOB') =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency }).format(Number(value));

function addressText(value: Record<string, unknown>) {
  const parts = [value.destinatario, value.telefono, value.ciudad, value.zona, value.detalle]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(' · ') : 'Sin dirección estructurada';
}

export function OrdersAdmin() {
  const refundIdentity = useOperationIdentity();
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [returnResolutions, setReturnResolutions] = useState<Record<string, string>>({});
  const [acceptedQuantities, setAcceptedQuantities] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (channel) params.set('channel', channel);
      setOrders(await api(`/admin/orders${params.size ? `?${params}` : ''}`));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, channel]);

  useEffect(() => {
    void load();
  }, [load]);

  async function advance(order: Order) {
    const target = nextStatus[order.estado];
    if (!target) return;
    const reason = reasons[order.id]?.trim() || `Pedido actualizado a ${target}.`;
    if (target === 'DESPACHADO' && (tracking[order.id]?.trim().length || 0) < 3) {
      setError('Registra una referencia de seguimiento antes de despachar.');
      return;
    }
    setBusy(order.id);
    setError('');
    setMessage('');
    try {
      await api(`/admin/orders/${order.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: target,
          reason,
          ...(target === 'DESPACHADO' ? { tracking: tracking[order.id].trim() } : {}),
        }),
      });
      setMessage(`${order.numero} cambió a ${target.replaceAll('_', ' ')}.`);
      await load();
    } catch (reasonValue) {
      setError((reasonValue as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function cancel(order: Order) {
    const reason = reasons[order.id]?.trim() || '';
    if (reason.length < 10) {
      setError('Escribe un motivo de cancelación de al menos 10 caracteres.');
      return;
    }
    if (!window.confirm(`¿Cancelar ${order.numero}, reintegrar el stock y simular el reembolso?`))
      return;
    setBusy(order.id);
    setError('');
    setMessage('');
    try {
      const payload = { orderId: order.id, reason };
      await api(`/admin/orders/${order.id}/cancel`, {
        method: 'PATCH',
        body: JSON.stringify({ reason, idempotency: refundIdentity.forPayload(payload) }),
      });
      refundIdentity.complete(payload);
      setMessage(`${order.numero} fue cancelado; el stock y el reembolso quedaron registrados.`);
      await load();
    } catch (reasonValue) {
      setError((reasonValue as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function reviewReturn(order: Order, returnId: string, decision: 'APROBAR' | 'RECHAZAR') {
    const request = order.devolucion.find((item) => item.id === returnId);
    if (!request) return;
    const resolution = returnResolutions[returnId]?.trim() || '';
    if (resolution.length < 10) {
      setError('Escribe una resolución de al menos 10 caracteres.');
      return;
    }
    const items = request.detalle_devolucion.map((detail) => ({
      returnDetailId: detail.id,
      acceptedQuantity: Number(acceptedQuantities[detail.id] ?? detail.cantidad),
    }));
    if (
      decision === 'APROBAR' &&
      items.some(
        (item, index) =>
          !Number.isInteger(item.acceptedQuantity) ||
          item.acceptedQuantity < 0 ||
          item.acceptedQuantity > request.detalle_devolucion[index].cantidad,
      )
    ) {
      setError('Revisa las cantidades aceptadas de la devolución.');
      return;
    }
    setBusy(returnId);
    setError('');
    setMessage('');
    try {
      const payload = {
        returnId,
        decision,
        resolution,
        items: decision === 'APROBAR' ? items : [],
      };
      await api(`/admin/orders/returns/${returnId}/review`, {
        method: 'PATCH',
        body: JSON.stringify({
          decision,
          resolution,
          idempotency: refundIdentity.forPayload(payload),
          items: decision === 'APROBAR' ? items : [],
        }),
      });
      refundIdentity.complete(payload);
      setMessage(
        decision === 'APROBAR'
          ? 'Devolución resuelta con reintegro y reembolso simulado.'
          : 'La solicitud de devolución fue rechazada.',
      );
      await load();
    } catch (reasonValue) {
      setError((reasonValue as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="orders-admin-page">
      <div className="section-title orders-admin-title">
        <span className="eyebrow">OPERACIÓN DE PEDIDOS</span>
        <h1>Preparación y entrega.</h1>
        <p>
          Consulta pedidos de la web, la aplicación y mostrador. Cada cambio queda registrado con su
          responsable, fecha y motivo.
        </p>
      </div>

      <div className="orders-toolbar">
        <label>
          Estado
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Todos</option>
            {[
              'PENDIENTE_PAGO',
              'CONFIRMADO',
              'PREPARANDO',
              'DESPACHADO',
              'ENTREGADO',
              'CERRADO',
              'CANCELADO',
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Canal
          <select value={channel} onChange={(event) => setChannel(event.target.value)}>
            <option value="">Todos</option>
            <option>WEB</option>
            <option>APP</option>
            <option>TIENDA</option>
          </select>
        </label>
        <button className="orders-refresh" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={15} /> {loading ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>

      {error && <div className="message error">{error}</div>}
      {message && <div className="message">{message}</div>}

      <div className="orders-list">
        {!loading && !orders.length && (
          <div className="orders-empty">No hay pedidos con los filtros seleccionados.</div>
        )}
        {orders.map((order) => {
          const target = nextStatus[order.estado];
          const customer = order.usuario_pedido_usuario_idTousuario;
          return (
            <article className="order-admin-card" key={order.id}>
              <div className="order-admin-heading">
                <div>
                  <div className="order-admin-number">{order.numero}</div>
                  <small>
                    {new Date(order.creado_en).toLocaleString('es-BO')} · {order.canal}
                  </small>
                </div>
                <span className={`order-state state-${order.estado.toLowerCase()}`}>
                  {order.estado.replaceAll('_', ' ')}
                </span>
              </div>

              <div className="order-admin-grid">
                <div>
                  <b>Cliente</b>
                  <p>
                    {customer.nombres} {customer.apellidos}
                  </p>
                  <small>
                    {customer.correo}
                    {customer.telefono ? ` · ${customer.telefono}` : ''}
                  </small>
                </div>
                <div>
                  <b>Origen</b>
                  <p>{order.ubicacion?.nombre || 'Sin ubicación'}</p>
                  <small>{addressText(order.direccion_snapshot)}</small>
                </div>
                <div>
                  <b>Total</b>
                  <p className="order-total">{money(order.total, order.moneda)}</p>
                  <small>Pago: {order.pago[0]?.estado || 'Sin pago'}</small>
                </div>
              </div>

              <div className="order-lines">
                {order.detalle_pedido.map((line) => (
                  <div key={line.id}>
                    <span>
                      {line.cantidad} × {line.descripcion_snapshot}
                    </span>
                    <small>
                      {line.sku_snapshot} · {line.talla_snapshot} · {line.color_snapshot}
                    </small>
                    <b>{money(line.total_linea, order.moneda)}</b>
                  </div>
                ))}
              </div>

              {!!order.seguimiento && (
                <div className="tracking">
                  <Truck size={15} /> Seguimiento: <b>{order.seguimiento}</b>
                </div>
              )}
              {!!order.devolucion.length && (
                <div className="returns-note">
                  Tiene {order.devolucion.length} solicitud(es) de devolución.
                </div>
              )}
              {order.devolucion.map((returnRequest) => (
                <section className="return-review" key={returnRequest.id}>
                  <div className="return-review-heading">
                    <div>
                      <b>{returnRequest.tipo === 'CANCELACION' ? 'Cancelación' : 'Devolución'}</b>
                      <p>{returnRequest.motivo}</p>
                    </div>
                    <span className={`order-state state-${returnRequest.estado.toLowerCase()}`}>
                      {returnRequest.estado.replaceAll('_', ' ')}
                    </span>
                  </div>
                  {returnRequest.detalle_devolucion.map((detail) => (
                    <div className="return-line" key={detail.id}>
                      <div>
                        <span>{detail.detalle_pedido.descripcion_snapshot}</span>
                        <small>
                          {detail.detalle_pedido.sku_snapshot} · solicitadas: {detail.cantidad}
                        </small>
                      </div>
                      {returnRequest.estado === 'SOLICITADA' ? (
                        <label>
                          Cantidad apta
                          <input
                            type="number"
                            min="0"
                            max={detail.cantidad}
                            value={acceptedQuantities[detail.id] ?? String(detail.cantidad)}
                            onChange={(event) =>
                              setAcceptedQuantities((current) => ({
                                ...current,
                                [detail.id]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : (
                        <b>Aptas: {detail.cantidad_apta}</b>
                      )}
                    </div>
                  ))}
                  {returnRequest.estado === 'SOLICITADA' ? (
                    <div className="return-resolution">
                      <label>
                        Resolución de la revisión
                        <input
                          value={returnResolutions[returnRequest.id] || ''}
                          maxLength={400}
                          onChange={(event) =>
                            setReturnResolutions((current) => ({
                              ...current,
                              [returnRequest.id]: event.target.value,
                            }))
                          }
                          placeholder="Describe la inspección y la decisión"
                        />
                      </label>
                      <div className="return-buttons">
                        <button
                          className="primary"
                          disabled={busy === returnRequest.id}
                          onClick={() => void reviewReturn(order, returnRequest.id, 'APROBAR')}
                        >
                          Aprobar y reembolsar
                        </button>
                        <button
                          className="danger-button"
                          disabled={busy === returnRequest.id}
                          onClick={() => void reviewReturn(order, returnRequest.id, 'RECHAZAR')}
                        >
                          Rechazar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="return-result">
                      <span>{returnRequest.resolucion || 'Sin resolución registrada.'}</span>
                      {!!returnRequest.reembolso.length && (
                        <b>
                          Reembolso simulado:{' '}
                          {money(returnRequest.reembolso[0].monto, order.moneda)}
                        </b>
                      )}
                    </div>
                  )}
                </section>
              ))}

              <details className="order-history">
                <summary>Historial ({order.historial_pedido.length})</summary>
                {order.historial_pedido.map((item) => (
                  <div key={item.id}>
                    <Clock3 size={13} />
                    <span>
                      <b>{item.estado_nuevo.replaceAll('_', ' ')}</b> · {item.motivo}
                    </span>
                    <small>{new Date(item.creado_en).toLocaleString('es-BO')}</small>
                  </div>
                ))}
              </details>

              {target && (
                <div className="order-transition">
                  <label>
                    Motivo o nota
                    <input
                      value={reasons[order.id] || ''}
                      onChange={(event) =>
                        setReasons((current) => ({ ...current, [order.id]: event.target.value }))
                      }
                      placeholder={`Nota para ${target.toLowerCase()}`}
                    />
                  </label>
                  {target === 'DESPACHADO' && (
                    <label>
                      Referencia de seguimiento
                      <input
                        value={tracking[order.id] || ''}
                        onChange={(event) =>
                          setTracking((current) => ({ ...current, [order.id]: event.target.value }))
                        }
                        placeholder="Ej. GUIA-000123"
                      />
                    </label>
                  )}
                  <div className="order-transition-buttons">
                    <button
                      className="primary"
                      disabled={busy === order.id}
                      onClick={() => void advance(order)}
                    >
                      {target === 'PREPARANDO' ? (
                        <PackageCheck size={16} />
                      ) : target === 'DESPACHADO' ? (
                        <Truck size={16} />
                      ) : (
                        <CheckCircle2 size={16} />
                      )}
                      {busy === order.id ? 'Guardando…' : actionLabel[target]}
                    </button>
                    {['CONFIRMADO', 'PREPARANDO'].includes(order.estado) && (
                      <button
                        className="danger-button"
                        disabled={busy === order.id}
                        onClick={() => void cancel(order)}
                      >
                        Cancelar y reembolsar
                      </button>
                    )}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
