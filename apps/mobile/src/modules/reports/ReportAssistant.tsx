import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { ApiProblem } from '../../errors/ApiProblem';
import { VoiceQueryButton } from './VoiceQueryButton';
import type { OfflineDashboardReport } from './offlineReport';
import { askOfflineReport } from './offlineReportAssistant';
import { QueryDashboard } from './QueryDashboard';
import type { ReportChart } from '../../../../api/src/report-dashboard';

type Props = { from: string; to: string; offlineReport?: OfflineDashboardReport | null };
type AgentAnswer = {
  provider: 'openai' | 'gemini' | 'groq';
  answer: string;
  dashboard: ReportChart[];
};

export function ReportAssistant({ from, to, offlineReport }: Props) {
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [charts, setCharts] = useState<ReportChart[]>([]);
  const requestId = useRef(0);
  useEffect(() => {
    requestId.current++;
    setNotice('');
    setCharts([]);
    setBusy(false);
    return () => {
      requestId.current++;
    };
  }, [from, to]);
  const interpret = async (question = text) => {
    if (!question.trim()) return;
    const id = ++requestId.current;
    setBusy(true);
    setNotice('');
    setCharts([]);
    try {
      const body = JSON.stringify({ question: question.trim(), from, to });
      const result = await api<AgentAnswer>('/analytics/assistant/query', { method: 'POST', body });
      if (id !== requestId.current) return;
      const providerName = { groq: 'Groq', gemini: 'Gemini', openai: 'OpenAI' }[result.provider];
      setNotice('IA · ' + providerName + ': ' + result.answer);
      setCharts(result.dashboard);
    } catch (error) {
      if (id !== requestId.current) return;
      if (ApiProblem.isNetwork(error) && offlineReport) {
        setNotice(`Modo offline: ${askOfflineReport(offlineReport, question).answer}`);
      } else
        setNotice(
          error instanceof Error ? error.message : 'No fue posible consultar el asistente.',
        );
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };
  return (
    <View
      testID="qa-report-assistant"
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 14,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e5e4dc',
        gap: 9,
      }}
    >
      <Text style={{ color: '#173e2a', fontWeight: '900' }}>Asistente de reportes</Text>
      <TextInput
        testID="qa-report-question"
        accessibilityLabel="Pregunta para el asistente"
        value={text}
        onChangeText={setText}
        placeholder="Ej.: ¿qué sucursal vendió más este mes?"
        style={{
          borderWidth: 1,
          borderColor: '#d8ded8',
          borderRadius: 9,
          padding: 10,
          fontSize: 12,
        }}
      />
      <Text style={{ color: '#6a706c', fontSize: 10 }}>
        Describe qué quieres analizar y cómo quieres verlo. Puedes indicar período, sucursal,
        prendas y tipo de gráfico.
      </Text>
      <VoiceQueryButton
        onText={(spoken) => {
          setText(spoken);
          void interpret(spoken);
        }}
        onError={setNotice}
      />
      <Pressable
        testID="qa-report-submit"
        accessibilityLabel="Preguntar al asistente"
        disabled={busy || !text.trim()}
        onPress={() => void interpret()}
        style={{
          minHeight: 40,
          borderRadius: 9,
          backgroundColor: '#173e2a',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: 10 }}>
          {busy ? 'Consultando…' : 'Preguntar al asistente'}
        </Text>
      </Pressable>
      {notice ? (
        <Text testID="qa-report-answer" style={{ color: '#6a706c', fontSize: 10, lineHeight: 15 }}>
          {notice}
        </Text>
      ) : null}
      {charts.length > 0 && <QueryDashboard key={notice} charts={charts} />}
    </View>
  );
}
