import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { api } from './api';
import type { MobileBusinessModule } from './modules/registry';

type Props = { module: Exclude<MobileBusinessModule, 'home' | 'sync' | 'business'> };
type Location = { id: string; nombre: string; tipo: string; direccion?: string | null; activa: boolean; _count?: { inventario: number; usuario_ubicacion: number } };
type Inventory = { id: string; variante_id: string; fisico: number; disponible: number; version: number; alertaStock: boolean; variante: { sku: string; talla: string; color: string; producto: { nombre: string } } };
type Order = { id: string; numero: string; estado: string; total: string | number; creado_en: string; ubicacion?: { nombre: string }; usuario_pedido_usuario_idTousuario?: { nombres: string; apellidos: string } };

const names: Record<Props['module'], { eyebrow: string; title: string; copy: string }> = {
  catalog: { eyebrow: 'PRODUCTOS', title: 'Catálogo', copy: 'Crea borradores y consulta las prendas publicadas de la tienda.' },
  inventory: { eyebrow: 'EXISTENCIAS', title: 'Inventario', copy: 'Consulta el saldo por ubicación y registra conteos controlados.' },
  'sales-orders': { eyebrow: 'OPERACIÓN COMERCIAL', title: 'Ventas y pedidos', copy: 'Revisa los pedidos recientes confirmados y su estado operativo.' },
  team: { eyebrow: 'PERSONAL', title: 'Equipo', copy: 'Consulta el equipo y registra nuevos vendedores o analistas.' },
  locations: { eyebrow: 'RED COMERCIAL', title: 'Ubicaciones', copy: 'Administra tiendas y almacenes con su inventario asignado.' },
  'reports-analysis': { eyebrow: 'INTELIGENCIA', title: 'Reportes', copy: 'Consulta indicadores reales y realiza preguntas de solo lectura.' },
};

export function AdminOperationsScreen({ module }: Props) {
  const { width } = useWindowDimensions();
  const meta = names[module];
  return <ScrollView contentContainerStyle={[styles.page, width >= 720 && styles.pageWide]} keyboardShouldPersistTaps="handled">
    <Text style={styles.eyebrow}>{meta.eyebrow}</Text><Text style={styles.title}>{meta.title}</Text><Text style={styles.copy}>{meta.copy}</Text>
    {module === 'catalog' ? <CatalogModule /> : null}
    {module === 'locations' ? <LocationsModule /> : null}
    {module === 'inventory' ? <InventoryModule /> : null}
    {module === 'team' ? <TeamModule /> : null}
    {module === 'sales-orders' ? <OrdersModule /> : null}
    {module === 'reports-analysis' ? <ReportsModule /> : null}
  </ScrollView>;
}

function useRemote<T>(path: string, enabled = true) {
  const [data, setData] = useState<T | null>(null); const [busy, setBusy] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { if (!enabled) { setData(null); setError(''); setBusy(false); return; } setBusy(true); setError(''); try { setData(await api<T>(path)); } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); } }, [path, enabled]);
  useEffect(() => { void load(); }, [load]);
  return { data, busy, error, load, setError };
}

function Block({ title, children }: { title: string; children: ReactNode }) { return <View style={styles.block}><Text style={styles.blockTitle}>{title}</Text>{children}</View>; }
function Notice({ children }: { children: ReactNode }) { return <Text style={styles.notice}>{children}</Text>; }
function Field({ value, onChangeText, placeholder, secureTextEntry, keyboardType }: { value: string; onChangeText: (v: string) => void; placeholder: string; secureTextEntry?: boolean; keyboardType?: 'default' | 'numeric' | 'email-address' }) { return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#89938b" secureTextEntry={secureTextEntry} keyboardType={keyboardType} style={styles.input} />; }
function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable accessibilityRole="button" disabled={disabled} style={[styles.action, disabled && styles.disabled]} onPress={onPress}><Text style={styles.actionText}>{label}</Text></Pressable>; }
function Loading({ busy }: { busy: boolean }) { return busy ? <View style={styles.loading}><ActivityIndicator color="#173e2a" /></View> : null; }

