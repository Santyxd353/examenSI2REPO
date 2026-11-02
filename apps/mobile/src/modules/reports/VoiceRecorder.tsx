import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

export function VoiceRecorder({ onReady, onError }: { onReady: (uri: string) => void; onError: (message: string) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => { if (recorder.isRecording) void recorder.stop(); }, [recorder]);
  const toggle = async () => {
    setBusy(true);
    try {
      if (recorder.isRecording) { await recorder.stop(); if (!recorder.uri) throw new Error('No se pudo guardar el audio.'); onReady(recorder.uri); return; }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Permite el micrófono para dictar una consulta.');
      await recorder.prepareToRecordAsync(); recorder.record();
    } catch (error) { onError(error instanceof Error ? error.message : 'No se pudo grabar el audio.'); } finally { setBusy(false); }
  };
  return <View><Pressable accessibilityRole="button" disabled={busy} onPress={() => void toggle()} style={{ minHeight: 42, borderRadius: 10, backgroundColor: recorder.isRecording ? '#9f382d' : '#e7f0e8', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: recorder.isRecording ? '#fff' : '#173e2a', fontWeight: '900', fontSize: 10 }}>{recorder.isRecording ? `Detener grabación · ${Math.round(state.durationMillis / 1000)} s` : 'Dictar consulta'}</Text></Pressable></View>;
}
