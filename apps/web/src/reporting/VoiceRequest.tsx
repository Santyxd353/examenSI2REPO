import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Mic, Square } from 'lucide-react';
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
  review,
}: {
  data: ReportDataset;
  identity: ReportIdentity;
  review: (definition: ReportDefinition) => void;
}) {
  const [text, setText] = useState('');
  const [channel, setChannel] = useState<'TEXTO' | 'VOZ'>('TEXTO');
  const [state, setState] = useState<
    'idle' | 'permission' | 'recording' | 'transcribing' | 'interpreting'
  >('idle');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const lifecycle = useRef<AbortController | null>(null);
  const recording = useRef<Recording | null>(null);
  const intent = useRef<{ text: string; channel: string; id: string } | null>(null);

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
    setState('interpreting');
    setError('');
    setMessage('');
    setSuggestion(null);
    if (intent.current?.text !== question || intent.current.channel !== channel)
      intent.current = { text: question, channel, id: crypto.randomUUID() };
    try {
      const response = await offlineResponse(identity, '/api/reports/interpret', {
        method: 'POST',
        body: JSON.stringify({
          text: question,
          datasetId: data.datasetId,
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
      if (definition && !validateReport(definition, data).ok)
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
    <section className="report-panel report-control" aria-label="Asistencia para reportes">
      <h2>Asistencia para reportes</h2>
      <p>
        Describe el reporte que buscas. Revisa el período, las métricas y los filtros sugeridos
        antes de aplicarlos.
      </p>
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
            Proponer diseño
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
      {state !== 'idle' && (
        <p role="status">
          {
            {
              permission: 'Esperando permiso del micrófono…',
              recording: 'Grabando hasta 30 segundos…',
              transcribing: 'Transcribiendo consulta…',
              interpreting: 'Preparando la propuesta…',
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
                  <li key={index}>{describeFilter(data, filter)}</li>
                ))}
              </ul>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (!suggestion.definition) return;
                  review(suggestion.definition);
                  setMessage('La propuesta está en el formulario. Revisa y aplica los cambios.');
                  document.getElementById('report-settings')?.scrollIntoView({ block: 'start' });
                }}
              >
                Pasar al formulario
              </button>
            </>
          )}
        </section>
      )}
    </section>
  );
}
