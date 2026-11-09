import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api } from './api';
import { randomUUID } from 'expo-crypto';
import { ApiProblem } from './errors/ApiProblem';
import { getOfflineDeviceId } from './offline/device';
import { bootstrapOfflineVault } from './offline/bootstrap';
import { openOfflineDatabase } from './offline/db';
import { readInventorySnapshot, saveInventorySnapshot } from './offline/inventorySnapshot';
import { SQLiteIntentRepository } from './offline/sqliteIntentRepository';
import { syncOfflineQueue } from './offline/syncQueue';
import type { OfflineScope } from './offline/scope';
import { readActiveDek } from './offline/vault';
import { countFitsReserved, hasUnresolvedCount } from './offline/stockCountReview';
import type { Identity } from './types';
import type { MobileBusinessModule } from './modules/registry';
import { CatalogAdminScreen } from './modules/catalog/CatalogAdminScreen';
import { projectDelta } from './modules/inventory/stockProjection';

type Props = { module: Exclude<MobileBusinessModule, 'home' | 'sync' | 'business'>; user: Identity };
type Location = { id: string; nombre: string; tipo: string; direccion?: string | null; activa: boolean; _count?: { inventario: number; usuario_ubicacion: number } };
type Inventory = { id: string; variante_id: string; fisico: number; reservado: number; comprometido: number; disponible: number; version: number; alertaStock: boolean; variante: { sku: string; talla: string; color: string; producto: { nombre: string } } };
type Order = { id: string; numero: string; estado: string; total: string | number; creado_en: string; ubicacion?: { nombre: string }; usuario_pedido_usuario_idTousuario?: { nombres: string; apellidos: string } };

const names: Record<Props['module'], { eyebrow: string; title: string; copy: string }> = {
  catalog: { eyebrow: 'PRODUCTOS', title: 'Catálogo', copy: 'Crea borradores y consulta las prendas publicadas de la tienda.' },
  inventory: { eyebrow: 'EXISTENCIAS', title: 'Inventario', copy: 'Consulta el saldo por ubicación y registra conteos controlados.' },
  'sales-orders': { eyebrow: 'OPERACIÓN COMERCIAL', title: 'Ventas y pedidos', copy: 'Revisa los pedidos recientes confirmados y su estado operativo.' },
  team: { eyebrow: 'PERSONAL', title: 'Equipo', copy: 'Consulta el equipo y registra nuevos vendedores o analistas.' },
  locations: { eyebrow: 'RED COMERCIAL', title: 'Ubicaciones', copy: 'Administra tiendas y almacenes con su inventario asignado.' },
  'reports-analysis': { eyebrow: 'INTELIGENCIA', title: 'Reportes', copy: 'Consulta indicadores reales y realiza preguntas de solo lectura.' },
};

export function AdminOperationsScreen({ module, user }: Props) {
  const { width } = useWindowDimensions();
  const meta = names[module];
  return <ScrollView contentContainerStyle={[styles.page, width >= 720 && styles.pageWide]} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>{meta.eyebrow}</Text><Text style={styles.title}>{meta.title}</Text><Text style={styles.copy}>{meta.copy}</Text>
    {module === 'catalog' ? <CatalogAdminScreen user={user} /> : null}
    {module === 'locations' ? <LocationsModule /> : null}
    {module === 'inventory' ? <InventoryModule user={user} /> : null}
    {module === 'team' ? <TeamModule /> : null}
    {module === 'sales-orders' ? <OrdersModule /> : null}
    {module === 'reports-analysis' ? <ReportsModule /> : null}
  </ScrollView>;
}

