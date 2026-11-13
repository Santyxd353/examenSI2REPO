import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChartNoAxesCombined, Mic, Sparkles, Square } from 'lucide-react';
import {
  ReportDefinitionSchema,
  type ReportDataset,
  type ReportDefinition,
} from '@lumina/contracts';
import { validateReport } from '@lumina/reporting';
import { ApiError, offlineResponse } from '../api';
import { describeFilter } from './Filters';
import { fields, type ReportIdentity } from './report-data';

const audioLimit = 6 * 1024 * 1024;
const formats = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
type Suggestion = { explanation: string; definition: ReportDefinition | null };
type Recording = { media: MediaRecorder; stream: MediaStream; timer: number };
export function VoiceRequest({
  data,
  identity,
  prepare,
  apply,
  onBusy,
}: {
  data: ReportDataset | null;
  identity: ReportIdentity;
  prepare: (signal: AbortSignal) => Promise<ReportDataset>;
  apply: (definition: ReportDefinition) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<'TEXTO' | 'VOZ'>('TEXTO');
  const [state, setState] = useState<
    'idle' | 'permission' | 'recording' | 'transcribing' | 'preparing' | 'interpreting'
  >('idle');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const recording = useRef<Recording | null>(null);
  const intent = useRef<{ text: string; channel: string; datasetId: string; id: string } | null>(
    null,
  );

  useEffect(() => {
    onBusy(state !== 'idle');
    return () => onBusy(false);
  }, [state, onBusy]);

  useEffect(() => {
    setSuggestion((previous) =>
      previous?.definition?.datasetId === data?.datasetId ? previous : null,
    );
  }, [data?.datasetId]);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    return () => {
      controller.abort();
      const active = recording.current;
      if (active) {
        window.clearTimeout(active.timer);
        if (active.media.state !== 'inactive') active.media.stop();
        active.stream.getTracks().forEach((track) => track.stop());
        recording.current = null;
      }
    };
  }, []);

  async function transcribe(blob: Blob, signal: AbortSignal) {
    setState('transcribing');
    try {
      if (!blob.size || blob.size > audioLimit)
        throw new Error('Graba una consulta breve, de hasta 30 segundos.');
      const audio = new FormData();
      const mime = blob.type.split(';')[0];
      const extension = mime === 'audio/mp4' ? 'm4a' : mime === 'audio/ogg' ? 'ogg' : 'webm';
      audio.set('audio', new Blob([blob], { type: mime }), 'consulta.' + extension);
      const response = await offlineResponse(identity, '/api/reports/transcribe', {
        method: 'POST',
        body: audio,
        signal,
      });
      const result = await response.json();
      signal.throwIfAborted();
      if (typeof result.text !== 'string' || result.text.length > 1200)
        throw new Error('No se recibió una transcripción válida.');
      setText(result.text);
      setChannel('VOZ');
      setSuggestion(null);
      setMessage('Puedes corregir la transcripción antes de pedir la propuesta.');
    } catch (reason) {
      if (!signal.aborted) setError((reason as Error).message);
    } finally {
      if (!signal.aborted) setState('idle');
    }
  }

  async function start() {
    const signal = lifecycle.current?.signal;
    if (!signal || state !== 'idle') return;
    setError('');
    setMessage('');
    const mimeType =
      typeof MediaRecorder !== 'undefined' &&
      formats.find((format) => MediaRecorder.isTypeSupported(format));
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      setError('Este navegador no admite grabación. Escribe la consulta para continuar.');
      return;
    }
    setState('permission');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      signal.throwIfAborted();
      const media = new MediaRecorder(stream, { mimeType });
      const tracks = stream.getTracks();
      const chunks: Blob[] = [];
      const cleanup = () => {
        window.clearTimeout(timer);
        tracks.forEach((track) => track.stop());
        if (recording.current?.media === media) recording.current = null;
      };
      const timer = window.setTimeout(() => {
        if (media.state === 'recording') media.stop();
      }, 30_000);
      let failed = false;
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      media.onstop = () => {
        cleanup();
        if (!signal.aborted && !failed)
          void transcribe(new Blob(chunks, { type: media.mimeType }), signal);
      };
      media.onerror = () => {
        failed = true;
        cleanup();
        if (!signal.aborted) {
          setError('No se pudo completar la grabación. Puedes escribir la consulta.');
          setState('idle');
        }
      };
      recording.current = { media, stream, timer };
      media.start();
      setState('recording');
    } catch {
      const active = recording.current;
      if (active) {
        window.clearTimeout(active.timer);
        recording.current = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      if (!signal.aborted) {
        setError('El micrófono no está disponible. Puedes escribir la consulta.');
        setState('idle');
      }
    }
  }

  async function interpret(event: FormEvent) {
    event.preventDefault();
    const signal = lifecycle.current?.signal;
    const question = text.trim();
    if (!signal || state !== 'idle' || question.length < 4) return;
    setState(data ? 'interpreting' : 'preparing');
    setError('');
    setMessage('');
    setSuggestion(null);
    try {
      const dataset = await prepare(signal);
      signal.throwIfAborted();
      setState('interpreting');
      if (
        intent.current?.text !== question ||
        intent.current.channel !== channel ||
        intent.current.datasetId !== dataset.datasetId
      )
        intent.current = {
          text: question,
          channel,
          datasetId: dataset.datasetId,
          id: crypto.randomUUID(),
        };
      const response = await offlineResponse(identity, '/api/reports/interpret', {
        method: 'POST',
        body: JSON.stringify({
          text: question,
          datasetId: dataset.datasetId,
          operationId: intent.current.id,
          channel,
        }),
        signal,
      });
      const body = await response.json();
      signal.throwIfAborted();
      if (body.consultationId !== intent.current.id || typeof body.explanation !== 'string')
        throw new Error('No se recibió una propuesta válida.');
      const definition = ReportDefinitionSchema.nullable().parse(body.definition);
      if (definition && !validateReport(definition, dataset).ok)
        throw new Error('La propuesta quedó fuera del corte actual.');
      setSuggestion({ explanation: body.explanation, definition });
    } catch (reason) {
      if (signal.aborted) return;
      if (reason instanceof ApiError && reason.code !== 'REPORT_AI_IN_PROGRESS')
        intent.current = null;
      setError((reason as Error).message);
    } finally {
      if (!signal.aborted) setState('idle');
    }
  }

  return (
    <section
      className="report-panel report-control report-assistant"
      aria-label="Asistencia para reportes"
    >
      <div className="report-panel-title">
        <div>
          <p className="report-kicker">
            <Sparkles size={16} /> ASISTENTE IA
          </p>
          <h2>Tu reporte, con tus palabras</h2>
        </div>
        <span className="report-assistant-tag">Texto y voz</span>
      </div>
      <p>
        Escribe o dicta tu consulta. La IA propone los gráficos y filtros; las cifras se calculan
        con los datos de tu tienda. Revisa la propuesta y genera tu dashboard.
      </p>
      {!data && (
        <p className="report-assistant-hint">
          Prepararemos los datos del período seleccionado al enviar tu consulta.
        </p>
      )}
      <form onSubmit={interpret}>
        <label className="report-question">
          Consulta
          <textarea
            value={text}
            required
            minLength={4}
            maxLength={1200}
            rows={3}
            disabled={state !== 'idle'}
            placeholder="Ejemplo: ventas de vestidos por semana en el período descargado"
            onChange={(event) => {
              setText(event.target.value);
              setChannel('TEXTO');
              setSuggestion(null);
            }}
          />
        </label>
        <div className="report-toolbar">
          <button
            className="primary"
            type="submit"
            disabled={state !== 'idle' || text.trim().length < 4}
          >
            <Sparkles size={16} /> Consultar IA
          </button>
          {state === 'recording' ? (
            <button
              className="secondary"
              type="button"
              onClick={() => recording.current?.media.stop()}
            >
              <Square size={16} /> Detener grabación
            </button>
          ) : (
            <button className="secondary" type="button" disabled={state !== 'idle'} onClick={start}>
              <Mic size={16} /> Dictar consulta
            </button>
          )}
        </div>
      </form>
      <div className="report-assistant-examples" aria-label="Ejemplos de consultas">
        {[
          'Dashboard de ventas con barras por categoría, anillo por canal y evolución por día',
          '¿Cuáles son los productos más vendidos del período?',
          'Muéstrame el inventario disponible por sucursal',
        ].map((example) => (
          <button
            key={example}
            type="button"
            className="secondary"
            disabled={state !== 'idle'}
            onClick={() => {
              setText(example);
              setChannel('TEXTO');
              setSuggestion(null);
            }}
          >
            {example}
          </button>
        ))}
      </div>
      {state !== 'idle' && (
        <p role="status">
          {
            {
              permission: 'Esperando permiso del micrófono…',
              recording: 'Grabando hasta 30 segundos…',
              transcribing: 'Transcribiendo consulta…',
              preparing: 'Preparando los datos de tu tienda…',
              interpreting: 'La IA está diseñando tu reporte…',
            }[state]
          }
        </p>
      )}
      {error && (
        <p className="report-warning" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {suggestion && (
        <section className="report-criteria" aria-label="Propuesta para revisar">
          <p>{suggestion.explanation}</p>
          {suggestion.definition && (
            <>
              <strong>{suggestion.definition.title}</strong>
              <ul>
                <li>
                  Período {suggestion.definition.period.from} a {suggestion.definition.period.to}
                </li>
                <li>
                  Métricas · {suggestion.definition.metrics.map((key) => fields[key]).join(', ')}
                </li>
                {suggestion.definition.dimensions.length > 0 && (
                  <li>
                    Agrupación ·{' '}
                    {suggestion.definition.dimensions.map((key) => fields[key]).join(', ')}
                  </li>
                )}
                {suggestion.definition.filters.map((filter, index) => (
                  <li key={index}>{data && describeFilter(data, filter)}</li>
                ))}
                <li>
                  Gráficos ·{' '}
                  {[
                    suggestion.definition.chart,
                    ...suggestion.definition.dashboard.widgets.map((widget) => widget.chart),
                  ]
                    .map(
                      (chart) =>
                        ({
                          bar: 'Barras',
                          line: 'Línea',
                          area: 'Área',
                          donut: 'Anillo',
                          table: 'Tabla',
                        })[chart],
                    )
                    .join(' · ')}
                </li>
              </ul>
              <div className="report-toolbar report-assistant-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={!data || data.datasetId !== suggestion.definition.datasetId}
                  onClick={() => {
                    if (
                      !suggestion.definition ||
                      !data ||
                      !validateReport(suggestion.definition, data).ok
                    )
                      return;
                    apply(suggestion.definition);
                    setMessage(
                      'Dashboard generado con los datos del período. Puedes hacer otra consulta o exportarlo.',
                    );
                    window.requestAnimationFrame(() =>
                      document
                        .querySelector('.report-dashboard')
                        ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                    );
                  }}
                >
                  <ChartNoAxesCombined size={16} /> Generar dashboard
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