function CatalogModule() {
  const remote = useRemote<{ products: { id: string; nombre: string; marca?: string | null; variantes: unknown[] }[]; categories: { id: string; nombre: string }[] }>('/catalog?channel=APP');
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [material, setMaterial] = useState(''); const [category, setCategory] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { if (!category && remote.data?.categories[0]) setCategory(remote.data.categories[0].id); }, [category, remote.data]);
  const create = async () => { try { await api('/catalog', { method: 'POST', body: JSON.stringify({ nombre: name.trim(), descripcion: description.trim(), material: material.trim(), categoria_id: category }) }); setName(''); setDescription(''); setMaterial(''); setMessage('Borrador creado. Publícalo desde la administración web cuando tenga variantes y recursos.'); } catch (reason) { remote.setError((reason as Error).message); } };
  return <><Block title="Nuevo borrador"><Field value={name} onChangeText={setName} placeholder="Nombre de la prenda" /><Field value={material} onChangeText={setMaterial} placeholder="Material" /><Field value={description} onChangeText={setDescription} placeholder="Descripción (mínimo 10 caracteres)" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{(remote.data?.categories || []).map((item) => <Pressable key={item.id} style={[styles.chip, category === item.id && styles.chipActive]} onPress={() => setCategory(item.id)}><Text style={[styles.chipText, category === item.id && styles.chipTextActive]}>{item.nombre}</Text></Pressable>)}</ScrollView>
    <Action label="Crear borrador" disabled={!name.trim() || description.trim().length < 10 || material.trim().length < 2 || !category} onPress={() => void create()} />{message ? <Notice>{message}</Notice> : null}</Block><Block title={`Prendas publicadas · ${remote.data?.products.length || 0}`}><Loading busy={remote.busy} />{remote.error ? <Notice>{remote.error}</Notice> : null}{remote.data?.products.map((item) => <Row key={item.id} title={item.nombre} detail={`${item.marca || 'Sin marca'} · ${item.variantes.length} variantes`} />)}</Block></>;
}

function LocationsModule() {
  const remote = useRemote<Location[]>('/locations'); const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [type, setType] = useState<'TIENDA' | 'ALMACEN'>('TIENDA');
  const create = async () => { try { await api('/locations', { method: 'POST', body: JSON.stringify({ nombre: name.trim(), tipo: type, ...(address.trim() ? { direccion: address.trim() } : {}) }) }); setName(''); setAddress(''); await remote.load(); } catch (reason) { remote.setError((reason as Error).message); } };
  return <><Block title="Nueva ubicación"><Field value={name} onChangeText={setName} placeholder="Nombre" /><Field value={address} onChangeText={setAddress} placeholder="Dirección (opcional)" /><View style={styles.chips}>{(['TIENDA', 'ALMACEN'] as const).map((item) => <Pressable key={item} style={[styles.chip, type === item && styles.chipActive]} onPress={() => setType(item)}><Text style={[styles.chipText, type === item && styles.chipTextActive]}>{item === 'TIENDA' ? 'Tienda' : 'Almacén'}</Text></Pressable>)}</View><Action label="Crear ubicación" disabled={name.trim().length < 2} onPress={() => void create()} /></Block><Block title="Ubicaciones registradas"><Loading busy={remote.busy} />{remote.error ? <Notice>{remote.error}</Notice> : null}{remote.data?.map((item) => <Row key={item.id} title={item.nombre} detail={`${item.tipo === 'TIENDA' ? 'Tienda' : 'Almacén'} · ${item.activa ? 'Activa' : 'Inactiva'} · ${item._count?.inventario || 0} referencias`} />)}</Block></>;
}

function InventoryModule() {
  const locations = useRemote<Location[]>('/locations'); const [locationId, setLocationId] = useState(''); const [counting, setCounting] = useState<Inventory | null>(null); const [observed, setObserved] = useState(''); const [reason, setReason] = useState('Conteo físico móvil');
  useEffect(() => { if (!locationId && locations.data?.[0]) setLocationId(locations.data[0].id); }, [locationId, locations.data]);
  const inventory = useRemote<Inventory[]>(locationId ? `/locations/${locationId}/inventory` : '', Boolean(locationId));
  const count = async () => { if (!counting) return; try { await api(`/locations/${locationId}/inventory/counts`, { method: 'POST', body: JSON.stringify({ varianteId: counting.variante_id, conteoObservado: Number(observed), expectedVersion: counting.version, motivo: reason }) }); setCounting(null); setObserved(''); await inventory.load(); } catch (e) { inventory.setError((e as Error).message); } };
  return <><Block title="Ubicación"><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{(locations.data || []).map((item) => <Pressable key={item.id} style={[styles.chip, locationId === item.id && styles.chipActive]} onPress={() => setLocationId(item.id)}><Text style={[styles.chipText, locationId === item.id && styles.chipTextActive]}>{item.nombre}</Text></Pressable>)}</ScrollView></Block>{counting ? <Block title={`Conteo · ${counting.variante.producto.nombre}`}><Field value={observed} onChangeText={setObserved} placeholder="Cantidad física observada" keyboardType="numeric" /><Field value={reason} onChangeText={setReason} placeholder="Motivo" /><Action label="Confirmar conteo" disabled={!/^\d+$/.test(observed) || reason.trim().length < 5} onPress={() => void count()} /></Block> : null}<Block title="Existencias"><Loading busy={inventory.busy && Boolean(locationId)} />{inventory.error ? <Notice>{inventory.error}</Notice> : null}{inventory.data?.map((item) => <Pressable key={item.id} style={styles.rowPress} onPress={() => { setCounting(item); setObserved(String(item.fisico)); }}><Row title={item.variante.producto.nombre} detail={`${item.variante.sku} · ${item.variante.color}/${item.variante.talla} · Disponible: ${item.disponible}${item.alertaStock ? ' · Stock bajo' : ''}`} /></Pressable>)}</Block></>;
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
