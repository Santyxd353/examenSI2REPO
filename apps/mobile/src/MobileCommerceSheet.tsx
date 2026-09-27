import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CatalogLocation, CustomerAddress } from './types';
import { checkoutBlocker } from './checkoutBlocker';

export type MobileCartLine = {
  variantId: string;
  quantity: number;
  productName: string;
  brand: string;
  size: string;
  color: string;
  price: number;
  available: number;
  imageUrl: string | null;
};

export type MobileOrder = {
  id: string;
  numero: string;
  estado: string;
  total: string | number;
  creado_en: string;
  detalle_pedido: {
    id: string;
    descripcion_snapshot: string;
    talla_snapshot: string;
    color_snapshot?: string;
    cantidad: number;
  }[];
  pago: { estado: string; proveedor: string }[];
  devolucion: { id: string; estado: string }[];
};

type Props = {
  visible: boolean;
  lines: MobileCartLine[];
  orders: MobileOrder[];
  subtotal: number;
  locations: CatalogLocation[];
  location: CatalogLocation | null;
  busy: boolean;
  error: string;
  message: string;
  addresses: CustomerAddress[];
  onClose: () => void;
  onLocationChange: (location: CatalogLocation) => void;
  onChangeQuantity: (variantId: string, quantity: number) => Promise<void>;
  onCheckout: (address: string, addressId?: string) => Promise<boolean>;
  onPay: (orderId: string, decision: 'APROBAR' | 'RECHAZAR') => Promise<void>;
  onReload: () => Promise<void>;
};

const money = (amount: number) => `Bs. ${Number(amount).toFixed(Number(amount) % 1 ? 2 : 0)}`;
const addressText = (address: CustomerAddress) =>
  `${address.destinatario}, ${address.telefono}. ${address.ciudad}, ${address.zona}. ${address.detalle}`;

export function MobileCommerceSheet({
  visible,
  lines,
  orders,
  subtotal,
  locations,
  location,
  busy,
  error,
  message,
  addresses,
  onClose,
  onLocationChange,
  onChangeQuantity,
  onCheckout,
  onPay,
  onReload,
}: Props) {
  const [tab, setTab] = useState<'cart' | 'orders'>('cart');
  const [address, setAddress] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState<string>();
  const [checkoutFeedback, setCheckoutFeedback] = useState('');
  const unavailable = lines.some((line) => line.available < line.quantity || line.price <= 0);

  useEffect(() => {
    if (!visible || !addresses.length) return;
    const preferred =
      addresses.find((item) => item.id === selectedAddressId) ||
      addresses.find((item) => item.predeterminada) ||
      addresses[0];
    if (preferred) {
      setSelectedAddressId(preferred.id);
      setAddress(addressText(preferred));
    }
  }, [visible, addresses]);

  async function checkout() {
    const blocker = checkoutBlocker({
      locationSelected: Boolean(location),
      address,
      lines,
    });
    if (blocker) {
      setCheckoutFeedback(blocker);
      return;
    }
    setCheckoutFeedback('');
    if (await onCheckout(address.trim(), selectedAddressId)) {
      setTab('orders');
      setAddress('');
    }
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.dismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Mi compra</Text>
              <Text style={styles.subtitle}>Carrito persistente y pedidos</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable
              style={[styles.tab, tab === 'cart' && styles.tabActive]}
              onPress={() => setTab('cart')}
            >
              <Text style={[styles.tabText, tab === 'cart' && styles.tabTextActive]}>
                Carrito ({lines.reduce((total, line) => total + line.quantity, 0)})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === 'orders' && styles.tabActive]}
              onPress={() => {
                setTab('orders');
                void onReload();
              }}
            >
              <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>
                Pedidos ({orders.length})
              </Text>
            </Pressable>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}

          {tab === 'cart' ? (
            <CartContent
              lines={lines}
              subtotal={subtotal}
              locations={locations}
              location={location}
              address={address}
              addresses={addresses}
              selectedAddressId={selectedAddressId}
              busy={busy}
              unavailable={unavailable}
              checkoutFeedback={checkoutFeedback}
              onAddressChange={(value) => {
                setCheckoutFeedback('');
                setAddress(value);
              }}
              onSelectAddress={(selected) => {
                setCheckoutFeedback('');
                setSelectedAddressId(selected?.id);
                setAddress(selected ? addressText(selected) : '');
              }}
              onLocationChange={(selected) => {
                setCheckoutFeedback('');
                onLocationChange(selected);
              }}
              onChangeQuantity={async (variantId, quantity) => {
                setCheckoutFeedback('');
                await onChangeQuantity(variantId, quantity);
              }}
              onCheckout={checkout}
            />
          ) : (
            <OrdersContent orders={orders} busy={busy} onPay={onPay} />
          )}
        </View>
      </View>
    </Modal>
  );
}

