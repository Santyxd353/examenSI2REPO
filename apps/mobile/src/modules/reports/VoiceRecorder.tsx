import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';

export function VoiceRecorder({
  onReady,
  onError,
}: {
  onReady: (uri: string) => void;
  onError: (message: string) => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    active = useRef(true),
    finishing = useRef(false);
  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimer();
      if (recorder.isRecording) void recorder.stop();
    };
  }, [recorder]);
  const finish = async () => {
    if (finishing.current) return;
    finishing.current = true;
    clearTimer();
    try {
      if (recorder.isRecording) await recorder.stop();
      if (!recorder.uri) throw new Error('No se pudo guardar el audio.');
      if (active.current) onReady(recorder.uri);
    } finally {
      finishing.current = false;
    }
  };
  const toggle = async () => {
    setBusy(true);
    try {
      if (recorder.isRecording) {
        await finish();
        return;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Permite el micrófono para dictar una consulta.');
      await recorder.prepareToRecordAsync();
      if (!active.current) return;
      recorder.record({ forDuration: 30 });
      timer.current = setTimeout(() => {
        void finish().catch((error) => {
          if (active.current) onError((error as Error).message);
        });
      }, 30000);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudo grabar el audio.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void toggle()}
        style={{
          minHeight: 42,
          borderRadius: 10,
          backgroundColor: recorder.isRecording ? '#9f382d' : '#e7f0e8',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: recorder.isRecording ? '#fff' : '#173e2a',
            fontWeight: '900',
            fontSize: 10,
          }}
        >
          {recorder.isRecording
            ? `Detener grabación · ${Math.round(state.durationMillis / 1000)} s`
            : 'Dictar consulta'}
        </Text>
      </Pressable>
    </View>
  );
}
