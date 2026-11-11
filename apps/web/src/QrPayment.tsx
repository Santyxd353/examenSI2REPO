import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from './api';
import './qr-payment.css';

export function QrPaymentPanel({
  endpoint,
  orderNumber,
}: {
  endpoint: string;
  orderNumber: string;
}) {
  const [link, setLink] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLink('');
    setError('');
    void api(endpoint, { method: 'POST' })
      .then((result) => {
        if (active) setLink(result.url);
      })
      .catch((reason) => {
        if (active) setError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  return (
    <div className="payment-qr">
      {error ? (
        <p role="alert" className="message error">
          {error}
        </p>
      ) : !link ? (
        <p role="status">Preparando QR seguro…</p>
      ) : (
        <>
          <QRCodeSVG
            value={link}
            size={240}
            style={{ maxWidth: '100%', height: 'auto' }}
            level="M"
            marginSize={4}
            title={`QR de prueba del pedido ${orderNumber}`}
          />
          <b>Escanea con la cámara de tu teléfono</b>
          <small>
            Abre el enlace y confirma el pago simulado. No necesitas instalar otra aplicación.
          </small>
          <a className="qr-open-link" href={link} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Abrir simulador de pago
          </a>
        </>
      )}
      <small>Simulación académica. No se cobra dinero real ni se solicitan datos bancarios.</small>
    </div>
  );
}

type PaymentView = {
  orderNumber: string;
  amount: string;
  currency: string;
  storeName: string;
  state: string;
  paid: boolean;
  canPay: boolean;
  simulated: true;
};
export function QrDemoPage() {
  const [address, setAddress] = useState(window.location.href);
  const [view, setView] = useState<PaymentView | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const location = new URL(address);
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const slug = location.searchParams.get('tienda') || 'lumina';
  useEffect(() => {
    const changed = () => setAddress(window.location.href);
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => {
      window.removeEventListener('hashchange', changed);
      window.removeEventListener('popstate', changed);
    };
  }, []);
  async function request(confirm = false, signal?: AbortSignal) {
    const response = await fetch('/api/payments/qr-demo' + (confirm ? '/confirm' : ''), {
      method: confirm ? 'POST' : 'GET',
      credentials: 'omit',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': slug,
        ...(confirm ? {} : { 'X-QR-Token': token }),
      },
      ...(confirm ? { body: JSON.stringify({ token }) } : {}),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.message === 'string' ? data.message : 'No se pudo verificar el QR.',
      );
    return data as PaymentView;
  }
  useEffect(() => {
    document.title = 'Lúmina · Pago QR de prueba';
    let active = true;
    setView(null);
    setError('');
    setBusy(false);
    const controller = new AbortController(),
      timer = window.setTimeout(() => controller.abort(), 15000);
    void request(false, controller.signal)
      .then((value) => {
        if (active) setView(value);
      })
      .catch((reason) => {
        if (!active) return;
        if (!controller.signal.aborted) setError(reason.message);
        else setError('No pudimos conectar. Recarga la página para volver a intentar.');
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [token, slug]);
  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const value = await request(true, AbortSignal.timeout(15000));
      if (window.location.href === address) setView(value);
    } catch (reason) {
      if (window.location.href !== address) return;
      setError(
        (reason as Error).name === 'TimeoutError'
          ? 'La conexión tardó demasiado. Reintenta para comprobar el mismo pago.'
          : (reason as Error).message,
      );
    } finally {
      if (window.location.href === address) setBusy(false);
    }
  }
  return (
    <main className="qr-demo-page">
      <section className="qr-demo-card">
        <a className="qr-demo-brand" href="/">
          lúmina°
        </a>
        <span className="payment-demo-badge">
          <ShieldCheck size={16} /> ENTORNO DE PRUEBA · SIN COBRO REAL
        </span>
        <h1>{view?.paid ? 'Pago simulado confirmado' : 'Paga con QR de prueba'}</h1>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        {!view && !error && <p role="status">Verificando pedido…</p>}
        {view && (
          <>
            <p>{view.storeName}</p>
            <dl className="qr-payment-details">
              <div>
                <dt>Pedido</dt>
                <dd>{view.orderNumber}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>
                  {new Intl.NumberFormat('es-BO', {
                    style: 'currency',
                    currency: view.currency,
                  }).format(Number(view.amount))}
                </dd>
              </div>
            </dl>
            {view.paid ? (
              <div className="qr-paid" role="status">
                <CheckCircle2 size={32} />
                <b>El pedido está pagado.</b>
                <p>La tienda se actualizará automáticamente. Puedes cerrar esta página.</p>
              </div>
            ) : view.canPay ? (
              <>
                <p>
                  Confirma para registrar un pago ficticio por el importe indicado. No se mueve
                  dinero real.
                </p>
                <button
                  className="primary qr-confirm"
                  onClick={() => void confirm()}
                  disabled={busy}
                >
                  {busy ? 'Confirmando…' : 'Confirmar pago simulado'}
                </button>
              </>
            ) : (
              <p role="status">
                El pedido está cancelado o el QR venció. Solicita un nuevo QR en la tienda. No se
                realizó ningún cobro.
              </p>
            )}
          </>
        )}
        <small>Este simulador no solicita cuentas, tarjetas ni datos bancarios.</small>
      </section>
    </main>
  );
}
