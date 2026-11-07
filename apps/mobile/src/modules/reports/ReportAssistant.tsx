import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import type { ReportDataset, ReportDefinition } from '@lumina/contracts';
import { api, captureSessionScope, isCurrentSessionScope } from '../../api';
import { VoiceRecorder } from './VoiceRecorder';
import { validateMobileProposal } from './reportProposal';
import { reportLabels } from './reportLabels';

export function ReportAssistant({
  dataset,
  review,
  enabled,
}: {
  dataset: ReportDataset;
  review: (definition: ReportDefinition) => void;
  enabled: boolean;
}) {
  const [text, setText] = useState(''),
    [channel, setChannel] = useState<'TEXTO' | 'VOZ'>('TEXTO'),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<ReturnType<typeof validateMobileProposal> | null>(
    null,
  );
  const intent = useRef<{ text: string; channel: string; dataset: string; id: string } | null>(
    null,
  );
  const interpret = async () => {
    const session = captureSessionScope();
    setBusy(true);
    setNotice('');
    setSuggestion(null);
    try {
      if (!enabled)
        throw new Error(
          'El asistente requiere conexión y un plan Profesional o Negocio. Usa los filtros manuales.',
        );
      const question = text.trim();
      if (question.length < 4)
        throw new Error('Describe el reporte con al menos cuatro caracteres.');
      if (
        intent.current?.text !== question ||
        intent.current.channel !== channel ||
        intent.current.dataset !== dataset.datasetId
      )
        intent.current = { text: question, channel, dataset: dataset.datasetId, id: randomUUID() };
      const raw = await api<unknown>('/reports/interpret', {
        method: 'POST',
        body: JSON.stringify({
          operationId: intent.current.id,
          datasetId: dataset.datasetId,
          text: question,
          channel,
        }),
      });
      const proposed = validateMobileProposal(raw, dataset);
      if (isCurrentSessionScope(session)) setSuggestion(proposed);
    } catch (error) {
      if (isCurrentSessionScope(session)) setNotice((error as Error).message);
    } finally {
      if (isCurrentSessionScope(session)) setBusy(false);
    }
  };
  const transcribe = async (uri: string) => {
    const session = captureSessionScope();
    setBusy(true);
    setNotice('');
    const file = new File(uri);
    try {
      if (!file.exists || !file.size || file.size > 6 * 1024 * 1024)
        throw new Error('Graba una consulta de hasta 30 segundos y 6 MiB.');
      const audio = new FormData();
      audio.append('audio', { uri, name: 'consulta.m4a', type: 'audio/mp4' } as unknown as Blob);
      const response = await api<{ text: string }>('/reports/transcribe', {
        method: 'POST',
        body: audio,
      });
      if (typeof response.text !== 'string' || response.text.length > 1200)
        throw new Error('No se recibió una transcripción válida.');
      if (isCurrentSessionScope(session)) {
        setText(response.text);
        setChannel('VOZ');
        setSuggestion(null);
        setNotice('Corrige la transcripción antes de pedir la propuesta.');
      }
    } catch (error) {
      if (isCurrentSessionScope(session)) setNotice((error as Error).message);
    } finally {
      if (file.exists) file.delete();
      if (isCurrentSessionScope(session)) setBusy(false);
    }
  };
  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        backgroundColor: '#fff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#dce4da',
      }}
    >
      <Text style={{ color: '#173e2a', fontSize: 15, fontWeight: '900' }}>
        Asistente de reportes
      </Text>
      <Text style={{ color: '#617268', fontSize: 11 }}>
        La IA propone filtros. Revisa la propuesta y después aplica el reporte. Sin conexión puedes
        usar todos los filtros del corte descargado.
      </Text>
      <TextInput
        accessibilityLabel="Solicitud del reporte"
        multiline
        maxLength={1200}
        value={text}
        onChangeText={(value) => {
          setText(value);
          setSuggestion(null);
          setChannel('TEXTO');
        }}
        placeholder="Ej. ventas de vestidos por ubicación este mes"
        style={{
          minHeight: 60,
          padding: 10,
          borderWidth: 1,
          borderColor: '#dce4da',
          borderRadius: 8,
        }}
      />
      {enabled && !busy ? (
        <VoiceRecorder onReady={(uri) => void transcribe(uri)} onError={setNotice} />
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !enabled}
        onPress={() => void interpret()}
        style={{ padding: 12, borderRadius: 9, backgroundColor: enabled ? '#173e2a' : '#a8b5aa' }}
      >
        <Text style={{ color: '#fff', fontWeight: '800' }}>
          {busy ? 'Preparando…' : 'Pedir propuesta'}
        </Text>
      </Pressable>
      {notice ? <Text style={{ color: '#725336', fontSize: 11 }}>{notice}</Text> : null}
      {suggestion ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: '#294332' }}>{suggestion.explanation}</Text>
          {suggestion.definition ? (
            <>
              <Text style={{ fontSize: 11, color: '#617268' }}>
                Período: {suggestion.definition.period.from} — {suggestion.definition.period.to}
                {'\n'}Métricas:{' '}
                {suggestion.definition.metrics.map((metric) => reportLabels[metric]).join(', ')}
                {'\n'}Filtros: {suggestion.definition.filters.length}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => review(suggestion.definition!)}
                style={{ padding: 12, borderWidth: 1, borderColor: '#315f48', borderRadius: 9 }}
              >
                <Text style={{ color: '#173e2a', fontWeight: '800' }}>Revisar en los filtros</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