function useRemote<T>(path: string, enabled = true) {
  const [loaded, setLoaded] = useState<{ path: string; value: T } | null>(null);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [failure, setFailure] = useState<unknown>(null);
  const setData = useCallback((value: T | null) => setLoaded(value === null ? null : { path, value }), [path]);
  const restoreData = useCallback((value: T) => setLoaded((current) => current?.path === path ? current : { path, value }), [path]);
  const load = useCallback(async () => { if (!enabled) { setLoaded(null); setError(''); setFailure(null); setBusy(false); return; } setBusy(true); setError(''); setFailure(null); try { setLoaded({ path, value: await api<T>(path) }); } catch (reason) { setError((reason as Error).message); setFailure(reason); } finally { setBusy(false); } }, [path, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { data: loaded?.path === path ? loaded.value : null, busy, error, failure, load, setError, setData, restoreData };
}

function Block({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.block}><Text style={styles.blockTitle}>{title}</Text>{children}</View>; }
function Notice({ children }: { children: ReactNode }) { return <Text style={styles.notice}>{children}</Text>; }
function Field({ value, onChangeText, placeholder, secureTextEntry, keyboardType }: { value: string; onChangeText: (v: string) => void; placeholder: string; secureTextEntry?: boolean; keyboardType?: 'default' | 'numeric' | 'email-address' }) { return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#89938b" secureTextEntry={secureTextEntry} keyboardType={keyboardType} style={styles.input} />; }
function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} style={[styles.action, disabled && styles.disabled]} onPress={onPress}><Text style={styles.actionText}>{label}</Text></Pressable>; }
function Loading({ busy }: { busy: boolean }) { return busy ? <View style={styles.loading}><ActivityIndicator color="#173e2a" /></View> : null; }

function LocationsModule() {
  const remote = useRemote<Location[]>('/locations'); const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [type, setType] = useState<'TIENDA' | 'ALMACEN'>('TIENDA');
  const create = async () => { try { await api('/locations', { method: 'POST', body: JSON.stringify({ nombre: name.trim(), tipo: type, ...(address.trim() ? { direccion: address.trim() } : {}) }) }); setName(''); setAddress(''); await remote.load(); } catch (reason) { remote.setError((reason as Error).message); } };
  return <><Block title="Nueva ubicación"><Field value={name} onChangeText={setName} placeholder="Nombre" /><Field value={address} onChangeText={setAddress} placeholder="Dirección (opcional)" /><View style={styles.chips}>{(['TIENDA', 'ALMACEN'] as const).map((item) => <Pressable key={item} style={[styles.chip, type === item && styles.chipActive]} onPress={() => setType(item)}><Text style={[styles.chipText, type === item && styles.chipTextActive]}>{item === 'TIENDA' ? 'Tienda' : 'Almacén'}</Text></Pressable>)}</View><Action label="Crear ubicación" disabled={name.trim().length < 2} onPress={() => void create()} /></Block><Block title="Ubicaciones registradas"><Loading busy={remote.busy} />{remote.error ? <Notice>{remote.error}</Notice> : null}{remote.data?.map((item) => <Row key={item.id} title={item.nombre} detail={`${item.tipo === 'TIENDA' ? 'Tienda' : 'Almacén'} · ${item.activa ? 'Activa' : 'Inactiva'} · ${item._count?.inventario || 0} referencias`} />)}</Block></>;
}

function InventoryModule({ user }: { user: Identity }) {
  const locations = useRemote<Location[]>('/locations');
  const [locationId, setLocationId] = useState('');
  const [counting, setCounting] = useState<Inventory | null>(null);
  const [observed, setObserved] = useState('');
  const [inventoryMode, setInventoryMode] = useState<'COUNT' | 'DELTA'>('COUNT');
  const [reason, setReason] = useState('Conteo físico móvil');
  const [notice, setNotice] = useState('');
  const [offlineCopy, setOfflineCopy] = useState(false);
  const inventory = useRemote<Inventory[]>(locationId ? `/locations/${locationId}/inventory` : '', Boolean(locationId));
  const scopeForUser = useCallback(async (): Promise<OfflineScope> => {
    if (!user.tenant) throw new Error('La sesión no tiene una tienda para el modo offline.');
    return { tenantId: user.tenant.id, actorId: user.id, deviceId: await getOfflineDeviceId() };
  }, [user.id, user.tenant?.id]);
  const readyScope = useCallback(async () => {
    const scope = await scopeForUser();
    return await readActiveDek(scope) ? scope : bootstrapOfflineVault(user);
  }, [scopeForUser, user]);

  useEffect(() => {
    let active = true;
    void scopeForUser().then((scope) => readInventorySnapshot<Location>(scope, '__locations__'))
      .then((cached) => { if (active && cached) { locations.restoreData(cached); setOfflineCopy(true); } })
      .catch((error) => { if (active) setNotice(`No se pudo abrir la copia de ubicaciones: ${(error as Error).message}`); });
    return () => { active = false; };
  }, [scopeForUser, locations.restoreData]);
  useEffect(() => {
    if (!locationId && locations.data?.[0]) setLocationId(locations.data[0].id);
  }, [locationId, locations.data]);
  useEffect(() => {
    if (!locationId) return;
    let active = true;
    void scopeForUser().then((scope) => readInventorySnapshot<Inventory>(scope, locationId))
      .then((cached) => { if (active && cached) { inventory.restoreData(cached); setOfflineCopy(true); } })
      .catch((error) => { if (active) setNotice(`No se pudo abrir la copia de inventario: ${(error as Error).message}`); });
    return () => { active = false; };
  }, [locationId, scopeForUser, inventory.restoreData]);
  useEffect(() => {
    if (inventory.data && !inventory.busy && !inventory.failure) setOfflineCopy(false);
  }, [inventory.data, inventory.busy, inventory.failure]);
  useEffect(() => {
    if (locations.data && !locations.failure)
      void readyScope().then((scope) => saveInventorySnapshot(scope, '__locations__', locations.data!))
        .then(() => setNotice((current) => current.startsWith('No se pudo abrir la copia') ? '' : current))
        .catch((error) => setNotice(`No se pudo guardar la copia offline: ${(error as Error).message}`));
  }, [locations.data, locations.failure, readyScope]);
  useEffect(() => {
    if (!ApiProblem.isNetwork(locations.failure)) return;
    void scopeForUser()
      .then((scope) => readInventorySnapshot<Location>(scope, '__locations__'))
      .then((cached) => { if (cached) { locations.setData(cached); locations.setError(''); setOfflineCopy(true); } })
      .catch((error) => locations.setError((error as Error).message));
  }, [locations.failure, scopeForUser]);
  useEffect(() => {
    if (!locationId || !inventory.data || inventory.failure) return;
    void readyScope().then((scope) => saveInventorySnapshot(scope, locationId, inventory.data!))
      .then(() => setNotice((current) => current.startsWith('No se pudo abrir la copia') ? '' : current))
      .catch((error) => setNotice(`No se pudo guardar la copia offline: ${(error as Error).message}`));
  }, [locationId, inventory.data, inventory.failure, readyScope]);
  useEffect(() => {
    if (!locationId || !ApiProblem.isNetwork(inventory.failure)) return;
    void scopeForUser()
      .then((scope) => readInventorySnapshot<Inventory>(scope, locationId))
      .then((cached) => { if (cached) { inventory.setData(cached); inventory.setError(''); setOfflineCopy(true); } })
      .catch((error) => inventory.setError((error as Error).message));
  }, [locationId, inventory.failure, scopeForUser]);

  const saveInventoryOperation = async () => {
    if (!counting || !locationId) return;
    if (!user.permissions.includes('inventario:gestionar')) {
      inventory.setError('Tu cuenta solo puede consultar inventario.');
      return;
    }
    const quantity = Number(observed);
    if (inventoryMode === 'COUNT' && !countFitsReserved(quantity, counting.reservado, counting.comprometido)) {
      inventory.setError('El conteo no puede ser menor que el stock reservado y comprometido.');
      return;
    }
    if (inventoryMode === 'DELTA') {
      try {
        projectDelta({ physical: counting.fisico, reserved: counting.reservado, committed: counting.comprometido, version: counting.version }, quantity);
        if (quantity === 0) throw new Error('El ajuste debe ser distinto de cero.');
      } catch (error) {
        inventory.setError((error as Error).message);
        return;
      }
    }
    inventory.setError('');
    setNotice('');
    try {
      const scope = await readyScope();
      const repository = new SQLiteIntentRepository(await openOfflineDatabase());
      const existing = await repository.listIntents(scope);
      if (inventoryMode === 'COUNT' && hasUnresolvedCount(existing, locationId, counting.variante_id))
        throw new Error('Ya existe un conteo pendiente para esta prenda y ubicación. Revísalo en Sincronización.');
      const operationId = randomUUID();
      const kind = inventoryMode === 'COUNT' ? 'STOCK_COUNT' : 'STOCK_DELTA';
      const payload = JSON.stringify(inventoryMode === 'COUNT'
        ? { locationId, variantId: counting.variante_id, observedPhysical: quantity, reason: reason.trim() }
        : { locationId, variantId: counting.variante_id, delta: quantity, reason: reason.trim() });
      await repository.enqueue(
        { operationId, scope, kind, payload, baseVersion: counting.version, dependsOn: [], state: 'PENDING' },
        { scope, entityId: `inventory:${locationId}:${counting.variante_id}`, version: counting.version, payload },
      );
      setCounting(null); setObserved('');
      try {
        await syncOfflineQueue(repository, scope);
        const result = (await repository.listIntents(scope)).find((item) => item.operationId === operationId);
        if (result?.state === 'APPLIED') {
          setOfflineCopy(false);
          setNotice(inventoryMode === 'COUNT' ? 'Conteo registrado en el servidor.' : 'Ajuste registrado en el servidor.');
          await inventory.load();
        } else if (result?.state === 'CONFLICT') {
          setNotice('El saldo cambió en el servidor. Revisa la operación en Sincronización.');
        } else if (result?.state === 'REJECTED') {
          setNotice('El servidor rechazó el conteo. Revísalo en Sincronización.');
        } else {
          setNotice(`${inventoryMode === 'COUNT' ? 'Conteo' : 'Ajuste'} guardado en el dispositivo. Sincronízalo cuando tengas conexión.`);
        }
      } catch (syncError) {
        setNotice(ApiProblem.isNetwork(syncError)
          ? `Sin conexión: el ${inventoryMode === 'COUNT' ? 'conteo' : 'ajuste'} quedó guardado en el dispositivo para sincronizarlo después.`
          : `La operación quedó guardada, pero no se pudo sincronizar: ${(syncError as Error).message}`);
      }
    } catch (error) { inventory.setError((error as Error).message); }
  };

  return <>
    <Block title="Ubicación">
      {locations.error ? <Notice>{locations.error}</Notice> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {(locations.data || []).map((item) => <Pressable key={item.id} style={[styles.chip, locationId === item.id && styles.chipActive]} onPress={() => { setLocationId(item.id); setCounting(null); }}><Text style={[styles.chipText, locationId === item.id && styles.chipTextActive]}>{item.nombre}</Text></Pressable>)}
      </ScrollView>
    </Block>
    {offlineCopy ? <Notice>Mostrando una copia local. Los saldos pueden cambiar en el servidor.</Notice> : null}
    {notice ? <Notice>{notice}</Notice> : null}
    {counting ? <Block title={`Actualizar · ${counting.variante.producto.nombre}`}>
      <View style={styles.chips}>{(['COUNT', 'DELTA'] as const).map((mode) => <Pressable key={mode} style={[styles.chip, inventoryMode === mode && styles.chipActive]} onPress={() => { setInventoryMode(mode); setObserved(mode === 'COUNT' ? String(counting.fisico) : ''); }}><Text style={[styles.chipText, inventoryMode === mode && styles.chipTextActive]}>{mode === 'COUNT' ? 'Conteo físico' : 'Ajuste + / −'}</Text></Pressable>)}</View>
      <Notice>Físico {counting.fisico} · Reservado {counting.reservado} · Comprometido {counting.comprometido} · Disponible {counting.disponible} · Versión {counting.version}</Notice>
      <Field value={observed} onChangeText={setObserved} placeholder={inventoryMode === 'COUNT' ? 'Cantidad física observada' : 'Delta, por ejemplo 3 o -2'} keyboardType="numeric" />
      <Field value={reason} onChangeText={setReason} placeholder="Motivo" />
      <Action label={inventoryMode === 'COUNT' ? 'Confirmar conteo' : 'Guardar ajuste'} disabled={!user.permissions.includes('inventario:gestionar') || !(inventoryMode === 'COUNT' ? /^\d+$/.test(observed) : /^-?\d+$/.test(observed) && Number(observed) !== 0) || reason.trim().length < 5} onPress={() => void saveInventoryOperation()} />
      <Notice>Las transferencias entre ubicaciones requieren conexión para ser atómicas; no se simulan con dos ajustes offline.</Notice>
    </Block> : null}
    <Block title="Existencias">
      <Loading busy={inventory.busy && Boolean(locationId)} />
      {inventory.error ? <Notice>{inventory.error}</Notice> : null}
      {inventory.data?.map((item) => <Pressable key={item.id} style={styles.rowPress} onPress={() => { setCounting(item); setInventoryMode('COUNT'); setObserved(String(item.fisico)); }}><Row title={item.variante.producto.nombre} detail={`${item.variante.sku} · ${item.variante.color}/${item.variante.talla} · Físico ${item.fisico} · Reservado ${item.reservado} · Comprometido ${item.comprometido} · Disponible ${item.disponible} · v${item.version}${item.alertaStock ? ' · Stock bajo' : ''}`} /></Pressable>)}
    </Block>
  </>;
}

function TeamModule() {
  const team = useRemote<{ id: string; nombres: string; apellidos: string; correo: string; estado: string; usuario_rol: { rol: { nombre: string } }[] }[]>('/staff'); const locations = useRemote<Location[]>('/locations');
  const [first, setFirst] = useState(''); const [last, setLast] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [role, setRole] = useState<'Vendedor' | 'Analista'>('Vendedor'); const [location, setLocation] = useState('');
  const create = async () => { try { await api('/staff', { method: 'POST', body: JSON.stringify({ nombres: first.trim(), apellidos: last.trim(), correo: email.trim(), clave: password, rol: role, ubicaciones: location ? [location] : [] }) }); setFirst(''); setLast(''); setEmail(''); setPassword(''); await team.load(); } catch (e) { team.setError((e as Error).message); } };
  return <><Block title="Incorporar personal"><Field value={first} onChangeText={setFirst} placeholder="Nombres" /><Field value={last} onChangeText={setLast} placeholder="Apellidos" /><Field value={email} onChangeText={setEmail} placeholder="Correo" keyboardType="email-address" /><Field value={password} onChangeText={setPassword} placeholder="Contraseña temporal (mín. 10)" secureTextEntry /><View style={styles.chips}>{(['Vendedor', 'Analista'] as const).map((item) => <Pressable key={item} style={[styles.chip, role === item && styles.chipActive]} onPress={() => setRole(item)}><Text style={[styles.chipText, role === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}><Pressable style={[styles.chip, !location && styles.chipActive]} onPress={() => setLocation('')}><Text style={[styles.chipText, !location && styles.chipTextActive]}>Sin asignar</Text></Pressable>{(locations.data || []).map((item) => <Pressable key={item.id} style={[styles.chip, location === item.id && styles.chipActive]} onPress={() => setLocation(item.id)}><Text style={[styles.chipText, location === item.id && styles.chipTextActive]}>{item.nombre}</Text></Pressable>)}</ScrollView><Action label="Crear usuario" disabled={first.trim().length < 2 || last.trim().length < 2 || !email.includes('@') || password.length < 10} onPress={() => void create()} /></Block><Block title="Equipo registrado"><Loading busy={team.busy} />{team.error ? <Notice>{team.error}</Notice> : null}{team.data?.map((item) => <Row key={item.id} title={`${item.nombres} ${item.apellidos}`} detail={`${item.usuario_rol.map((r) => r.rol.nombre).join(', ')} · ${item.correo} · ${item.estado}`} />)}</Block></>;
}

function OrdersModule() {
  const remote = useRemote<Order[]>('/admin/orders'); const [reason, setReason] = useState('Actualización desde administración móvil'); const [tracking, setTracking] = useState(''); const [busyId, setBusyId] = useState(''); const money = (value: string | number) => new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(Number(value));
  const next: Record<string, string | undefined> = { CONFIRMADO: 'PREPARANDO', PREPARANDO: 'DESPACHADO', DESPACHADO: 'ENTREGADO', ENTREGADO: 'CERRADO' };
  const advance = async (item: Order) => { const status = next[item.estado]; if (!status) return; setBusyId(item.id); try { await api(`/admin/orders/${item.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason, ...(status === 'DESPACHADO' ? { tracking } : {}) }) }); setTracking(''); await remote.load(); } catch (error) { remote.setError((error as Error).message); } finally { setBusyId(''); } };
  return <Block title="Pedidos recientes"><Field value={reason} onChangeText={setReason} placeholder="Motivo de cambio de estado" /><Field value={tracking} onChangeText={setTracking} placeholder="Código de seguimiento (solo al despachar)" /><Loading busy={remote.busy} />{remote.error ? <Notice>{remote.error}</Notice> : null}{remote.data?.length ? remote.data.map((item) => <View key={item.id} style={styles.order}><Row title={`${item.numero} · ${item.estado}`} detail={`${item.ubicacion?.nombre || 'Sin ubicación'} · ${money(item.total)} · ${new Date(item.creado_en).toLocaleDateString('es-BO')}`} />{next[item.estado] ? <Action label={busyId === item.id ? 'Actualizando…' : `Pasar a ${next[item.estado]}`} disabled={busyId === item.id || reason.trim().length < 3 || (next[item.estado] === 'DESPACHADO' && tracking.trim().length < 3)} onPress={() => void advance(item)} /> : null}</View>) : <Notice>No hay pedidos disponibles.</Notice>}</Block>;
}

function ReportsModule() {
  const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10); const to = new Date().toISOString().slice(0, 10); const remote = useRemote<{ kpis: { ventas: number; pedidos: number; unidades: number; ticketPromedio: number }; summary: string }>(`/reports/summary?from=${from}&to=${to}`); const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState('');
  const ask = async () => { try { const result = await api<{ answer: string }>('/analytics/query', { method: 'POST', body: JSON.stringify({ from, to, question }) }); setAnswer(result.answer); } catch (e) { remote.setError((e as Error).message); } };
  return <><Block title="Últimos 30 días"><Loading busy={remote.busy} />{remote.error ? <Notice>{remote.error}</Notice> : null}{remote.data ? <><View style={styles.metrics}><Metric label="Ventas" value={`Bs. ${Number(remote.data.kpis.ventas).toFixed(2)}`} /><Metric label="Pedidos" value={String(remote.data.kpis.pedidos)} /><Metric label="Unidades" value={String(remote.data.kpis.unidades)} /></View><Notice>{remote.data.summary}</Notice></> : null}</Block><Block title="Pregunta al asistente"><Field value={question} onChangeText={setQuestion} placeholder="Ej. ¿Cómo están las ventas y el inventario?" /><Action label="Consultar reporte" disabled={question.trim().length < 4} onPress={() => void ask()} />{answer ? <Notice>{answer}</Notice> : null}</Block></>;
}

function Row({ title, detail }: { title: string; detail: string }) { return <View style={styles.row}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>; }
function Metric({ label, value }: { label: string; value: string }) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>; }

const styles = StyleSheet.create({
  page: { flexGrow: 1, padding: 20, paddingBottom: 48, gap: 14, backgroundColor: '#fbfaf6' }, pageWide: { width: 720, alignSelf: 'center' }, eyebrow: { color: '#728176', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 }, title: { color: '#173e2a', fontSize: 29, fontWeight: '900', marginTop: 4 }, copy: { color: '#5d6d61', fontSize: 12, lineHeight: 18, maxWidth: 480 }, block: { gap: 10, padding: 15, borderWidth: 1, borderColor: '#e3e7e1', backgroundColor: '#fff', borderRadius: 16 }, blockTitle: { color: '#223429', fontSize: 14, fontWeight: '900' }, input: { minHeight: 45, borderColor: '#dbe1da', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, color: '#1c2b20', fontSize: 12 }, action: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 11, backgroundColor: '#173e2a' }, actionText: { color: '#fff', fontSize: 11, fontWeight: '900' }, disabled: { opacity: 0.42 }, notice: { color: '#637167', backgroundColor: '#eff4ef', borderRadius: 9, padding: 10, fontSize: 10, lineHeight: 15 }, chips: { flexDirection: 'row', gap: 7 }, chip: { borderWidth: 1, borderColor: '#dbe1da', borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7 }, chipActive: { backgroundColor: '#173e2a', borderColor: '#173e2a' }, chipText: { color: '#5b695e', fontSize: 10, fontWeight: '700' }, chipTextActive: { color: '#fff' }, loading: { minHeight: 74, alignItems: 'center', justifyContent: 'center' }, rowPress: { borderRadius: 10 }, row: { borderTopWidth: 1, borderTopColor: '#eef0ec', paddingVertical: 10 }, rowTitle: { color: '#243429', fontSize: 11, fontWeight: '900' }, rowDetail: { color: '#7a847d', fontSize: 9, lineHeight: 14, marginTop: 3 }, order: { borderTopWidth: 1, borderTopColor: '#eef0ec', paddingVertical: 4 }, metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, minHeight: 75, padding: 10, backgroundColor: '#f2f6f1', borderRadius: 10, justifyContent: 'space-between' }, metricLabel: { color: '#6b776e', fontSize: 8, fontWeight: '800' }, metricValue: { color: '#173e2a', fontSize: 12, fontWeight: '900' },
});
