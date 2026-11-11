import { useEffect, useState, type FormEvent } from 'react';
import { PLAN_CATALOG, type PlanCode } from '@lumina/contracts';
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Box,
  Check,
  ChevronDown,
  Layers3,
  Menu,
  MoveUpRight,
  Search,
  ShieldCheck,
  Shirt,
  Sparkles,
  Store,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import './commercial.css';
import { AndroidDownload } from './AndroidDownload';

const demo = '/?tienda=lumina';
const planCopy: Record<PlanCode, { description: string; features: string[] }> = {
  esencial: {
    description: 'Lo esencial para organizar tu primera tienda.',
    features: [
      'Catálogo e inventario',
      'Ventas, pedidos y devoluciones',
      'Reportes manuales',
      'Trabajo offline y vestidor 3D',
    ],
  },
  pro: {
    description: 'Más visión y herramientas para dar el siguiente paso.',
    features: [
      'Todo lo del plan Esencial',
      'Reportes asistidos por IA',
      'Consultas por texto y voz',
      'Análisis de demanda y reposición',
    ],
  },
  negocio: {
    description: 'Una operación conectada, incluso cuando crece.',
    features: [
      'Todo lo del plan Profesional',
      'Análisis entre ubicaciones',
      'Detección de anomalías',
      'Más capacidad para tu equipo',
    ],
  },
};

function Preview() {
  return (
    <figure className="sh-preview" aria-label="Vista ilustrativa de las herramientas de Lúmina">
      <div className="sh-preview-window">
        <div className="sh-window-top">
          <span>
            <i />
            <i />
            <i />
          </span>
          <span>LÚMINA / MI NEGOCIO</span>
          <ShieldCheck size={14} />
        </div>
        <div className="sh-preview-body">
          <aside className="sh-preview-sidebar" aria-hidden="true">
            <span className="sh-mini-logo">
              l<span>°</span>
            </span>
            <Store />
            <Box />
            <BarChart3 />
            <Users />
          </aside>
          <div className="sh-preview-content">
            <div className="sh-preview-heading">
              <div>
                <small>TODO EN UN MISMO LUGAR</small>
                <h2>Una nueva perspectiva.</h2>
              </div>
              <span className="sh-preview-dot" />
            </div>
            <div className="sh-preview-pills">
              <span>
                <Box size={14} /> Inventario
              </span>
              <span>
                <BarChart3 size={14} /> Reportes
              </span>
              <span>
                <Shirt size={14} /> Vestidor
              </span>
            </div>
            <div className="sh-chart-card">
              <div>
                <span>Tu colección, en números</span>
                <span className="sh-chart-icon">
                  <MoveUpRight size={16} />
                </span>
              </div>
              <p>Ventas por categoría</p>
              <div className="sh-bars" aria-hidden="true">
                {[38, 62, 45, 78, 58, 94, 73, 88].map((height, i) => (
                  <span key={i} style={{ height: `${height}%` }} />
                ))}
              </div>
              <div className="sh-chart-labels">
                <span>Tu información</span>
                <span>Mejores decisiones</span>
              </div>
            </div>
            <div className="sh-preview-bottom">
              <span>
                <span className="sh-small-dot" /> Una operación conectada
              </span>
              <Layers3 size={16} />
            </div>
          </div>
        </div>
      </div>
      <div className="sh-outfit-card">
        <div className="sh-outfit-image">
          <img
            src="/assets/catalog-women/nike-chill-cami.jpg"
            alt="Vestido de la colección de demostración de Lúmina"
          />
          <span>
            <Shirt size={13} /> Tu vestidor 3D
          </span>
        </div>
        <div>
          <strong>Una forma de comprar diferente.</strong>
          <span>
            Del catálogo al vestidor virtual <ArrowUpRight size={14} />
          </span>
        </div>
      </div>
      <figcaption>Vista de producto · gráfico ilustrativo</figcaption>
    </figure>
  );
}

