import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';

type Subscription = {
  subscription?: { planName: string; status: string; periodEnd: string | null; limits: Record<string, number> };
  usage: { locations: number; products: number; staff: number };
  trial: { active: boolean; endsAt: string | null };
};
const labels = { locations: 'Ubicaciones', products: 'Productos', staff: 'Equipo activo' } as const;

export function BusinessScreen() {
  const [data, setData] = useState<Subscription | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await api<Subscription>('/tenant/subscription')); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading && !data) return <View style={styles.center}><ActivityIndicator color="#173e2a" /></View>;
  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.title}>Mi negocio</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {data?.subscription ? <>
      <View style={styles.card}>
        <Text style={styles.caption}>PLAN ACTUAL</Text><Text style={styles.plan}>{data.subscription.planName}</Text>
        <Text style={styles.detail}>{data.trial.active ? 'Prueba activa' : data.subscription.status}</Text>
        {data.trial.endsAt || data.subscription.periodEnd ? <Text style={styles.detail}>Vence: {new Date(data.trial.endsAt || data.subscription.periodEnd || '').toLocaleDateString('es-BO')}</Text> : null}
      </View>
      <Text style={styles.section}>Consumo</Text>
      {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => {
        const limit = data.subscription?.limits[key]; const used = data.usage[key];
        return <View key={key} style={styles.row}><Text style={styles.rowLabel}>{labels[key]}</Text><Text style={styles.rowValue}>{limit === undefined ? `${used}` : `${used} / ${limit}`}</Text></View>;
      })}
    </> : null}
    <Pressable onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>Actualizar</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({
  page: { padding: 20, gap: 12 }, center: { flex: 1, justifyContent: 'center' }, title: { color: '#173e2a', fontSize: 26, fontWeight: '900' },
  card: { backgroundColor: '#e8eee5', borderRadius: 16, padding: 18, gap: 5 }, caption: { color: '#5c665d', fontSize: 10, fontWeight: '800' }, plan: { color: '#173e2a', fontSize: 21, fontWeight: '900' }, detail: { color: '#526052', fontSize: 13 },
  section: { color: '#173e2a', fontSize: 16, fontWeight: '800', marginTop: 8 }, row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 12, padding: 14 }, rowLabel: { color: '#4d574f' }, rowValue: { color: '#173e2a', fontWeight: '800' },
  button: { alignSelf: 'flex-start', backgroundColor: '#173e2a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }, buttonText: { color: '#fff', fontWeight: '800' }, error: { color: '#9a2e2e' },
});
