import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Identity } from './types';
import { getOfflineDeviceId } from './offline/device';
import { openOfflineDatabase } from './offline/db';
import { SQLiteIntentRepository } from './offline/sqliteIntentRepository';
import { syncOfflineQueue } from './offline/syncQueue';
import type { OfflineIntent } from './offline/intentRepository';

export function SyncScreen({ user }: { user: Identity }) {
  const [items, setItems] = useState<OfflineIntent[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const scope = useCallback(async () => user.tenant ? ({ tenantId: user.tenant.id, actorId: user.id, deviceId: await getOfflineDeviceId() }) : null, [user]);
  const load = useCallback(async () => { const current = await scope(); if (!current) return; setItems(await new SQLiteIntentRepository(await openOfflineDatabase()).listIntents(current)); }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const send = async () => { setBusy(true); setError(''); try { const current = await scope(); if (!current) throw new Error('Falta la tienda de la sesión.'); await syncOfflineQueue(new SQLiteIntentRepository(await openOfflineDatabase()), current); await load(); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } };
  const counts = items.reduce<Record<string, number>>((all, item) => ({ ...all, [item.state]: (all[item.state] || 0) + 1 }), {});
  return <ScrollView contentContainerStyle={styles.page}><Text style={styles.title}>Sincronización</Text><Text style={styles.hint}>Las operaciones se mantienen por tienda, usuario y dispositivo.</Text>
    {Object.entries(counts).map(([state, count]) => <View key={state} style={styles.row}><Text>{state}</Text><Text style={styles.count}>{count}</Text></View>)}
    {!items.length ? <Text style={styles.hint}>No hay operaciones offline pendientes.</Text> : null}
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable disabled={busy} onPress={() => void send()} style={styles.button}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sincronizar ahora</Text>}</Pressable>
    {items.filter((item) => item.state === 'CONFLICT' || item.state === 'BLOCKED').map((item) => <View key={item.operationId} style={styles.conflict}><Text style={styles.conflictTitle}>{item.state}: {item.kind}</Text><Text selectable>{item.operationId}</Text></View>)}
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { padding: 20, gap: 12 }, title: { color: '#173e2a', fontSize: 26, fontWeight: '900' }, hint: { color: '#59635d', lineHeight: 20 }, row: { backgroundColor: '#fff', borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', padding: 14 }, count: { color: '#173e2a', fontWeight: '900' }, button: { backgroundColor: '#173e2a', borderRadius: 10, alignItems: 'center', padding: 13 }, buttonText: { color: '#fff', fontWeight: '800' }, error: { color: '#9a2e2e' }, conflict: { backgroundColor: '#fff2e5', borderRadius: 12, padding: 12, gap: 4 }, conflictTitle: { color: '#8a4d0e', fontWeight: '800' } });