export function CommercialHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [yearly, setYearly] = useState(false);
  const [slug, setSlug] = useState('');
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1101px)');
    const resize = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    desktop.addEventListener('change', resize);
    window.addEventListener('keydown', escape);
    return () => {
      desktop.removeEventListener('change', resize);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  function enterStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identifier = slug.trim().toLowerCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(identifier)) return;
    window.location.assign('/?tienda=' + encodeURIComponent(identifier));
  }
  return (
    <div className="saas-home">
      <a className="sh-skip" href="#contenido">
        Saltar al contenido
      </a>
      <div className="sh-announcement">
        <span>Menos tareas sueltas. Más espacio para crecer.</span>
        <a href="#planes">
          Conoce los planes <ArrowRight size={13} />
        </a>
      </div>
      <header className="sh-header">
        <a className="sh-brand" href="/" aria-label="Lúmina, inicio">
          lúmina<span>°</span>
          <small>LA PLATAFORMA PARA TU MODA</small>
        </a>
        <button
          className="sh-menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={menuOpen}
          aria-controls="sh-navigation"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
        <nav
          id="sh-navigation"
          className={'sh-nav' + (menuOpen ? ' sh-nav-open' : '')}
          aria-label="Navegación de la plataforma"
        >
          <a href="#producto" onClick={() => setMenuOpen(false)}>
            La plataforma
          </a>
          <a href="#planes" onClick={() => setMenuOpen(false)}>
            Planes
          </a>
          <a href="#android" onClick={() => setMenuOpen(false)}>
            Android
          </a>
          <a href="#preguntas" onClick={() => setMenuOpen(false)}>
            Preguntas
          </a>
          <a className="sh-nav-login" href="#tiendas" onClick={() => setMenuOpen(false)}>
            Entrar a mi tienda <ArrowUpRight size={16} />
          </a>
          <a className="sh-nav-superadmin" href="/?plataforma=1" onClick={() => setMenuOpen(false)}>
            <ShieldCheck size={15} /> Superadmin
          </a>
        </nav>
      </header>
      <main id="contenido" className="sh-main">
        <section className="sh-hero" aria-labelledby="sh-title">
          <div className="sh-hero-copy">
            <span className="sh-eyebrow sh-hero-badge">
              <Sparkles size={13} /> GESTIÓN SIMPLE PARA NEGOCIOS DE MODA
            </span>
            <h1 id="sh-title">
              Tu moda tiene futuro.
              <br />
              <em>Dale una plataforma.</em>
            </h1>
            <p>
              Tu tienda, tu equipo y tus decisiones, conectados. Gestiona tu negocio de moda con
              inventario, reportes con IA y una experiencia de compra en 3D.
            </p>
            <div className="sh-actions">
              <a className="sh-button sh-button-primary" href="#tiendas">
                Ingresar a mi negocio <ArrowRight size={17} />
              </a>
              <a className="sh-button sh-button-outline" href="#planes">
                Planes y registro <ArrowUpRight size={16} />
              </a>
              <a className="sh-button sh-hero-superadmin" href="/?plataforma=1">
                <ShieldCheck size={16} /> Superadmin
              </a>
            </div>
            <div className="sh-hero-note sh-hero-demo-note">
              <span>¿Quieres conocer Lúmina primero?</span>
              <a className="sh-text-link" href={demo}>
                Explorar la demo <ArrowRight size={14} />
              </a>
            </div>
            <div className="sh-hero-assurances" aria-label="Ventajas de Lúmina">
              <div>
                <ShieldCheck size={16} />
                <strong>Tu propio espacio</strong>
                <span>Datos y acceso separados</span>
              </div>
              <div>
                <BarChart3 size={16} />
                <strong>Decisiones con datos</strong>
                <span>Reportes por texto y voz</span>
              </div>
              <div>
                <WifiOff size={16} />
                <strong>Web y Android</strong>
                <span>Funciones offline compatibles</span>
              </div>
            </div>
          </div>
          <Preview />
        </section>
        <div className="sh-capabilities" aria-label="Herramientas incluidas">
          <span>
            DETRÁS DE CADA GRAN COLECCIÓN,
            <br />
            <strong>UN NEGOCIO BIEN CONECTADO.</strong>
          </span>
          <span>
            <Box /> Inventario
          </span>
          <span>
            <BarChart3 /> Reportes con IA
          </span>
          <span>
            <Shirt /> Vestidor 3D
          </span>
          <span>
            <WifiOff /> Modo offline
          </span>
        </div>
        <section id="producto" className="sh-section" aria-labelledby="sh-product-title">
          <div className="sh-section-heading">
            <div>
              <span className="sh-eyebrow">MÁS QUE UN CATÁLOGO</span>
              <h2 id="sh-product-title">
                Todo lo que mueve tu tienda.
                <br />
                <em>En un mismo lugar.</em>
              </h2>
            </div>
            <p>
              Desde lo que tienes en stock hasta lo que viene después. Herramientas que acompañan
              cada etapa de tu negocio.
            </p>
          </div>
          <div className="sh-feature-grid">
            <article className="sh-feature sh-feature-inventory">
              <div className="sh-feature-icon">
                <Box />
              </div>
              <span className="sh-card-label">01 / ORGANIZA</span>
              <h3>El control se siente bien.</h3>
              <p>
                Productos, tallas, colores y existencias por ubicación. Conecta tus ventas con
                pedidos, devoluciones y movimientos de inventario.
              </p>
              <div className="sh-stock-preview" aria-hidden="true">
                <span>
                  <span className="sh-swatch sh-swatch-plum" /> Vestidos y faldas{' '}
                  <Check size={16} />
                </span>
                <span>
                  <span className="sh-swatch sh-swatch-clay" /> Tallas y variantes{' '}
                  <Check size={16} />
                </span>
                <span>
                  <span className="sh-swatch sh-swatch-sand" /> Sucursales y almacenes{' '}
                  <Check size={16} />
                </span>
              </div>
            </article>
            <article className="sh-feature sh-feature-reports">
              <div className="sh-feature-icon">
                <Sparkles />
              </div>
              <span className="sh-card-label">02 / DESCUBRE</span>
              <h3>
                Pregunta. Visualiza.
                <br />
                Decide con información.
              </h3>
              <p>
                Consulta por texto o voz y prepara reportes en barras, líneas o gráficos circulares.
                Revisa la propuesta antes de generar tu reporte.
              </p>
              <div className="sh-query-preview">
                <Sparkles size={16} />
                <span>¿Cómo se distribuyen mis ventas?</span>
                <ArrowUpRight size={16} />
              </div>
              <span className="sh-feature-footnote">
                IA disponible en los planes Profesional y Negocio.
              </span>
            </article>
            <article className="sh-feature sh-feature-tryon">
              <div className="sh-feature-icon">
                <Shirt />
              </div>
              <span className="sh-card-label">03 / CONECTA</span>
              <h3>
                Tu colección,
                <br />
                desde otra perspectiva.
              </h3>
              <p>
                Ofrece un vestidor virtual con avatar y vistas 3D de referencia. Una aproximación
                visual para explorar las prendas de tu catálogo.
              </p>
              <a className="sh-text-link" href={demo}>
                Conoce el vestidor <ArrowUpRight size={17} />
              </a>
            </article>
            <article className="sh-feature sh-feature-offline">
              <div className="sh-feature-icon">
                <WifiOff />
              </div>
              <span className="sh-card-label">04 / CONTINÚA</span>
              <h3>
                Tu negocio no termina
                <br />
                donde termina la señal.
              </h3>
              <p>
                Prepara tus datos con conexión, consulta la copia disponible sin internet y
                sincroniza las operaciones compatibles al reconectarte.
              </p>
              <div className="sh-offline-label">
                <span className="sh-small-dot" /> Disponible en web y Android
              </div>
            </article>
          </div>
        </section>
        <section className="sh-how" aria-labelledby="sh-how-title">
          <div>
            <span className="sh-eyebrow">TU SIGUIENTE CAPÍTULO</span>
            <h2 id="sh-how-title">
              De tu idea
              <br />a tu propia tienda.
            </h2>
            <a className="sh-text-link" href="/?registro=1&plan=demo">
              Crear mi negocio <ArrowUpRight size={17} />
            </a>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <h3>Elige tu espacio</h3>
                <p>Compara los planes según tu equipo, productos y ubicaciones.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Prepara tu negocio</h3>
                <p>
                  Registra tu negocio y la cuenta de su propietario. Elige una Demo de 10 días o
                  activa tu plan con Stripe TEST o QR simulado.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Hazlo tuyo</h3>
                <p>
                  Entra a tu tienda, carga tu colección e invita al equipo. Cada negocio conserva
                  sus propios datos.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section id="planes" className="sh-section sh-plans" aria-labelledby="sh-plans-title">
          <div className="sh-section-heading sh-heading-centered">
            <span className="sh-eyebrow">ESPACIO PARA CADA ETAPA</span>
            <h2 id="sh-plans-title">
              Empieza a tu ritmo.
              <br />
              <em>Crece a tu manera.</em>
            </h2>
            <p>
              Planes por tienda, en dólares estadounidenses. Elige las herramientas y la capacidad
              que necesita tu negocio.
            </p>
          </div>
          <div className="sh-billing-toggle" aria-label="Período de facturación">
            <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
              Mensual
            </button>
            <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
              Anual
            </button>
          </div>
          <article className="sh-demo-plan">
            <div>
              <span className="sh-eyebrow">EMPIEZA SIN TARJETA</span>
              <h3>Demo gratuita · USD 0</h3>
              <p>
                Prueba las herramientas durante 10 días con tu propio negocio. Una Demo por correo.
              </p>
            </div>
            <a className="sh-button sh-button-outline" href="/?registro=1&plan=demo">
              Crear Demo <ArrowUpRight size={17} />
            </a>
          </article>
          <div className="sh-plan-grid">
            {Object.values(PLAN_CATALOG).map((plan) => (
              <article
                className={'sh-plan' + (plan.code === 'pro' ? ' sh-plan-featured' : '')}
                key={plan.code}
              >
                {plan.code === 'pro' && (
                  <span className="sh-plan-badge">
                    <Sparkles size={13} /> MÁS HERRAMIENTAS PARA CRECER
                  </span>
                )}
                <span className="sh-card-label">
                  LÚMINA /{' '}
                  {plan.code === 'esencial'
                    ? 'EMPIEZA'
                    : plan.code === 'pro'
                      ? 'IMPULSA'
                      : 'EXPANDE'}
                </span>
                <h3>{plan.name}</h3>
                <p className="sh-plan-description">{planCopy[plan.code].description}</p>
                <div className="sh-price">
                  {!plan.contactSales && <span>USD</span>}
                  <strong>
                    {plan.contactSales
                      ? 'A medida'
                      : ((yearly ? plan.yearlyPriceMinor! : plan.priceMinor) / 100)
                          .toFixed(2)
                          .replace('.', ',')}
                  </strong>
                  {!plan.contactSales && <span>{yearly ? '/ año' : '/ mes'}</span>}
                </div>
                <p className="sh-plan-capacity">
                  {plan.limits.locations}{' '}
                  {plan.limits.locations === 1 ? 'ubicación' : 'ubicaciones'} · {plan.limits.staff}{' '}
                  integrantes · {new Intl.NumberFormat('es-BO').format(plan.limits.products)}{' '}
                  productos
                </p>
                <a
                  href={
                    plan.contactSales
                      ? '#cotizacion'
                      : '/?registro=1&plan=' +
                        plan.code +
                        '&periodo=' +
                        (yearly ? 'YEARLY' : 'MONTHLY')
                  }
                  className={
                    'sh-button ' + (plan.code === 'pro' ? 'sh-button-primary' : 'sh-button-outline')
                  }
                >
                  {plan.contactSales ? 'Consultar condiciones' : 'Crear mi tienda'}{' '}
                  <ArrowUpRight size={17} />
                </a>
                <ul>
                  {planCopy[plan.code].features.map((feature) => (
                    <li key={feature}>
                      <Check size={16} />
                      {feature}
                    </li>
                  ))}
                  <li>
                    <Check size={16} />
                    {plan.limits.avatarsPerPeriod} generaciones de avatar por período
                  </li>
                  {plan.features.aiReports && (
                    <li>
                      <Check size={16} />
                      {plan.limits.aiPerPeriod} interpretaciones de IA por período
                    </li>
                  )}
                </ul>
              </article>
            ))}
          </div>
          <p className="sh-plan-note">
            <ShieldCheck size={15} /> Registro directo del negocio. Stripe TEST y QR simulado; no se
            cobra dinero real ni se realizan débitos automáticos.
          </p>
          <p id="cotizacion" className="sh-plan-note">
            Negocio (Enterprise): precio y condiciones a medida, acordados con el operador de la
            plataforma. No tiene un importe público ni un cobro automático.
          </p>
        </section>
        <section id="tiendas" className="sh-store-section" aria-labelledby="sh-stores-title">
          <div>
            <span className="sh-eyebrow">UN NEGOCIO. SU PROPIO ESPACIO.</span>
            <h2 id="sh-stores-title">Tu tienda te espera.</h2>
            <p>
              ¿Ya formas parte de Lúmina? Abre tu tienda e inicia sesión con la cuenta de tu
              negocio.
            </p>
            <form className="sh-store-search" onSubmit={enterStore}>
              <label htmlFor="sh-store-id">Identificador de tu tienda</label>
              <div>
                <Search size={19} />
                <input
                  id="sh-store-id"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={63}
                  placeholder="Ej. mi-boutique"
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" aria-label="Abrir mi tienda">
                  <ArrowRight size={20} />
                </button>
              </div>
              <small>El identificador se entrega al crear tu negocio.</small>
            </form>
          </div>
          <aside className="sh-store-access" aria-labelledby="sh-store-access-title">
            <span className="sh-store-access-icon">
              <ShieldCheck size={27} />
            </span>
            <span className="sh-eyebrow">EL ACCESO A TU NEGOCIO</span>
            <h3 id="sh-store-access-title">Un espacio para tu equipo.</h3>
            <p>
              Usa el identificador o el enlace que recibiste al crear tu tienda. Después inicia
              sesión con tu correo y contraseña.
            </p>
            <ol>
              <li>
                <span>01</span> Abre tu tienda con su identificador.
              </li>
              <li>
                <span>02</span> Ingresa con tu cuenta del negocio.
              </li>
              <li>
                <span>03</span> Accede a tus herramientas y datos.
              </li>
            </ol>
            <small>
              Los negocios registrados se consultan desde el panel del operador de plataforma.
            </small>
          </aside>
        </section>
        <AndroidDownload />
        <section id="preguntas" className="sh-section sh-faq" aria-labelledby="sh-faq-title">
          <div>
            <span className="sh-eyebrow">ANTES DE DAR EL PASO</span>
            <h2 id="sh-faq-title">
              Las cosas claras,
              <br />
              <em>desde el inicio.</em>
            </h2>
          </div>
          <div className="sh-faq-list">
            {[
              [
                '¿Lúmina es una tienda de ropa o una plataforma?',
                'Lúmina es una plataforma para gestionar negocios de moda. Cada negocio tiene su propia tienda, catálogo, equipo e inventario. La tienda Lúmina que puedes visitar es el espacio de demostración.',
              ],
              [
                '¿Cómo se crea una tienda?',
                'Elige una Demo gratuita de 10 días o un plan mensual/anual. Registra tu negocio y su propietario, completa Stripe TEST o QR simulado y abre tu tienda con el identificador elegido. El acceso del operador sigue disponible para la administración de la plataforma.',
              ],
              [
                '¿Mis datos se mezclan con los de otros negocios?',
                'Cada tienda dispone de un espacio de datos separado. Las cuentas, permisos y operaciones se verifican para el negocio seleccionado.',
              ],
              [
                '¿Puedo trabajar sin internet?',
                'Sí, en las funciones compatibles. Primero prepara tu copia con conexión. Después podrás consultar la información descargada y guardar operaciones compatibles para sincronizarlas al volver a conectarte.',
              ],
              [
                '¿Los pagos y el vestidor son reales?',
                'Los pagos de esta versión son de prueba: Stripe TEST y QR simulado no cobran dinero real. El vestidor ofrece una aproximación visual en 3D; no garantiza el ajuste físico de una prenda.',
              ],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>
                  {question}
                  <ChevronDown size={18} />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="sh-closing">
          <span className="sh-eyebrow">DALE ESPACIO A LO QUE VIENE</span>
          <h2>
            Tu próxima gran colección
            <br />
            merece una gran plataforma.
          </h2>
          <a className="sh-button sh-button-light" href={demo}>
            Descubre Lúmina en acción <ArrowUpRight size={18} />
          </a>
        </section>
      </main>
      <footer className="sh-footer">
        <div>
          <a className="sh-brand" href="/">
            lúmina<span>°</span>
          </a>
          <p>
            Tecnología para la moda.
            <br />
            Espacio para tu negocio.
          </p>
        </div>
        <nav aria-label="Enlaces del pie de página">
          <a href="#planes">Planes</a>
          <a href="#tiendas">Entrar a mi tienda</a>
          <a href="#android">Descargar para Android</a>
          <a href={demo}>Tienda demo</a>
          <a href="/?plataforma=1">
            Superadmin · Gestión de plataforma <ArrowUpRight size={14} />
          </a>
        </nav>
        <div className="sh-footer-bottom">
          <span>Lúmina · Grupo 18</span>
          <span>Proyecto académico · Pagos de prueba</span>
          <a href="#sh-title">Volver arriba ↑</a>
        </div>
      </footer>
    </div>
  );
}
