import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { ApiProblem } from '../../errors/ApiProblem';
import { VoiceQueryButton } from './VoiceQueryButton';

type Props = { from: string; to: string };
type AgentAnswer = { provider: 'openai'; answer: string };
type LocalAnswer = { intent: string; answer: string };

export function ReportAssistant({ from, to }: Props) {
  const [text, setText] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const interpret = async (question = text) => {
    if (!question.trim()) return;
    setBusy(true); setNotice('');
    try {
      const body = JSON.stringify({ question: question.trim(), from, to });
      try {
        const result = await api<AgentAnswer>('/analytics/agent/query', { method: 'POST', body });
        setNotice(result.answer);
      } catch (error) {
        if (!(error instanceof ApiProblem) || error.status !== 503) throw error;
        const local = await api<LocalAnswer>('/analytics/query', { method: 'POST', body });
        setNotice(`Modo local: ${local.answer}`);
      }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No fue posible consultar el asistente.'); }
    finally { setBusy(false); }
  };
  return <View testID="qa-report-assistant" style={{ marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e4dc', gap: 9 }}><Text style={{ color: '#173e2a', fontWeight: '900' }}>Asistente de reportes</Text><TextInput testID="qa-report-question" accessibilityLabel="Pregunta para el asistente" value={text} onChangeText={setText} placeholder="Ej.: ¿qué sucursal vendió más este mes?" style={{ borderWidth: 1, borderColor: '#d8ded8', borderRadius: 9, padding: 10, fontSize: 12 }} /><Text style={{ color: '#6a706c', fontSize: 10 }}>Solo consulta datos autorizados del período visible; no modifica ventas ni inventario.</Text><VoiceQueryButton onText={(spoken) => { setText(spoken); void interpret(spoken); }} onError={setNotice} /><Pressable testID="qa-report-submit" accessibilityLabel="Preguntar al asistente" disabled={busy || !text.trim()} onPress={() => void interpret()} style={{ minHeight: 40, borderRadius: 9, backgroundColor: '#173e2a', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 10 }}>{busy ? 'Consultando…' : 'Preguntar al asistente'}</Text></Pressable>{notice ? <Text testID="qa-report-answer" style={{ color: '#6a706c', fontSize: 10, lineHeight: 15 }}>{notice}</Text> : null}</View>;
}
