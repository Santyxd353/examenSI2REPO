import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { Identity } from './types';
import { getOfflineDeviceId } from './offline/device';
import { openOfflineDatabase } from './offline/db';
import { SQLiteIntentRepository } from './offline/sqliteIntentRepository';
import { syncOfflineQueue } from './offline/syncQueue';
import type { OfflineIntent } from './offline/intentRepository';

const stateLabels: Record<string, string> = { PENDING: 'Pendientes', SENDING: 'Enviando', CONFLICT: 'Conflictos', BLOCKED: 'Bloqueadas', SYNCED: 'Completadas' };

export function SyncScreen({ user }: { user: Identity }) {
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<OfflineIntent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = useCallback(async () => user.tenant ? ({ tenantId: user.tenant.id, actorId: user.id, deviceId: await getOfflineDeviceId() }) : null, [user]);
  const load = useCallback(async () => {
    const current = await scope();
    if (!current) return;
    setItems(await new SQLiteIntentRepository(await openOfflineDatabase()).listIntents(current));
  }, [scope]);
  useEffect(() => { void load(); }, [load]);
  const send = async () => {
    setBusy(true); setError('');
    try {
      const current = await scope();
      if (!current) throw new Error('Falta la tienda de la sesión.');
      await syncOfflineQueue(new SQLiteIntentRepository(await openOfflineDatabase()), current);
      await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const counts = useMemo(() => items.reduce<Record<string, number>>((all, item) => ({ ...all, [item.state]: (all[item.state] || 0) + 1 }), {}), [items]);
  const pending = (counts.PENDING || 0) + (counts.SENDING || 0) + (counts.BLOCKED || 0);
  const conflicts = counts.CONFLICT || 0;

  return <ScrollView
    contentContainerStyle={[styles.page, width >= 720 && styles.pageWide]}
    refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void load()} tintColor="#173e2a" />}
  >
    <View style={styles.heading}><View><Text style={styles.eyebrow}>MODO OFFLINE</Text><Text style={styles.title}>Sincronización</Text></View><View style={styles.readyBadge}><View style={styles.readyDot} /><Text style={styles.readyText}>LISTO</Text></View></View>
    <Text style={styles.intro}>Tus operaciones se guardan por tienda, usuario y dispositivo antes de enviarse al servidor.</Text>
    <View style={styles.hero}>
      <Text style={styles.heroLabel}>COLA DEL DISPOSITIVO</Text>
      <Text style={styles.heroNumber}>{pending}</Text>
      <Text style={styles.heroCopy}>{pending === 1 ? 'operación pendiente de sincronizar' : 'operaciones pendientes de sincronizar'}</Text>
      <Pressable testID="qa-sync-now" accessibilityLabel="Sincronizar ahora" accessibilityRole="button" disabled={busy} onPress={() => void send()} style={[styles.button, busy && styles.buttonBusy]}>{busy ? <ActivityIndicator color="#173e2a" /> : <Text style={styles.buttonText}>Sincronizar ahora  →</Text>}</Pressable>
    </View>
    <View style={styles.sectionHeading}><Text style={styles.section}>Estado de la cola</Text><Text style={styles.sectionHint}>{items.length} REGISTROS</Text></View>
    <View style={styles.stats}>
      {Object.entries(counts).length ? Object.entries(counts).map(([state, count]) => <View key={state} style={[styles.stat, state === 'CONFLICT' && styles.statWarning]}><Text style={styles.statLabel}>{stateLabels[state] || state}</Text><Text style={styles.statValue}>{count}</Text></View>) : <View style={styles.empty}><Text style={styles.emptyIcon}>✓</Text><Text style={styles.emptyTitle}>Todo está sincronizado</Text><Text style={styles.emptyCopy}>No hay operaciones offline pendientes.</Text></View>}
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {conflicts > 0 ? <View style={styles.conflictBanner}><Text style={styles.conflictTitle}>Hay {conflicts} {conflicts === 1 ? 'conflicto que requiere' : 'conflictos que requieren'} revisión</Text><Text style={styles.conflictCopy}>Estas operaciones no se enviarán hasta que se resuelva el conflicto en el sistema.</Text></View> : null}
    {items.filter((item) => item.state === 'CONFLICT' || item.state === 'BLOCKED').map((item) => <View key={item.operationId} style={styles.issue}><View><Text style={styles.issueTitle}>{item.state === 'CONFLICT' ? 'Conflicto detectado' : 'Operación bloqueada'}</Text><Text style={styles.issueCopy}>{item.kind}</Text></View><Text style={styles.issueId}>{item.operationId.slice(0, 8)}</Text></View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 46, gap: 14, flexGrow: 1, backgroundColor: '#fbfaf6' }, pageWide: { width: 720, alignSelf: 'center' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { color: '#748278', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }, title: { color: '#173e2a', fontSize: 29, fontWeight: '900', marginTop: 3 }, intro: { color: '#607066', fontSize: 12, lineHeight: 18, maxWidth: 390 },
  readyBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 13, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: '#e6f0e7' }, readyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4e9167' }, readyText: { color: '#2f7047', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  hero: { borderRadius: 18, padding: 18, backgroundColor: '#173e2a' }, heroLabel: { color: '#b9cebd', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 }, heroNumber: { color: '#fff', fontSize: 42, fontWeight: '900', marginTop: 5 }, heroCopy: { color: '#d9e6db', fontSize: 11 }, button: { alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 11, marginTop: 17 }, buttonBusy: { minWidth: 145, alignItems: 'center' }, buttonText: { color: '#173e2a', fontWeight: '900', fontSize: 11 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 5 }, section: { color: '#1b2920', fontSize: 17, fontWeight: '900' }, sectionHint: { color: '#909991', fontSize: 8, fontWeight: '900', letterSpacing: 1 }, stats: { gap: 9 }, stat: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7e2', borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 }, statWarning: { borderColor: '#ecd4aa', backgroundColor: '#fff9ef' }, statLabel: { color: '#556258', fontSize: 11, fontWeight: '700' }, statValue: { color: '#173e2a', fontSize: 19, fontWeight: '900' },
  empty: { alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#cfd8d0', borderRadius: 14, padding: 27 }, emptyIcon: { color: '#4e9167', fontSize: 28, fontWeight: '900' }, emptyTitle: { color: '#294032', fontWeight: '900', marginTop: 5 }, emptyCopy: { color: '#79837b', fontSize: 10, marginTop: 4 }, error: { color: '#9a2e2e', backgroundColor: '#fff0ec', borderRadius: 10, padding: 12 }, conflictBanner: { borderRadius: 13, padding: 14, backgroundColor: '#fff4df', borderWidth: 1, borderColor: '#eed9aa' }, conflictTitle: { color: '#80530f', fontSize: 11, fontWeight: '900' }, conflictCopy: { color: '#8c7043', fontSize: 10, lineHeight: 15, marginTop: 4 }, issue: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#eadfca', borderRadius: 12, padding: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, issueTitle: { color: '#533c20', fontSize: 11, fontWeight: '900' }, issueCopy: { color: '#8d816e', fontSize: 9, marginTop: 3 }, issueId: { color: '#9a8c75', fontFamily: 'monospace', fontSize: 10 },
});
