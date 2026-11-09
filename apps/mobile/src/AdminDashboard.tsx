import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api } from './api';
import { getOfflineDeviceId } from './offline/device';
import { openOfflineDatabase } from './offline/db';
import { loadOfflineDashboard, reportSnapshotKey, saveOfflineDashboard } from './modules/reports/offlineReport';
import { shareReportCsv, shareReportPdf } from './modules/reports/reportExport';
import { ReportAssistant } from './modules/reports/ReportAssistant';
import type { MobileBusinessModule } from './modules/registry';
import type { Identity } from './types';

type Report = {
  kpis: { pedidos: number; ventas: number; unidades: number; ticketPromedio: number };
  summary: string;
  generatedBy: string;
  products: readonly {
    variante_id: string;
    producto: string;
    sku: string;
    unidades: number;
    ventas: number;
  }[];
  locations: readonly {
    ubicacion_id: string;
    ubicacion: string | null;
    pedidos: number;
    ventas: number;
  }[];
};

type Props = {
  user: Identity;
  onClientMode: () => Promise<void>;
  onNavigate: (module: MobileBusinessModule) => void;
  onLogout: () => void;
};

const money = (value: number) =>
  new Intl.NumberFormat('es-BO', {
    style: 'currency',
    currency: 'BOB',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

function isoDaysAgo(days: number) {
  return new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

const welcomeDate = () =>
  new Intl.DateTimeFormat('es-BO', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );

async function offlineScopeFor(user: Identity) {
  if (!user.tenant) return null;
  return { tenantId: user.tenant.id, actorId: user.id, deviceId: await getOfflineDeviceId() };
}

export function AdminDashboard({ user, onClientMode, onNavigate, onLogout }: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const from = isoDaysAgo(days);
    const to = today();
    const key = reportSnapshotKey(from, to);
    try {
      const params = new URLSearchParams({ from, to });
      const current = await api<Report>(`/reports/summary?${params}`);
      setReport(current);
      const scope = await offlineScopeFor(user);
      if (scope) await saveOfflineDashboard(await openOfflineDatabase(), scope, key, current);
    } catch (reason) {
      const scope = await offlineScopeFor(user);
      const cached = scope ? await loadOfflineDashboard(await openOfflineDatabase(), scope, key) : null;
      if (cached) {
        setReport(cached.report);
        setError(`Sin conexión. Mostrando el último dashboard guardado (${new Date(cached.generatedAt).toLocaleString('es-BO')}).`);
      } else {
        setError((reason as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, [days, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxProductSales = Math.max(1, ...(report?.products.map((item) => item.ventas) || [0]));
  const maxLocationSales = Math.max(1, ...(report?.locations.map((item) => item.ventas) || [0]));

  async function switchToClient() {
    setSwitching(true);
    setError('');
    try {
      await onClientMode();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  async function exportReport(kind: 'csv' | 'pdf') {
    if (!report) return;
    setExporting(true);
    setError('');
    try {
      const from = isoDaysAgo(days);
      const to = today();
      if (kind === 'csv') await shareReportCsv(report, from, to);
      else await shareReportPdf(report, from, to);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.safe}>
      <StatusBar style="dark" />
      <NativeStatusBar barStyle="dark-content" backgroundColor="#fbfaf6" />
      <View style={[styles.header, isWide && styles.headerWide]}>
        <View>
          <Text style={styles.logo}>lúmina°</Text>
          <Text style={styles.logoSub}>{user.tenant?.name || 'Lúmina'} · ADMINISTRACIÓN</Text>
        </View>
        <Pressable accessibilityRole="button" style={styles.avatar} onPress={onLogout}>
          <Text style={styles.avatarText}>{user.nombres.slice(0, 1).toUpperCase()}</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#173e2a" />
        }
      >
        <View style={[styles.hero, isWide && styles.heroWide]}>
          <View style={styles.heroTopline}>
            <Text style={styles.eyebrow}>CENTRO DE CONTROL</Text>
            <View style={styles.onlineBadge}>
              <View style={styles.onlineDot} />
              <Text style={styles.onlineText}>SESIÓN ACTIVA</Text>
            </View>
          </View>
          <Text style={styles.heroTitle}>Hola, {user.nombres.split(' ')[0]}.</Text>
          <Text style={styles.heroCopy}>
            Revisa el desempeño de {user.tenant?.name || 'tu tienda'} y gestiona lo importante
            desde un solo lugar.
          </Text>
          <View style={styles.heroDetails}>
            <View>
              <Text style={styles.heroDetailLabel}>HOY</Text>
              <Text style={styles.heroDetailValue}>{welcomeDate()}</Text>
            </View>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{user.roles.includes('Administrador') ? 'ADMIN' : 'EQUIPO'}</Text>
            </View>
          </View>
          <Pressable
            disabled={switching}
            style={[styles.clientButton, switching && styles.disabled]}
            onPress={() => void switchToClient()}
          >
            <Text style={styles.clientButtonText}>
              {switching ? 'Abriendo catálogo…' : 'Cambiar a modo cliente  →'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.quickSection}>
          <View style={styles.quickHeading}>
            <Text style={styles.quickTitle}>Accesos rápidos</Text>
            <Text style={styles.quickHint}>OPERACIÓN DIARIA</Text>
          </View>
          <View style={[styles.quickGrid, isWide && styles.quickGridWide]}>
            <QuickAction
              icon="↻"
              label="Sincronización"
              copy="Revisa pendientes"
              tone="sage"
              onPress={() => onNavigate('sync')}
            />
            <QuickAction
              icon="⌂"
              label="Mi negocio"
              copy="Plan y consumo"
              tone="sand"
              onPress={() => onNavigate('business')}
            />
            <QuickAction
              icon="◌"
              label="Catálogo"
              copy="Vista de cliente"
              tone="rose"
              onPress={() => void switchToClient()}
            />
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Dashboard de ventas</Text>
            <Text style={styles.sectionMeta}>Información confirmada del sistema</Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={() => void load()}>
            <Text style={styles.refreshText}>↻</Text>
          </Pressable>
        </View>

        <View style={styles.periods}>
          {[7, 30, 90].map((value) => (
            <Pressable
              key={value}
              style={[styles.period, days === value && styles.periodActive]}
              onPress={() => setDays(value)}
            >
              <Text style={[styles.periodText, days === value && styles.periodTextActive]}>
                {value} días
              </Text>
            </Pressable>
          ))}
        </View>

        {report ? <View style={styles.exports}><Pressable disabled={exporting} style={styles.exportButton} onPress={() => void exportReport('csv')}><Text style={styles.exportText}>{exporting ? 'Preparando…' : 'Exportar CSV'}</Text></Pressable><Pressable disabled={exporting} style={[styles.exportButton, styles.exportPdf]} onPress={() => void exportReport('pdf')}><Text style={[styles.exportText, styles.exportPdfText]}>Exportar PDF</Text></Pressable></View> : null}

        {!!error && <Text style={styles.error}>{error}</Text>}

        {loading && !report ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#173e2a" />
            <Text style={styles.loadingText}>Preparando indicadores…</Text>
          </View>
        ) : report ? (
          <>
            <View style={styles.kpiGrid}>
              <KpiCard label="Ventas" value={money(report.kpis.ventas)} tone="dark" wide={isWide} />
              <KpiCard label="Pedidos" value={String(report.kpis.pedidos)} wide={isWide} />
              <KpiCard label="Unidades" value={String(report.kpis.unidades)} wide={isWide} />
              <KpiCard label="Ticket promedio" value={money(report.kpis.ticketPromedio)} wide={isWide} />
            </View>

            <View style={styles.insight}>
              <View style={styles.insightIcon}>
                <Text style={styles.insightIconText}>✦</Text>
              </View>
              <View style={styles.insightCopy}>
                <Text style={styles.insightLabel}>RESUMEN AUTOMÁTICO</Text>
                <Text style={styles.insightText}>{report.summary}</Text>
              </View>
            </View>
            <ReportAssistant from={isoDaysAgo(days)} to={today()} offlineReport={report} />

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Productos más vendidos</Text>
                <Text style={styles.panelHint}>Top {Math.min(5, report.products.length)}</Text>
              </View>
              {report.products.length ? (
                report.products.slice(0, 5).map((item, index) => (
                  <View key={item.variante_id} style={styles.barRow}>
                    <View style={styles.rank}>
                      <Text style={styles.rankText}>{index + 1}</Text>
                    </View>
                    <View style={styles.barCopy}>
                      <View style={styles.barLabels}>
                        <Text numberOfLines={1} style={styles.barName}>
                          {item.producto}
                        </Text>
                        <Text style={styles.barValue}>{money(item.ventas)}</Text>
                      </View>
                      <View style={styles.track}>
                        <View
                          style={[
                            styles.fill,
                            { width: `${Math.max(4, (item.ventas / maxProductSales) * 100)}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.units}>{item.unidades} unidades</Text>
                    </View>
                  </View>
                ))
              ) : (
                <EmptyReport text="Todavía no hay productos vendidos en este período." />
              )}
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <Text style={styles.panelTitle}>Ventas por sucursal</Text>
                <Text style={styles.panelHint}>{report.locations.length} ubicaciones</Text>
              </View>
              {report.locations.length ? (
                report.locations.map((item) => (
                  <View
                    key={item.ubicacion_id || item.ubicacion || 'sin-ubicacion'}
                    style={styles.locationRow}
                  >
                    <View style={styles.locationIcon}>
                      <Text style={styles.locationIconText}>⌂</Text>
                    </View>
                    <View style={styles.barCopy}>
                      <View style={styles.barLabels}>
                        <Text numberOfLines={1} style={styles.barName}>
                          {item.ubicacion || 'Sin ubicación'}
                        </Text>
                        <Text style={styles.barValue}>{money(item.ventas)}</Text>
                      </View>
                      <View style={styles.track}>
                        <View
                          style={[
                            styles.locationFill,
                            { width: `${Math.max(4, (item.ventas / maxLocationSales) * 100)}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.units}>{item.pedidos} pedidos</Text>
                    </View>
                  </View>
                ))
              ) : (
                <EmptyReport text="Todavía no hay ventas asignadas a sucursales." />
              )}
            </View>

            <Text style={styles.generated}>{report.generatedBy}</Text>
          </>
        ) : null}

        <Pressable style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function QuickAction({
  icon,
  label,
  copy,
  tone,
  onPress,
}: {
  icon: string;
  label: string;
  copy: string;
  tone: 'sage' | 'sand' | 'rose';
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" style={styles.quickAction} onPress={onPress}>
      <View style={[styles.quickIcon, tone === 'sand' && styles.quickIconSand, tone === 'rose' && styles.quickIconRose]}>
        <Text style={styles.quickIconText}>{icon}</Text>
      </View>
      <Text style={styles.quickLabel}>{label}</Text>
      <Text style={styles.quickCopy}>{copy}</Text>
    </Pressable>
  );
}

function KpiCard({ label, value, tone, wide }: { label: string; value: string; tone?: 'dark'; wide: boolean }) {
  return (
    <View style={[styles.kpi, wide && styles.kpiWide, tone === 'dark' && styles.kpiDark]}>
      <Text style={[styles.kpiLabel, tone === 'dark' && styles.kpiLabelDark]}>{label}</Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.kpiValue, tone === 'dark' && styles.kpiValueDark]}
      >
        {value}
      </Text>
      <Text style={[styles.kpiPeriod, tone === 'dark' && styles.kpiLabelDark]}>
        período seleccionado
      </Text>
    </View>
  );
}

function EmptyReport({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>◇</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const green = '#173e2a';
const cream = '#fbfaf6';
const border = '#e5e4dc';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  header: {
    height: 68,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: border,
  },
  headerWide: { paddingHorizontal: 32 },
  logo: {
    color: green,
    fontSize: 27,
    lineHeight: 28,
    letterSpacing: -1,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
  },
  logoSub: { color: '#7d877f', fontSize: 6, letterSpacing: 2.2 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  content: { padding: 16, paddingBottom: 46 },
  hero: { borderRadius: 18, padding: 20, backgroundColor: green, overflow: 'hidden' },
  heroWide: { maxWidth: 760, alignSelf: 'center', width: '100%' },
  heroTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: '#b9cbbd', fontSize: 9, letterSpacing: 1.8, fontWeight: '700' },
  onlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#ffffff17',
  },
  onlineDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#a5e2a6' },
  onlineText: { color: '#d7e8d6', fontSize: 7, fontWeight: '900', letterSpacing: 0.7 },
  heroTitle: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 34,
    marginTop: 8,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
  },
  heroCopy: { color: '#d7e2da', fontSize: 11, lineHeight: 17, marginTop: 8, maxWidth: 320 },
  heroDetails: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 18, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#ffffff24',
  },
  heroDetailLabel: { color: '#adc2b1', fontSize: 7, fontWeight: '900', letterSpacing: 1.1 },
  heroDetailValue: { color: '#fff', fontSize: 10, marginTop: 3, textTransform: 'capitalize' },
  roleBadge: { borderWidth: 1, borderColor: '#86aa8d', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 },
  roleBadgeText: { color: '#dff0e0', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  clientButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 17,
  },
  clientButtonText: { color: green, fontWeight: '900', fontSize: 11 },
  disabled: { opacity: 0.55 },
  quickSection: { marginTop: 22 },
  quickHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  quickTitle: { color: '#1b2720', fontSize: 16, fontWeight: '900' },
  quickHint: { color: '#8d968e', fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  quickGrid: { flexDirection: 'row', gap: 8 },
  quickGridWide: { maxWidth: 560 },
  quickAction: {
    flex: 1, minHeight: 124, backgroundColor: '#fff', borderColor: border, borderWidth: 1,
    borderRadius: 14, padding: 11, justifyContent: 'flex-end',
  },
  quickIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7f0e8', marginBottom: 14 },
  quickIconSand: { backgroundColor: '#f4ecdd' },
  quickIconRose: { backgroundColor: '#f4e6e8' },
  quickIconText: { color: green, fontSize: 18, fontWeight: '900' },
  quickLabel: { color: '#263129', fontSize: 10, fontWeight: '900' },
  quickCopy: { color: '#8a918c', fontSize: 8, marginTop: 4 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
  },
  sectionTitle: { color: '#18231c', fontSize: 19, fontWeight: '900' },
  sectionMeta: { color: '#7b817c', fontSize: 10, marginTop: 3 },
  refreshButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshText: { color: green, fontSize: 22 },
  periods: { flexDirection: 'row', gap: 7, marginVertical: 15 },
  exports: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  exportButton: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7f0e8' },
  exportPdf: { backgroundColor: '#173e2a' },
  exportText: { color: '#173e2a', fontSize: 10, fontWeight: '900' },
  exportPdfText: { color: '#fff' },
  period: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 17,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dedfd9',
  },
  periodActive: { backgroundColor: green, borderColor: green },
  periodText: { color: '#5d655f', fontSize: 10, fontWeight: '700' },
  periodTextActive: { color: '#fff' },
  error: {
    color: '#9f382d',
    backgroundColor: '#fff0ec',
    borderRadius: 8,
    padding: 11,
    marginBottom: 12,
  },
  loading: { minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#727a74', fontSize: 11 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  kpi: {
    width: '48.5%',
    minHeight: 112,
    padding: 14,
    borderRadius: 13,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: border,
    justifyContent: 'space-between',
  },
  kpiWide: { width: '23.8%', minHeight: 122 },
  kpiDark: { backgroundColor: green, borderColor: green },
  kpiLabel: { color: '#6f7771', fontSize: 10, fontWeight: '700' },
  kpiLabelDark: { color: '#c9d7cc' },
  kpiValue: { color: '#142019', fontSize: 22, fontWeight: '900', marginTop: 9 },
  kpiValueDark: { color: '#fff' },
  kpiPeriod: { color: '#9a9f9b', fontSize: 8, marginTop: 6 },
  insight: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#e9eddf',
    borderRadius: 13,
    padding: 15,
    marginTop: 12,
  },
  insightIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightIconText: { color: '#fff', fontSize: 17 },
  insightCopy: { flex: 1 },
  insightLabel: { color: green, fontSize: 8, letterSpacing: 1.2, fontWeight: '900' },
  insightText: { color: '#445149', fontSize: 10, lineHeight: 16, marginTop: 4 },
  panel: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: border,
    padding: 15,
    marginTop: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 11,
  },
  panelTitle: { color: '#1b2720', fontSize: 14, fontWeight: '900' },
  panelHint: { color: '#909590', fontSize: 9 },
  barRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#f0f0eb',
  },
  rank: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#e7ecdf',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: { color: green, fontWeight: '900', fontSize: 10 },
  barCopy: { flex: 1 },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  barName: { flex: 1, color: '#263129', fontSize: 10, fontWeight: '800' },
  barValue: { color: green, fontSize: 10, fontWeight: '900' },
  track: {
    height: 5,
    borderRadius: 3,
    backgroundColor: '#eceee9',
    overflow: 'hidden',
    marginTop: 7,
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: '#2f8251' },
  locationFill: { height: '100%', borderRadius: 3, backgroundColor: '#9bab82' },
  units: { color: '#999e9a', fontSize: 8, marginTop: 4 },
  locationRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: '#f0f0eb',
  },
  locationIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f0f2e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationIconText: { color: green, fontSize: 16 },
  empty: { minHeight: 110, alignItems: 'center', justifyContent: 'center', padding: 15 },
  emptyIcon: { color: '#a1aaa3', fontSize: 26 },
  emptyText: { color: '#878d88', fontSize: 10, textAlign: 'center', marginTop: 6 },
  generated: { color: '#9a9e9a', textAlign: 'center', fontSize: 8, marginTop: 14 },
  logoutButton: {
    height: 46,
    borderWidth: 1,
    borderColor: '#d8d9d4',
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  logoutText: { color: '#9f382d', fontWeight: '800', fontSize: 11 },
});