function CartContent({
  lines,
  subtotal,
  locations,
  location,
  address,
  addresses,
  selectedAddressId,
  busy,
  unavailable,
  checkoutFeedback,
  onAddressChange,
  onSelectAddress,
  onLocationChange,
  onChangeQuantity,
  onCheckout,
}: {
  lines: MobileCartLine[];
  subtotal: number;
  locations: CatalogLocation[];
  location: CatalogLocation | null;
  address: string;
  addresses: CustomerAddress[];
  selectedAddressId?: string;
  busy: boolean;
  unavailable: boolean;
  checkoutFeedback: string;
  onAddressChange: (value: string) => void;
  onSelectAddress: (value?: CustomerAddress) => void;
  onLocationChange: (location: CatalogLocation) => void;
  onChangeQuantity: (variantId: string, quantity: number) => Promise<void>;
  onCheckout: () => Promise<void>;
}) {
  if (!lines.length)
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>⌑</Text>
        <Text style={styles.emptyTitle}>Tu carrito está vacío</Text>
        <Text style={styles.emptyText}>Agrega prendas del catálogo para comenzar una compra.</Text>
      </View>
    );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionLabel}>Sucursal o almacén</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.locations}
      >
        {locations.map((item) => (
          <Pressable
            key={item.id}
            style={[styles.location, item.id === location?.id && styles.locationActive]}
            onPress={() => onLocationChange(item)}
          >
            <Text
              style={[styles.locationText, item.id === location?.id && styles.locationTextActive]}
            >
              {item.tipo === 'TIENDA' ? 'Sucursal' : 'Almacén'} {item.nombre}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.lines}>
        {lines.map((line) => (
          <View key={line.variantId} style={styles.cartLine}>
            {line.imageUrl ? (
              <Image
                source={{ uri: line.imageUrl }}
                style={styles.cartImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.cartImageFallback}>
                <Text style={styles.cartImageLetter}>{line.productName.slice(0, 1)}</Text>
              </View>
            )}
            <View style={styles.cartCopy}>
              <Text numberOfLines={1} style={styles.cartName}>
                {line.productName}
              </Text>
              <Text style={styles.cartMeta}>
                {line.brand} · {line.size} · {line.color}
              </Text>
              <Text style={styles.cartPrice}>{money(line.price)}</Text>
              <Text
                style={[styles.availability, line.available < line.quantity && styles.unavailable]}
              >
                {line.available} disponibles en esta ubicación
              </Text>
            </View>
            <View style={styles.quantity}>
              <Pressable
                disabled={busy}
                style={styles.quantityButton}
                onPress={() => void onChangeQuantity(line.variantId, line.quantity - 1)}
              >
                <Text style={styles.quantityText}>−</Text>
              </Pressable>
              <Text style={styles.quantityValue}>{line.quantity}</Text>
              <Pressable
                disabled={busy || line.quantity >= line.available}
                style={styles.quantityButton}
                onPress={() => void onChangeQuantity(line.variantId, line.quantity + 1)}
              >
                <Text style={styles.quantityText}>+</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.subtotalRow}>
        <Text style={styles.subtotalLabel}>Subtotal estimado</Text>
        <Text style={styles.subtotalValue}>{money(subtotal)}</Text>
      </View>

      <Text style={styles.sectionLabel}>Dirección de entrega o retiro</Text>
      {!!addresses.length && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.addressChoices}
        >
          {addresses.map((item) => (
            <Pressable
              key={item.id}
              style={[
                styles.addressChoice,
                item.id === selectedAddressId && styles.addressChoiceActive,
              ]}
              onPress={() => onSelectAddress(item)}
            >
              <Text
                style={[
                  styles.addressChoiceText,
                  item.id === selectedAddressId && styles.addressChoiceTextActive,
                ]}
              >
                {item.alias}
                {item.predeterminada ? ' · Principal' : ''}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[styles.addressChoice, !selectedAddressId && styles.addressChoiceActive]}
            onPress={() => onSelectAddress(undefined)}
          >
            <Text
              style={[
                styles.addressChoiceText,
                !selectedAddressId && styles.addressChoiceTextActive,
              ]}
            >
              Otra dirección
            </Text>
          </Pressable>
        </ScrollView>
      )}
      <TextInput
        multiline
        value={address}
        onChangeText={(value) => {
          if (selectedAddressId) onSelectAddress(undefined);
          onAddressChange(value);
        }}
        maxLength={400}
        placeholder="Ciudad, zona, calle y número; o retiro en la sucursal seleccionada"
        placeholderTextColor="#929792"
        style={styles.address}
      />
      <Text style={styles.counter}>{address.trim().length}/400 · mínimo 10 caracteres</Text>

      {unavailable && (
        <Text style={styles.warning}>
          Ajusta las cantidades o selecciona otra ubicación con existencias suficientes.
        </Text>
      )}

      <Pressable
        disabled={busy}
        style={[
          styles.checkoutButton,
          busy && styles.disabled,
        ]}
        onPress={() => void onCheckout()}
      >
        <Text style={styles.checkoutText}>{busy ? 'Procesando…' : 'Confirmar pedido  →'}</Text>
      </Pressable>
      {!!checkoutFeedback && <Text style={styles.warning}>{checkoutFeedback}</Text>}
      <Text style={styles.disclaimer}>
        El stock se reserva por 15 minutos. El pago de esta versión es una demostración y no cobra
        dinero real.
      </Text>
    </ScrollView>
  );
}

function OrdersContent({
  orders,
  busy,
  onPay,
}: {
  orders: MobileOrder[];
  busy: boolean;
  onPay: (orderId: string, decision: 'APROBAR' | 'RECHAZAR') => Promise<void>;
}) {
  if (!orders.length)
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>◇</Text>
        <Text style={styles.emptyTitle}>Todavía no tienes pedidos</Text>
        <Text style={styles.emptyText}>Cuando confirmes una compra aparecerá aquí.</Text>
      </View>
    );

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
      {orders.map((order) => (
        <View key={order.id} style={styles.order}>
          <View style={styles.orderHeader}>
            <View style={styles.orderTitleCopy}>
              <Text style={styles.orderNumber}>{order.numero}</Text>
              <Text style={styles.orderDate}>
                {new Date(order.creado_en).toLocaleString('es-BO')}
              </Text>
            </View>
            <View style={[styles.status, order.estado === 'CONFIRMADO' && styles.statusSuccess]}>
              <Text
                style={[
                  styles.statusText,
                  order.estado === 'CONFIRMADO' && styles.statusTextSuccess,
                ]}
              >
                {order.estado.replaceAll('_', ' ')}
              </Text>
            </View>
          </View>
          {order.detalle_pedido.map((line) => (
            <Text key={line.id} style={styles.orderLine}>
              {line.cantidad} × {line.descripcion_snapshot} · {line.talla_snapshot}
            </Text>
          ))}
          <View style={styles.orderTotalRow}>
            <Text style={styles.orderTotalLabel}>Total</Text>
            <Text style={styles.orderTotal}>{money(Number(order.total))}</Text>
          </View>
          {order.estado === 'PENDIENTE_PAGO' && (
            <View style={styles.paymentBox}>
              <Text style={styles.paymentTitle}>Pago de demostración</Text>
              <Text style={styles.paymentCopy}>
                Aprueba para confirmar el pedido o rechaza para liberar la reserva.
              </Text>
              <View style={styles.paymentActions}>
                <Pressable
                  disabled={busy}
                  style={[styles.approveButton, busy && styles.disabled]}
                  onPress={() => void onPay(order.id, 'APROBAR')}
                >
                  <Text style={styles.approveText}>Aprobar prueba</Text>
                </Pressable>
                <Pressable
                  disabled={busy}
                  style={[styles.rejectButton, busy && styles.disabled]}
                  onPress={() => void onPay(order.id, 'RECHAZAR')}
                >
                  <Text style={styles.rejectText}>Rechazar</Text>
                </Pressable>
              </View>
            </View>
          )}
          {!!order.devolucion.length && (
            <Text style={styles.returnText}>
              Devolución: {order.devolucion[0]!.estado.toLowerCase()}
            </Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const green = '#173e2a';
const cream = '#fbfaf6';
const border = '#e5e4dc';

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#1118', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    height: '88%',
    backgroundColor: cream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#c8cbc5',
    marginTop: 9,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#1b2720', fontSize: 21, fontWeight: '900' },
  subtitle: { color: '#7b827d', fontSize: 10, marginTop: 3 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#27352d', fontSize: 25, lineHeight: 27 },
  tabs: { flexDirection: 'row', marginTop: 14, borderBottomWidth: 1, borderBottomColor: border },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: green },
  tabText: { color: '#7a817c', fontSize: 11, fontWeight: '700' },
  tabTextActive: { color: green, fontWeight: '900' },
  error: {
    color: '#9f382d',
    backgroundColor: '#fff0ec',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    fontSize: 10,
  },
  message: {
    color: '#225f3c',
    backgroundColor: '#e8f4ea',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
    fontSize: 10,
  },
  scrollContent: { paddingVertical: 14, paddingBottom: 24 },
  sectionLabel: { color: '#26332b', fontSize: 11, fontWeight: '900', marginBottom: 9 },
  locations: { gap: 7, paddingBottom: 13 },
  location: {
    borderWidth: 1,
    borderColor: '#d4d7d1',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  locationActive: { backgroundColor: green, borderColor: green },
  locationText: { color: '#535b55', fontSize: 9 },
  locationTextActive: { color: '#fff', fontWeight: '800' },
  lines: { borderTopWidth: 1, borderTopColor: border },
  cartLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: border,
    gap: 9,
  },
  cartImage: { width: 56, height: 67, borderRadius: 7, backgroundColor: '#f1f1ec' },
  cartImageFallback: {
    width: 56,
    height: 67,
    borderRadius: 7,
    backgroundColor: '#e5e3d9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartImageLetter: { color: '#fff', fontSize: 24, fontWeight: '900' },
  cartCopy: { flex: 1 },
  cartName: { color: '#1f2923', fontSize: 11, fontWeight: '900' },
  cartMeta: { color: '#858b86', fontSize: 8, marginTop: 3 },
  cartPrice: { color: '#152119', fontSize: 11, fontWeight: '900', marginTop: 5 },
  availability: { color: '#778078', fontSize: 8, marginTop: 2 },
  unavailable: { color: '#d42851' },
  quantity: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dddeda',
    borderRadius: 5,
    overflow: 'hidden',
  },
  quantityButton: {
    width: 27,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f7f3',
  },
  quantityText: { color: '#334139', fontSize: 15 },
  quantityValue: { width: 25, textAlign: 'center', color: '#202b24', fontSize: 11 },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  subtotalLabel: { color: '#374139', fontSize: 12, fontWeight: '700' },
  subtotalValue: { color: '#132018', fontSize: 19, fontWeight: '900' },
  address: {
    minHeight: 82,
    borderWidth: 1,
    borderColor: '#d7d9d4',
    borderRadius: 9,
    backgroundColor: '#fff',
    padding: 12,
    color: '#283229',
    fontSize: 11,
    textAlignVertical: 'top',
  },
  addressChoices: { gap: 7, paddingBottom: 9 },
  addressChoice: {
    borderWidth: 1,
    borderColor: '#d4d7d1',
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: '#fff',
  },
  addressChoiceActive: { backgroundColor: green, borderColor: green },
  addressChoiceText: { color: '#596159', fontSize: 9 },
  addressChoiceTextActive: { color: '#fff', fontWeight: '800' },
  counter: { color: '#929793', fontSize: 8, textAlign: 'right', marginTop: 4 },
  warning: {
    color: '#a84b35',
    backgroundColor: '#fff3ec',
    borderRadius: 7,
    padding: 9,
    fontSize: 9,
    marginTop: 10,
  },
  checkoutButton: {
    minHeight: 48,
    backgroundColor: green,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  checkoutText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  disabled: { opacity: 0.38 },
  disclaimer: { color: '#8b918c', fontSize: 8, lineHeight: 12, textAlign: 'center', marginTop: 8 },
  empty: { flex: 1, minHeight: 290, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyIcon: { color: '#96a099', fontSize: 42 },
  emptyTitle: { color: '#26322a', fontSize: 15, fontWeight: '900', marginTop: 8 },
  emptyText: { color: '#808681', fontSize: 10, textAlign: 'center', marginTop: 5 },
  order: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: border,
    padding: 13,
    marginBottom: 10,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  orderTitleCopy: { flex: 1 },
  orderNumber: { color: '#1c2820', fontSize: 11, fontWeight: '900' },
  orderDate: { color: '#8b908c', fontSize: 8, marginTop: 3 },
  status: {
    borderRadius: 11,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: '#fff0dc',
  },
  statusSuccess: { backgroundColor: '#e5f3e8' },
  statusText: { color: '#995e1d', fontSize: 7, fontWeight: '900' },
  statusTextSuccess: { color: '#23673e' },
  orderLine: { color: '#626a64', fontSize: 9, paddingTop: 8 },
  orderTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#efefe9',
    marginTop: 10,
    paddingTop: 10,
  },
  orderTotalLabel: { color: '#677069', fontSize: 10, fontWeight: '700' },
  orderTotal: { color: green, fontSize: 15, fontWeight: '900' },
  paymentBox: { backgroundColor: '#f3f3ec', borderRadius: 8, padding: 10, marginTop: 11 },
  paymentTitle: { color: '#27342c', fontSize: 10, fontWeight: '900' },
  paymentCopy: { color: '#747b76', fontSize: 8, lineHeight: 12, marginTop: 3 },
  paymentActions: { flexDirection: 'row', gap: 7, marginTop: 9 },
  approveButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 6,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  rejectButton: {
    flex: 0.7,
    minHeight: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#d4b1a7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { color: '#9f382d', fontSize: 9, fontWeight: '800' },
  returnText: { color: '#825c23', fontSize: 8, marginTop: 8 },
});
