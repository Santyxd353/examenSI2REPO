import { PermissionsAndroid, Platform, Pressable, Text } from 'react-native';
import { useState } from 'react';
import { isReportSpeechAvailable, recognizeReportSpeech } from '../../../modules/report-speech/src';

export function VoiceQueryButton({ onText, onError }: { onText: (text: string) => void; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!isReportSpeechAvailable()) return null;
  const dictate = async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Permite el micrófono para dictar una consulta.');
      }
      onText(await recognizeReportSpeech());
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No fue posible dictar la consulta.');
    } finally {
      setBusy(false);
    }
  };
  return <Pressable accessibilityRole="button" disabled={busy} onPress={() => void dictate()} style={{ minHeight: 40, borderRadius: 9, backgroundColor: '#e7f0e8', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#173e2a', fontWeight: '900', fontSize: 10 }}>{busy ? 'Escuchando…' : 'Dictar consulta'}</Text></Pressable>;
}
