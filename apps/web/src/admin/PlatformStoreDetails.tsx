import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Copy, X } from 'lucide-react';
import { PLAN_CATALOG } from '@lumina/contracts';
import { platformDate, stateNames, subscriptionNames, type StoreDetails } from './platform-model';
export function PlatformStoreDetails({
  data,
  onClose,
}: {
  data: StoreDetails | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState('');
  useEffect(() => {
    setCopied('');
    if (data && !ref.current?.open) ref.current?.showModal();
    if (!data && ref.current?.open) ref.current.close();
  }, [data]);
  const store = data?.tenant;
  const plan = store ? PLAN_CATALOG[store.planCode as keyof typeof PLAN_CATALOG] : null;
  const url = store ? location.origin + '/?tienda=' + encodeURIComponent(store.slug) : '';
  return (
    <dialog
      ref={ref}
      className="operator-details"
      onCancel={onClose}
      aria-labelledby="operator-detail-title"
    >
      {store && (
        <>
          <div className="operator-detail-top">
            <span className="eyebrow">FICHA DEL NEGOCIO</span>
            <button onClick={onClose} aria-label="Cerrar ficha">
              <X size={20} />
            </button>
          </div>
          <h2 id="operator-detail-title">{store.name}</h2>
          <p className="operator-detail-slug">{store.slug}</p>
          <div className="operator-detail-badges">
            <span className="saas-state">{stateNames[store.state] || store.state}</span>
            <span>{store.legacyPilot ? 'Espacio inicial' : plan?.name || store.planCode}</span>
          </div>
          <dl className="operator-detail-data">
            <div>
              <dt>Creación</dt>
              <dd>{platformDate(store.createdAt)}</dd>
            </div>
            <div>
              <dt>Suscripción</dt>
              <dd>{subscriptionNames[store.effectiveStatus || store.status] || store.status}</dd>
            </div>
            <div>
              <dt>Fin de prueba</dt>
              <dd>{platformDate(store.trialEndsAt)}</dd>
            </div>
            <div>
              <dt>Acceso pagado hasta</dt>
              <dd>{platformDate(store.paidThrough)}</dd>
            </div>
            <div>
              <dt>Medio registrado</dt>
              <dd>
                {store.provider === 'STRIPE'
                  ? 'Stripe TEST'
                  : store.provider === 'QR_SIMULATED'
                    ? 'QR simulado'
                    : 'Sin pago registrado'}
              </dd>
            </div>
            <div>
              <dt>Identificador interno</dt>
              <dd>
                <code>{store.id}</code>
              </dd>
            </div>
          </dl>
          <section className="operator-detail-link">
            <h3>Acceso a la tienda</h3>
            <p>
              La administradora debe iniciar sesión con la cuenta de este negocio. Tu sesión de
              operador es independiente.
            </p>
            <input
              aria-label="Enlace de la tienda"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="operator-actions">
              <button
                className="saas-secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(url).then(
                    () => setCopied('Enlace copiado.'),
                    () => setCopied('Selecciona el enlace para copiarlo manualmente.'),
                  )
                }
              >
                <Copy size={15} /> Copiar enlace
              </button>
              {['ACTIVE', 'TRIAL'].includes(store.state) && (
                <a className="saas-primary" href={url} target="_blank" rel="noreferrer">
                  Abrir tienda <ArrowUpRight size={15} />
                </a>
              )}
            </div>
            <small role="status">{copied}</small>
          </section>
          {plan && !store.legacyPilot && (
            <section className="operator-detail-capacity">
              <h3>Capacidad del plan</h3>
              <p>
                {plan.limits.locations} ubicaciones · {plan.limits.staff} integrantes ·{' '}
                {plan.limits.products.toLocaleString('es-BO')} productos
              </p>
              <small>
                La sucursal principal y la administradora inicial cuentan en esos límites.
              </small>
            </section>
          )}
          <section className="operator-detail-payments">
            <h3>Solicitudes de suscripción recientes</h3>
            <p>Stripe TEST y QR simulado. No representan cobros de dinero real.</p>
            {data!.payments.length ? (
              data!.payments.map((p) => (
                <article key={p.id}>
                  <div>
                    <strong>
                      {p.provider === 'STRIPE'
                        ? 'Stripe TEST'
                        : p.provider === 'QR_SIMULATED'
                          ? 'QR simulado'
                          : 'Sin pago'}
                    </strong>
                    <span>
                      {typeof p.amountMinor === 'number' &&
                      ['USD', 'BOB'].includes(p.currency || '')
                        ? new Intl.NumberFormat('es-BO', {
                            style: 'currency',
                            currency: p.currency!,
                          }).format(p.amountMinor / 100)
                        : 'Sin importe'}
                    </span>
                  </div>
                  <small>
                    {p.status} · {platformDate(p.receivedAt)}
                  </small>
                </article>
              ))
            ) : (
              <p>Este negocio no tiene solicitudes de pago registradas.</p>
            )}
          </section>
          {store.state === 'FAILED' && (
            <p className="saas-alert">
              El identificador quedó reservado. El soporte debe revisar la provisión parcial antes
              de repetir un alta.
            </p>
          )}
          <p className="operator-caption">
            Esta ficha consulta el registro de plataforma. El catálogo, el inventario y los usuarios
            se administran dentro de cada tienda.
          </p>
        </>
      )}
    </dialog>
  );
}
