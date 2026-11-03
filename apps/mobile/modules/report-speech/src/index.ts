import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeReportSpeech = { recognize(): Promise<string>; cancel(): void };
let nativeSpeech: NativeReportSpeech | null | undefined;

function module() {
  if (Platform.OS !== 'android') throw new Error('La dictación de reportes está disponible para Android.');
  const found = nativeSpeech ??= requireOptionalNativeModule<NativeReportSpeech>('VestidorReportSpeech');
  if (!found) throw new Error('Instala la versión Android actualizada para usar la dictación.');
  return found;
}

export function isReportSpeechAvailable() {
  return Platform.OS === 'android' && !!(nativeSpeech ??= requireOptionalNativeModule<NativeReportSpeech>('VestidorReportSpeech'));
}

export function recognizeReportSpeech() {
  return module().recognize();
}

export function cancelReportSpeech() {
  nativeSpeech?.cancel();
}
