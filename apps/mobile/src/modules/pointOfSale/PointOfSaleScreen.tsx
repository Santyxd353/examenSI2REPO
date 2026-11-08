import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNetworkState } from 'expo-network';
import { api, captureSessionScope, isCurrentSessionScope } from '../../api';
import { ApiProblem } from '../../errors/ApiProblem';
import { bootstrapOfflineVault } from '../../offline/bootstrap';
import type { Identity } from '../../types';
import { openPointOfSale } from './nativeStorage';
import { salePayload, type SalePayload, type StoredSale } from './workflow';

type Variant = {
  id: string;
  product: string;
  sku: string;
  size: string;
  color: string;
  available: number;
  price: number;
};
type Location = { id: string; nombre: string; tipo: string; variants: Variant[] };
type Line = Variant & { quantity: number };
type Storage = Awaited<ReturnType<typeof openPointOfSale>>;
const money = (value: number | string) =>
  new Intl.NumberFormat('es-BO', { style: 'currency', currency: 'BOB' }).format(Number(value));

export function PointOfSaleScreen({ user }: { user: Identity }) {
  const network = useNetworkState(),
    online = network.isConnected !== false && network.isInternetReachable !== false;
  const [locations, setLocations] = useState<Location[]>([]),
    [locationId, setLocationId] = useState(''),
    [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [customer, setCustomer] = useState(''),
    [method, setMethod] = useState<SalePayload['paymentMethod']>('EFECTIVO');
  const [saved, setSaved] = useState<StoredSale | null>(null),
    [busy, setBusy] = useState('Preparando punto de venta…'),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const life = useRef<AbortController | null>(null),
    storage = useRef<Storage | null>(null),
    flight = useRef(false);
  const location = locations.find((row) => row.id === locationId),
    frozen = !!saved;
  const variants = (location?.variants ?? [])
    .filter((row) =>
      (row.product + ' ' + row.sku + ' ' + row.size + ' ' + row.color)
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
    )
    .slice(0, 30);
  const totalCents = lines.reduce(
    (sum, line) => sum + Math.round(line.price * 100) * line.quantity,
    0,
  );
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const session = captureSessionScope();
    const current = () => !controller.signal.aborted && isCurrentSessionScope(session);
    void (async () => {
      if (online) {
        try {
          await bootstrapOfflineVault(user);
        } catch (reason) {
          if (!ApiProblem.isNetwork(reason)) throw reason;
        }
      }
      const work = await openPointOfSale(controller.signal);
      storage.current = work;
      const record = await work.workflow.current();
      work.guard();
      if (!current()) return;
      setSaved(record);
      if (online) {
        const data = await api<Location[]>('/sales/context', { signal: controller.signal });
        work.guard();
        if (current()) {
          setLocations(data);
          setLocationId(record?.payload.locationId ?? data[0]?.id ?? '');
        }
      }
    })()
      .catch((reason) => {
        if (current()) setError((reason as Error).message);
      })
      .finally(() => {
        if (current()) setBusy('');
      });
    return () => {
      controller.abort();
      life.current = null;
      storage.current = null;
    };
  }, [user.id, user.tenant?.id]);
  const run = async (
    label: string,
    task: (work: Storage, current: () => boolean, signal: AbortSignal) => Promise<void>,
  ) => {
    const controller = life.current;
    if (!controller || flight.current) return;
    const session = captureSessionScope(),
      current = () =>
        life.current === controller && !controller.signal.aborted && isCurrentSessionScope(session);
    flight.current = true;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const work = storage.current ?? (await openPointOfSale(controller.signal));
      storage.current = work;
      work.guard();
      await task(work, current, controller.signal);
    } catch (reason) {
      if (current()) setError((reason as Error).message);
    } finally {
      if (current()) {
        try {
          const value = await storage.current?.workflow.current();
          if (current() && value !== undefined) setSaved(value);
        } catch (reason) {
          if (current()) setError((reason as Error).message);
        }
      }
      flight.current = false;
      if (current()) setBusy('');
    }
  };
  const refresh = () =>
    run('Actualizando disponibilidad…', async (work, current, signal) => {
      const data = await api<Location[]>('/sales/context', { signal });
      work.guard();
      if (current()) {
        setLocations(data);
        setLocationId((value) =>
          data.some((row) => row.id === value) ? value : (data[0]?.id ?? ''),
        );
        setNotice(
          'Disponibilidad actualizada. El servidor verificará precio y stock al confirmar.',
        );
      }
    });
  const add = (variant: Variant) => {
    const count = Number(quantity),
      existing = lines.find((row) => row.id === variant.id)?.quantity ?? 0;
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      existing + count > 100 ||
      existing + count > variant.available
    ) {
      setError('Indica una cantidad entera entre uno y el disponible de esta prenda.');
      return;
    }
    if (!existing && lines.length >= 30) {
      setError('Una venta admite hasta treinta variantes.');
      return;
    }
    setLines((current) =>
      existing
        ? current.map((row) =>
            row.id === variant.id ? { ...row, quantity: row.quantity + count } : row,
          )
        : [...current, { ...variant, quantity: count }],
    );
    setError('');
    setQuantity('1');
  };
  const sell = () =>
    run(
      saved?.phase === 'PENDING' ? 'Comprobando la misma venta…' : 'Registrando venta…',
      async (work, current, _signal) => {
        const payload =
          saved?.payload ??
          salePayload({
            locationId,
            customerName: customer,
            paymentMethod: method,
            items: lines.map((row) => ({ variantId: row.id, quantity: row.quantity })),
          });
        const summary = saved?.summary ?? {
          location: location?.nombre ?? 'Ubicación seleccionada',
          lines: lines.map(
            (row) => row.quantity + ' × ' + row.product + ' · ' + row.size + ' · ' + row.color,
          ),
          totalCents,
        };
        const receipt = await work.workflow.submit(payload, summary);
        work.guard();
        const record = await work.workflow.current();
        if (current()) {
          setSaved(record);
          setNotice(
            'Venta ' +
              receipt.numero +
              ' registrada por ' +
              money(receipt.total) +
              '. Ya está disponible en los registros y reportes de la tienda.',
          );
        }
      },
    );
  const startNew = () =>
    run('Preparando otra venta…', async (work, current, signal) => {
      await work.workflow.startNew();
      if (current()) {
        setSaved(null);
        setLines([]);
        setCustomer('');
        setMethod('EFECTIVO');
        setSearch('');
        setQuantity('1');
      }
      const data = await api<Location[]>('/sales/context', { signal });
      work.guard();
      if (current()) {
        setLocations(data);
        setLocationId((value) =>
          data.some((row) => row.id === value) ? value : (data[0]?.id ?? ''),
        );
      }
    });
  return (
    <View style={s.panel}>
      <Text style={s.title}>Venta de mostrador</Text>
      <Text style={s.copy}>
        Registra un cobro recibido en tu sucursal. El importe final y el stock se verifican al
        confirmar.
      </Text>
      <Text style={s.online}>
        {online ? 'Con conexión' : 'Sin conexión · las ventas de mostrador requieren internet'}
      </Text>
      {busy ? (
        <View style={s.loading}>
          <ActivityIndicator color="#633f56" />
          <Text style={s.copy}>{busy}</Text>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {saved ? (
        <View style={s.saved}>
          <Text style={s.subtitle}>
            {saved.phase === 'CONFIRMED'
              ? 'Comprobante guardado'
              : saved.phase === 'REJECTED'
                ? 'Venta rechazada'
                : 'Venta pendiente de comprobación'}
          </Text>
          {saved.summary ? (
            <>
              <Text style={s.copy}>{saved.summary.location}</Text>
              {saved.summary.lines.map((line, index) => (
                <Text key={index} style={s.copy}>
                  {line}
                </Text>
              ))}
              <Text style={s.copy}>Total mostrado: {money(saved.summary.totalCents / 100)}</Text>
            </>
          ) : null}
          <Text style={s.copy}>Método declarado: {saved.payload.paymentMethod}</Text>
          {saved.receipt ? (
            <>
              <Text selectable style={s.receipt}>
                {saved.receipt.numero}
              </Text>
              <Text style={s.receipt}>
                {money(saved.receipt.total)} · {saved.receipt.estado}
              </Text>
            </>
          ) : null}
          {saved.phase === 'PENDING' ? (
            <>
              <Text style={s.copy}>
                La respuesta pudo haberse perdido. Reintenta esta venta para recuperar su
                comprobante sin descontar stock otra vez.
              </Text>
              <Button
                label="Comprobar o reintentar esta venta"
                disabled={!!busy || !online}
                press={() => void sell()}
              />
            </>
          ) : (
            <Button
              label={
                saved.phase === 'REJECTED'
                  ? 'Corregir en un formulario nuevo'
                  : 'Registrar otra venta'
              }
              disabled={!!busy || !online}
              press={() => void startNew()}
            />
          )}
        </View>
      ) : null}
      {!frozen ? (
        <>
          <Text style={s.subtitle}>Sucursal o almacén</Text>
          <View style={s.chips}>
            {locations.map((row) => (
              <Choice
                key={row.id}
                label={row.nombre}
                selected={locationId === row.id}
                disabled={!!busy}
                press={() => {
                  setLocationId(row.id);
                  setLines([]);
                }}
              />
            ))}
          </View>
          {!locations.length && !busy ? (
            <Text style={s.copy}>
              No hay ubicaciones disponibles para tu cuenta. Actualiza con conexión o revisa tus
              asignaciones.
            </Text>
          ) : null}
          <Field
            label="Nombre de la clienta (opcional)"
            value={customer}
            change={setCustomer}
            editable={!busy}
          />
          <Text style={s.subtitle}>Cobro recibido</Text>
          <View style={s.chips}>
            {(['EFECTIVO', 'TARJETA', 'QR'] as const).map((value) => (
              <Choice
                key={value}
                label={value === 'EFECTIVO' ? 'Efectivo' : value === 'TARJETA' ? 'Tarjeta' : 'QR'}
                selected={method === value}
                disabled={!!busy}
                press={() => setMethod(value)}
              />
            ))}
          </View>
          <Text style={s.copy}>
            Este formulario registra el medio de cobro declarado. No realiza un cargo en Stripe ni
            un pago bancario.
          </Text>
          <Field
            label="Buscar por prenda, SKU, talla o color"
            value={search}
            change={setSearch}
            editable={!busy}
          />
          <Field
            label="Cantidad a añadir"
            value={quantity}
            change={setQuantity}
            editable={!busy}
            numeric
          />
          {variants.map((variant) => (
            <View key={variant.id} style={s.row}>
              <Text style={s.lineTitle}>{variant.product}</Text>
              <Text style={s.copy}>
                {variant.size} · {variant.color} · {variant.sku}
              </Text>
              <Text style={s.copy}>
                {money(variant.price)} · Disponible: {variant.available}
              </Text>
              <Button
                label="Añadir prenda"
                disabled={!!busy || !online}
                press={() => add(variant)}
              />
            </View>
          ))}
          {(location?.variants.length ?? 0) > 30 ? (
            <Text style={s.copy}>
              Se muestran hasta treinta coincidencias. Usa el buscador para acotar la lista.
            </Text>
          ) : null}
          <Text style={s.subtitle}>Resumen de la venta</Text>
          {!lines.length ? (
            <Text style={s.copy}>Añade al menos una prenda.</Text>
          ) : (
            lines.map((line) => (
              <View key={line.id} style={s.row}>
                <Text style={s.lineTitle}>
                  {line.quantity} × {line.product} · {line.size} · {line.color}
                </Text>
                <Text style={s.copy}>
                  {money((Math.round(line.price * 100) * line.quantity) / 100)}
                </Text>
                <Button
                  label="Quitar de la venta"
                  disabled={!!busy}
                  press={() => setLines((rows) => rows.filter((row) => row.id !== line.id))}
                />
              </View>
            ))
          )}
          <Text style={s.receipt}>Total mostrado: {money(totalCents / 100)}</Text>
          <Button
            label="Confirmar venta"
            disabled={!!busy || !online || !lines.length || !locationId}
            press={() => void sell()}
          />
        </>
      ) : null}
      <Button
        label="Actualizar disponibilidad"
        disabled={!!busy || !online}
        press={() => void refresh()}
      />
    </View>
  );
}
function Field({
  label,
  value,
  change,
  editable,
  numeric = false,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  editable: boolean;
  numeric?: boolean;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={change}
        editable={editable}
        keyboardType={numeric ? 'number-pad' : 'default'}
        style={s.input}
      />
    </View>
  );
}
function Button({
  label,
  disabled,
  press,
}: {
  label: string;
  disabled: boolean;
  press: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={press}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
function Choice({
  label,
  selected,
  disabled,
  press,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  press: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={press}
      style={[s.choice, selected && s.choiceActive]}
    >
      <Text style={selected ? s.buttonText : s.copy}>{label}</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  panel: {
    gap: 13,
    borderWidth: 1,
    borderColor: '#eadde5',
    borderRadius: 15,
    padding: 17,
    backgroundColor: '#fff',
  },
  title: { fontSize: 20, fontWeight: '800', color: '#342733' },
  subtitle: { fontSize: 15, fontWeight: '800', color: '#633f56' },
  copy: { fontSize: 12, lineHeight: 18, color: '#71626c' },
  label: { fontSize: 12, fontWeight: '700', color: '#633f56' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#e4d4df',
    borderRadius: 10,
    padding: 11,
    color: '#342733',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: {
    minHeight: 44,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e4d4df',
    borderRadius: 11,
  },
  choiceActive: { backgroundColor: '#633f56' },
  button: {
    minHeight: 44,
    padding: 12,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#633f56',
  },
  buttonText: { fontSize: 12, fontWeight: '800', color: '#fff' },
  disabled: { opacity: 0.45 },
  row: {
    gap: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#eadde5',
    borderRadius: 11,
    backgroundColor: '#fcf8fb',
  },
  lineTitle: { fontSize: 13, color: '#342733', fontWeight: '700' },
  receipt: { fontSize: 16, color: '#633f56', fontWeight: '800' },
  saved: { padding: 14, gap: 9, borderRadius: 12, backgroundColor: '#f4eaf0' },
  online: { fontSize: 11, color: '#567359', fontWeight: '700' },
  loading: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  error: {
    padding: 12,
    color: '#9a2e2e',
    backgroundColor: '#fff0ec',
    borderRadius: 10,
    fontSize: 12,
  },
  notice: {
    padding: 12,
    color: '#633f56',
    backgroundColor: '#f4eaf0',
    borderRadius: 10,
    fontSize: 12,
    lineHeight: 18,
  },
});
