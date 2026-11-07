import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { api } from './api';
import { businessSubscriptionView } from './modules/businessSubscription';

type Subscription = ReturnType<typeof businessSubscriptionView>;

const labels = {
  locations: 'Ubicaciones',
  products: 'Productos',
  staff: 'Equipo activo',
  avatars: 'Avatares del período',
  savedReports: 'Reportes guardados',
  ai: 'Consultas IA del período',
} as const;

export function BusinessScreen() {
  const { width } = useWindowDimensions();
  const [data, setData] = useState<Subscription | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(businessSubscriptionView(await api<unknown>('/tenant/subscription')));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  if (loading && !data)
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#173e2a" />
      </View>
    );
  const endingAt = data?.trial.endsAt || data?.subscription?.periodEnd;

  return (
    <ScrollView
      contentContainerStyle={[styles.page, width >= 720 && styles.pageWide]}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#173e2a" />
      }
    >
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>ADMINISTRACIÓN</Text>
          <Text style={styles.title}>Mi negocio</Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.refresh} onPress={() => void load()}>
          <Text style={styles.refreshText}>↻</Text>
        </Pressable>
      </View>
      <Text style={styles.intro}>
        Consulta el plan, los límites y el consumo actual de tu tienda.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data?.subscription ? (
        <>
          <View style={styles.planCard}>
            <View style={styles.planTop}>
              <View>
                <Text style={styles.caption}>PLAN ACTUAL</Text>
                <Text style={styles.plan}>{data.subscription.planName}</Text>
              </View>
              <View style={styles.status}>
                <Text style={styles.statusText}>
                  {data.trial.active ? 'PRUEBA' : data.subscription.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.planDivider} />
            <Text style={styles.planDetail}>
              {data.readOnly
                ? 'El plan está en solo lectura.'
                : data.trial.active
                  ? 'Tu período de prueba está activo.'
                  : 'Tu suscripción se encuentra activa.'}{' '}
              · Bs {(data.priceMinor / 100).toFixed(2)} / mes
            </Text>
            {endingAt ? (
              <Text style={styles.planDate}>
                Próxima fecha:{' '}
                {new Date(endingAt).toLocaleDateString('es-BO', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </Text>
            ) : null}
          </View>
          <View style={styles.sectionHeading}>
            <Text style={styles.section}>Uso del plan</Text>
            <Text style={styles.sectionHint}>ACTUALIZADO AHORA</Text>
          </View>
          <View style={styles.usageGrid}>
            {(Object.keys(labels) as (keyof typeof labels)[]).map((key) => {
              const limit = data.subscription?.limits[key];
              const used = data.usage[key];
              const percent =
                limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              return (
                <View key={key} style={styles.usageCard}>
                  <View style={styles.usageTop}>
                    <Text style={styles.usageLabel}>{labels[key]}</Text>
                    <Text style={styles.usageValue}>
                      {limit === undefined ? used : `${used} / ${limit}`}
                    </Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${percent}%` }]} />
                  </View>
                  <Text style={styles.usageNote}>
                    {`${percent}% del límite utilizado`}
                    {key === 'avatars' || key === 'ai' ? ' · Incluye reservas pendientes.' : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Aún no hay un plan asignado</Text>
          <Text style={styles.emptyCopy}>
            Actualiza la información o revisa la configuración de la tienda.
          </Text>
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.button}>
        <Text style={styles.buttonText}>Actualizar información</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 46, gap: 14, backgroundColor: '#fbfaf6', flexGrow: 1 },
  pageWide: { width: 720, alignSelf: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fbfaf6' },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#748278', fontSize: 9, letterSpacing: 1.5, fontWeight: '900' },
  title: { color: '#173e2a', fontSize: 29, fontWeight: '900', marginTop: 3 },
  intro: { color: '#607066', fontSize: 12, lineHeight: 18, maxWidth: 360 },
  refresh: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dfe4de',
    backgroundColor: '#fff',
  },
  refreshText: { color: '#173e2a', fontSize: 22 },
  planCard: { backgroundColor: '#173e2a', borderRadius: 18, padding: 18 },
  planTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  caption: { color: '#bed2c3', fontSize: 9, letterSpacing: 1.4, fontWeight: '900' },
  plan: { color: '#fff', fontSize: 25, fontWeight: '900', marginTop: 6 },
  status: {
    backgroundColor: '#ffffff1c',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff38',
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  statusText: { color: '#e4f2e4', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  planDivider: { height: 1, backgroundColor: '#ffffff26', marginVertical: 15 },
  planDetail: { color: '#e1ebe2', fontSize: 12 },
  planDate: { color: '#b8ccb9', fontSize: 10, marginTop: 7 },
  sectionHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 6,
  },
  section: { color: '#1b2920', fontSize: 17, fontWeight: '900' },
  sectionHint: { color: '#909991', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  usageGrid: { gap: 9 },
  usageCard: {
    borderWidth: 1,
    borderColor: '#e5e7e2',
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 14,
  },
  usageTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  usageLabel: { color: '#536157', fontSize: 11, fontWeight: '700' },
  usageValue: { color: '#173e2a', fontSize: 12, fontWeight: '900' },
  track: {
    height: 6,
    backgroundColor: '#edf0ea',
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 12,
  },
  fill: { height: '100%', backgroundColor: '#4e9167', borderRadius: 3 },
  usageNote: { color: '#939a94', fontSize: 9, marginTop: 6 },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#173e2a',
    borderRadius: 13,
    paddingHorizontal: 17,
    paddingVertical: 12,
    marginTop: 4,
  },
  buttonText: { color: '#fff', fontWeight: '900', fontSize: 11 },
  error: { color: '#9a2e2e', backgroundColor: '#fff0ec', borderRadius: 10, padding: 12 },
  empty: {
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#cfd8d0',
    borderRadius: 14,
    padding: 26,
  },
  emptyTitle: { color: '#294032', fontWeight: '900' },
  emptyCopy: { color: '#79837b', fontSize: 11, textAlign: 'center', marginTop: 6 },
});
