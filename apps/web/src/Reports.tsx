import { FormEvent, useEffect, useState } from 'react';
import { BarChart3, Bot, RefreshCw, Send, Sparkles, TriangleAlert } from 'lucide-react';
import { api } from './api';

type Location = { id: string; nombre: string; tipo: 'TIENDA' | 'ALMACEN'; activa: boolean };
type Report = {
  kpis: { pedidos: number; ventas: number; unidades: number; ticketPromedio: number };
  summary: string;
  generatedBy: string;
  products: {
    variante_id: string;
    producto: string;
    sku: string;
    unidades: number;
    ventas: number;
  }[];
  locations: { ubicacion_id: string; ubicacion: string | null; pedidos: number; ventas: number }[];
  sellers: {
    vendedor_id: string | null;
    vendedor: string | null;
    pedidos: number;
    ventas: number;
  }[];
  inventory: {
    ubicacion_id: string;
    ubicacion: string;
    fisico: number;
    reservado: number;
    comprometido: number;
    disponible: number;
    alertas: number;
  }[];
};
type Analysis = {
  status: string;
  model: { demand: string; anomalies: string };
  note: string;
  predictions: {
    ejecucion_id: string;
    variante_id: string;
    producto?: string;
    sku?: string;
    ubicacion?: string;
    fecha: string;
    cantidad: number;
    limite_inferior: number;
    limite_superior: number;
  }[];
  recommendations: {
    ejecucion_id: string;
    variante_id: string;
    tipo: string;
    producto?: string;
    sku?: string;
    destino?: string;
    cantidad: number;
    cobertura_dias: number;
    motivo: { explicacion?: string; disponible?: number; objetivo?: number };
  }[];
  anomalies: { entidad_id: string; indicador: string; puntaje: number; evidencia: unknown }[];
};

const today = new Date().toISOString().slice(0, 10);
const ago = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
const money = (value: number) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(value);

