import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { api } from '../../api';
import { randomUUID } from 'expo-crypto';

export function ReportAssistant() {
  const [text, setText] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const interpret = async (audioUri?: string) => {
    if (!text.trim() && !audioUri) return;
    setBusy(true); setNotice('');
    try {
      if (audioUri) { const body = new FormData(); body.append('audio', { uri: audioUri, name: 'consulta.m4a', type: 'audio/m4a' } as any); await api('/reports/transcribe', { method: 'POST', body }); }
      await api('/reports/interpret', { method: 'POST', body: JSON.stringify({ text: text.trim(), operationId: randomUUID() }) });
      setNotice('Propuesta recibida. Revísala antes de ejecutar o guardar.');
    } catch { setNotice('Asistencia de voz no disponible. Usa los filtros y el período manualmente; no se generó ninguna respuesta IA.'); }
    finally { setBusy(false); }
  };
  return <View style={{ marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e4dc', gap: 9 }}><Text style={{ color: '#173e2a', fontWeight: '900' }}>Asistente de reportes</Text><TextInput value={text} onChangeText={setText} placeholder="Ej.: ventas por sucursal este mes" style={{ borderWidth: 1, borderColor: '#d8ded8', borderRadius: 9, padding: 10, fontSize: 12 }} /><Text style={{ color: '#6a706c', fontSize: 10 }}>La dictación por micrófono está temporalmente desactivada mientras se valida la compatibilidad del dispositivo.</Text><Pressable disabled={busy || !text.trim()} onPress={() => void interpret()} style={{ minHeight: 40, borderRadius: 9, backgroundColor: '#173e2a', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 10 }}>{busy ? 'Consultando…' : 'Interpretar texto'}</Text></Pressable>{notice ? <Text style={{ color: '#6a706c', fontSize: 10 }}>{notice}</Text> : null}</View>;
}