export function Reports() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [from, setFrom] = useState(ago);
  const [to, setTo] = useState(today);
  const [location, setLocation] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [question, setQuestion] = useState('¿Qué producto vendió más?');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const filters = () => ({ from, to, ...(location ? { location } : {}) });

  async function loadReport() {
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (location) params.set('location', location);
      setReport(await api(`/reports/summary?${params}`));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void Promise.all([api('/locations'), loadReport()])
      .then(([data]) => setLocations(data.filter((item: Location) => item.activa)))
      .catch((reason) => setError(reason.message));
  }, []);

  async function runAnalysis() {
    setBusy(true);
    setError('');
    try {
      setAnalysis(
        await api('/analytics/run', {
          method: 'POST',
          body: JSON.stringify({ ...filters(), horizonWeeks: 4 }),
        }),
      );
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api('/analytics/query', {
        method: 'POST',
        body: JSON.stringify({ ...filters(), question }),
      });
      setAnswer(result.answer);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="reports-page">
      <div className="section-title reports-title">
        <span className="eyebrow">INTELIGENCIA COMERCIAL</span>
        <h1>
          Reportes que convierten datos en <em>decisiones.</em>
        </h1>
        <p>
          Ventas e inventario por período y ubicación, con predicciones estadísticas explicables.
        </p>
      </div>

      <div className="report-filters">
        <label>
          Desde
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
        <label>
          Sucursal o almacén
          <select value={location} onChange={(event) => setLocation(event.target.value)}>
            <option value="">Todas las ubicaciones autorizadas</option>
            {locations.map((item) => (
              <option value={item.id} key={item.id}>
                {item.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'} · {item.nombre}
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={busy} onClick={() => void loadReport()}>
          <RefreshCw size={16} /> Actualizar reporte
        </button>
      </div>

      {error && <div className="message error">{error}</div>}
      {report && (
        <>
          <div className="kpi-grid">
            <article>
              <span>Ventas brutas confirmadas</span>
              <strong>{money(report.kpis.ventas)}</strong>
            </article>
            <article>
              <span>Pedidos</span>
              <strong>{report.kpis.pedidos}</strong>
            </article>
            <article>
              <span>Unidades vendidas</span>
              <strong>{report.kpis.unidades}</strong>
            </article>
            <article>
              <span>Ticket promedio</span>
              <strong>{money(report.kpis.ticketPromedio)}</strong>
            </article>
          </div>
          <div className="report-summary">
            <BarChart3 size={24} />
            <div>
              <small>{report.generatedBy}</small>
              <p>{report.summary}</p>
            </div>
          </div>
          <div className="report-grid">
            <ReportTable
              title="Productos con mayores ventas"
              headers={['Producto', 'Unidades', 'Ventas']}
              empty="Sin ventas confirmadas"
            >
              {report.products.map((row) => (
                <tr key={row.variante_id}>
                  <td>
                    {row.producto}
                    <small>{row.sku}</small>
                  </td>
                  <td>{row.unidades}</td>
                  <td>{money(row.ventas)}</td>
                </tr>
              ))}
            </ReportTable>
            <ReportTable
              title="Ventas por ubicación"
              headers={['Ubicación', 'Pedidos', 'Ventas']}
              empty="Sin ventas por ubicación"
            >
              {report.locations.map((row) => (
                <tr key={row.ubicacion_id || 'none'}>
                  <td>{row.ubicacion || 'Venta sin ubicación'}</td>
                  <td>{row.pedidos}</td>
                  <td>{money(row.ventas)}</td>
                </tr>
              ))}
            </ReportTable>
            <ReportTable
              title="Desempeño por vendedor"
              headers={['Vendedor', 'Pedidos', 'Ventas']}
              empty="Sin ventas asignadas"
            >
              {report.sellers.map((row, index) => (
                <tr key={row.vendedor_id || index}>
                  <td>{row.vendedor || 'Sin vendedor'}</td>
                  <td>{row.pedidos}</td>
                  <td>{money(row.ventas)}</td>
                </tr>
              ))}
            </ReportTable>
            <ReportTable
              title="Inventario por ubicación"
              headers={['Ubicación', 'Disponible', 'Alertas']}
              empty="Sin inventario"
            >
              {report.inventory.map((row) => (
                <tr key={row.ubicacion_id}>
                  <td>
                    {row.ubicacion}
                    <small>Físico: {row.fisico}</small>
                  </td>
                  <td>{row.disponible}</td>
                  <td className={row.alertas ? 'alert-number' : ''}>{row.alertas}</td>
                </tr>
              ))}
            </ReportTable>
          </div>
        </>
      )}

      <section className="ai-panel">
        <div className="ai-heading">
          <div>
            <span className="eyebrow">ANÁLISIS EXPLICABLE</span>
            <h2>Predicción y recomendaciones</h2>
            <p>
              Usa ventas confirmadas, stock real, mínimos y plazo de reposición. No inventa datos
              cuando no existe historial.
            </p>
          </div>
          <button className="primary" disabled={busy} onClick={() => void runAnalysis()}>
            <Sparkles size={17} /> Generar análisis
          </button>
        </div>
        {analysis && (
          <>
            <div className="analysis-note">
              <Bot size={21} />
              <div>
                <b>{analysis.model.demand}</b>
                <p>{analysis.note}</p>
              </div>
            </div>
            <div className="analysis-columns">
              <div>
                <h3>Demanda proyectada</h3>
                {analysis.predictions.length ? (
                  analysis.predictions.slice(0, 12).map((row) => (
                    <article key={`${row.variante_id}-${row.fecha}`}>
                      <b>
                        {row.producto} · {row.sku}
                      </b>
                      <span>
                        {row.ubicacion} · semana {new Date(row.fecha).toLocaleDateString('es-BO')}
                      </span>
                      <strong>{row.cantidad.toFixed(1)} u.</strong>
                      <small>
                        Rango estimado: {row.limite_inferior.toFixed(1)}–
                        {row.limite_superior.toFixed(1)}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="muted">Sin historial confirmado suficiente.</p>
                )}
              </div>
              <div>
                <h3>Reposición y traslados</h3>
                {analysis.recommendations.length ? (
                  analysis.recommendations.map((row) => (
                    <article key={`${row.variante_id}-${row.destino}`}>
                      <b>
                        {row.tipo} · {row.producto}
                      </b>
                      <span>
                        {row.sku} hacia {row.destino}
                      </span>
                      <strong>{row.cantidad} u.</strong>
                      <small>{row.motivo.explicacion}</small>
                    </article>
                  ))
                ) : (
                  <p className="muted">El stock actual no requiere recomendaciones.</p>
                )}
              </div>
            </div>
            {analysis.anomalies.length > 0 && (
              <div className="anomaly-banner">
                <TriangleAlert size={20} /> Se detectaron {analysis.anomalies.length} ventas
                semanales atípicas para revisión.
              </div>
            )}
          </>
        )}
        <form className="analytics-question" onSubmit={ask}>
          <label htmlFor="commercial-question">Pregunta sobre tus datos</label>
          <div>
            <input
              id="commercial-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ej.: ¿Cuánto inventario disponible hay?"
            />
            <button disabled={busy || question.trim().length < 4}>
              <Send size={16} /> Consultar
            </button>
          </div>
          {answer && <p className="analytics-answer">{answer}</p>}
        </form>
      </section>
    </section>
  );
}

function ReportTable({
  title,
  headers,
  empty,
  children,
}: {
  title: string;
  headers: string[];
  empty: string;
  children: React.ReactNode;
}) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <article className="report-table">
      <h2>{title}</h2>
      {hasRows ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {headers.map((header) => (
                  <th key={header}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </article>
  );
}
