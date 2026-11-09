import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { api } from './api';
import type { CatalogLocation, CustomerAddress } from './types';
import { checkoutBlocker } from './checkoutBlocker';
import {
  demoWalletIntent,
  stripeSessionForOrder,
  stripePaymentFeedback,
  qrPaymentFeedback,
} from './checkoutPayments';
import { useSystemBars } from './systemBars';

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
  pago: { estado: string; proveedor: string; referencia?: string | null }[];
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
  onReload: () => Promise<void>;
};

const money = (amount: number) => `Bs. ${Number(amount).toFixed(Number(amount) % 1 ? 2 : 0)}`;
const addressText = (address: CustomerAddress) =>
  `${address.destinatario}, ${address.telefono}. ${address.ciudad}, ${address.zona}. ${address.detalle}`;
const paymentQrPayload = (order: Pick<MobileOrder, 'id' | 'total'>) =>
  `LUMINA-PAY-DEMO:${order.id}:${Number(order.total).toFixed(2)}:BOB`;

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
  onReload,
}: Props) {
  const insets = useSystemBars();
  const [tab, setTab] = useState<'cart' | 'orders'>('cart');
  const [address, setAddress] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState<string>();
  const [checkoutFeedback, setCheckoutFeedback] = useState('');
  const [paymentOrder, setPaymentOrder] = useState<MobileOrder | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [stripeEnabled, setStripeEnabled] = useState(false);
  const [stripeSessionId, setStripeSessionId] = useState('');
  const [stripeBusy, setStripeBusy] = useState(false);
  const [stripeError, setStripeError] = useState('');
  const [stripeMessage, setStripeMessage] = useState('');
  const paymentFlight = useRef(false);
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

  useEffect(() => {
    if (!visible) return;
    void api('/commerce/payment-options')
      .then((options: { stripeTest: boolean }) => setStripeEnabled(Boolean(options.stripeTest)))
      .catch(() => setStripeEnabled(false));
  }, [visible]);

  async function verifyStripe() {
    if (!stripeSessionId || paymentFlight.current) return;
    paymentFlight.current = true;
    setStripeBusy(true);
    setStripeError('');
    try {
      const result: { pagado: boolean; estado: string } = await api(
        `/commerce/stripe-test-checkout?session_id=${encodeURIComponent(stripeSessionId)}`,
      );
      await onReload();
      const feedback = stripePaymentFeedback(result);
      setStripeMessage(feedback.message);
      if (feedback.done) {
        setStripeSessionId('');
        setPaymentOrder(null);
      }
    } catch (reason) {
      setStripeError((reason as Error).message);
    } finally {
      paymentFlight.current = false;
      setStripeBusy(false);
    }
  }

  useEffect(() => {
    if (paymentOrder) setStripeSessionId(stripeSessionForOrder(paymentOrder) ?? '');
  }, [paymentOrder]);

  useEffect(() => {
    if (!stripeSessionId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void verifyStripe();
    });
    return () => subscription.remove();
  }, [stripeSessionId]);

  useEffect(() => {
    if (!paymentOrder || paymentOrder.pago[0]?.proveedor === 'STRIPE_TEST') return;
    const interval = setInterval(() => void onReload().catch(() => {}), 3000);
    return () => clearInterval(interval);
  }, [paymentOrder?.id, paymentOrder?.pago[0]?.proveedor, onReload]);

  useEffect(() => {
    if (!paymentOrder) return;
    const current = orders.find((order) => order.id === paymentOrder.id);
    if (current && current.estado !== 'PENDIENTE_PAGO') {
      setPaymentOrder(null);
      setStripeMessage(
        current.estado === 'CONFIRMADO'
          ? 'Pago confirmado. Tu pedido está listo para continuar.'
          : `El pedido cambió a ${current.estado.replaceAll('_', ' ')}.`,
      );
    }
  }, [orders, paymentOrder]);

  async function openStripe(order: MobileOrder) {
    if (paymentFlight.current) return;
    paymentFlight.current = true;
    setStripeBusy(true);
    setStripeError('');
    setStripeMessage('');
    try {
      const checkout: { url: string; sessionId: string } = await api(
        `/commerce/orders/${order.id}/stripe-test-checkout`,
        { method: 'POST' },
      );
      setStripeSessionId(checkout.sessionId);
      setPaymentOrder({
        ...order,
        pago: order.pago.map((payment) => ({
          ...payment,
          proveedor: 'STRIPE_TEST',
          referencia: checkout.sessionId,
        })),
      });
      await Linking.openURL(checkout.url);
    } catch (reason) {
      setStripeError((reason as Error).message);
    } finally {
      paymentFlight.current = false;
      setStripeBusy(false);
    }
  }

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
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Mi compra</Text>
              <Text style={styles.subtitle}>Carrito persistente y pedidos</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable style={styles.walletButton} onPress={() => setWalletOpen(true)}>
                <Text style={styles.walletButtonText}>Lúmina Pay</Text>
              </Pressable>
              <Pressable style={styles.closeButton} onPress={onClose}>
                <Text style={styles.closeText}>×</Text>
              </Pressable>
            </View>
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
          {!!stripeMessage && <Text style={styles.message}>{stripeMessage}</Text>}

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
            <OrdersContent orders={orders} busy={busy} onOpenPayment={setPaymentOrder} />
          )}
        </View>
        <DemoPaymentSheet
          order={paymentOrder}
          busy={busy || stripeBusy}
          stripeEnabled={stripeEnabled}
          stripePending={Boolean(stripeSessionId)}
          stripeError={stripeError}
          onClose={() => setPaymentOrder(null)}
          onStripe={() => paymentOrder && openStripe(paymentOrder)}
          onVerifyStripe={verifyStripe}
        />
        <DemoWalletScanner
          visible={walletOpen}
          onClose={() => setWalletOpen(false)}
          onPaid={async () => {
            await onReload();
          }}
        />
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
        style={[styles.checkoutButton, busy && styles.disabled]}
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
  onOpenPayment,
}: {
  orders: MobileOrder[];
  busy: boolean;
  onOpenPayment: (order: MobileOrder) => void;
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
              <Text style={styles.paymentTitle}>Pago de prueba</Text>
              <Text style={styles.paymentCopy}>
                Paga con Stripe Checkout o escanea el QR de demostración. No se cobra dinero real.
              </Text>
              <View style={styles.paymentActions}>
                <Pressable
                  disabled={busy}
                  style={[styles.approveButton, busy && styles.disabled]}
                  onPress={() => onOpenPayment(order)}
                >
                  <Text style={styles.approveText}>Abrir pasarela</Text>
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

function DemoPaymentSheet({
  order,
  busy,
  stripeEnabled,
  stripePending,
  stripeError,
  onClose,
  onStripe,
  onVerifyStripe,
}: {
  order: MobileOrder | null;
  busy: boolean;
  stripeEnabled: boolean;
  stripePending: boolean;
  stripeError: string;
  onClose: () => void;
  onStripe: () => void;
  onVerifyStripe: () => void;
}) {
  if (!order) return null;
  const stripeOrder = order.pago[0]?.proveedor === 'STRIPE_TEST';

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.gatewayOverlay}>
        <View style={styles.gatewayCard}>
          <Text style={styles.gatewayBadge}>✓ ENTORNO DE PRUEBA</Text>
          <Text style={styles.gatewayTitle}>Finaliza tu compra</Text>
          <Text style={styles.gatewayCopy}>
            Pedido {order.numero}\nTotal {money(Number(order.total))}
          </Text>
          <Text style={styles.gatewayNotice}>
            Stripe funciona en modo de prueba. El QR es una simulación académica.
          </Text>
          {!stripeOrder && (
            <>
              <Text style={styles.gatewayLabel}>QR generado para este pedido</Text>
              <View style={styles.gatewayQr}>
                <QRCode
                  value={paymentQrPayload(order)}
                  size={176}
                  color={green}
                  backgroundColor="#fff"
                />
                <Text style={styles.gatewayQrText}>
                  Escanéalo desde Lúmina Pay Demo en otro dispositivo.
                </Text>
              </View>
              <Text style={styles.gatewayWaiting}>Esperando el escaneo del QR…</Text>
            </>
          )}
          {stripeEnabled && (
            <Pressable
              disabled={busy}
              style={[styles.gatewayPay, busy && styles.disabled]}
              onPress={onStripe}
            >
              <Text style={styles.gatewayPayText}>
                {busy ? 'Abriendo Stripe…' : 'Pagar con Stripe Checkout'}
              </Text>
            </Pressable>
          )}
          {stripeEnabled && (
            <Text style={styles.gatewayNotice}>
              Stripe se abrirá en el navegador. Regresa a la app para comprobar el pago.
            </Text>
          )}
          {stripePending && (
            <Pressable disabled={busy} style={styles.gatewayPay} onPress={onVerifyStripe}>
              <Text style={styles.gatewayPayText}>Comprobar pago de Stripe</Text>
            </Pressable>
          )}
          {!!stripeError && <Text style={styles.error}>{stripeError}</Text>}
          <Pressable disabled={busy} style={styles.gatewayCancel} onPress={onClose}>
            <Text style={styles.gatewayCancelText}>Cerrar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DemoWalletScanner({
  visible,
  onClose,
  onPaid,
}: {
  visible: boolean;
  onClose: () => void;
  onPaid: () => Promise<void>;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [handled, setHandled] = useState(false);
  const [completed, setCompleted] = useState(false);
  const scanFlight = useRef(false);
  const [status, setStatus] = useState('Apunta la cámara al QR de Lúmina Pay Demo.');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setHandled(false);
    setCompleted(false);
    setError('');
    setStatus('Apunta la cámara al QR de Lúmina Pay Demo.');
  }, [visible]);

  async function scan(qr: string) {
    if (handled || scanFlight.current) return;
    scanFlight.current = true;
    setHandled(true);
    setError('');
    setStatus('Verificando pedido y monto…');
    try {
      const order = await api<MobileOrder>('/commerce/demo-wallet/scan', {
        method: 'POST',
        body: JSON.stringify(demoWalletIntent(qr)),
      });
      await onPaid();
      const feedback = qrPaymentFeedback(order);
      setStatus(feedback.message + ' · ' + money(Number(order.total)));
      setCompleted(feedback.done);
    } catch (reason) {
      setError((reason as Error).message);
      setStatus('No se pudo procesar el QR. Revísalo e inténtalo nuevamente.');
    } finally {
      scanFlight.current = false;
    }
  }

  if (!visible) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.walletOverlay}>
        <View style={styles.walletCard}>
          <View style={styles.walletHeader}>
            <View>
              <Text style={styles.walletTitle}>Lúmina Pay Demo</Text>
              <Text style={styles.walletSubtitle}>Billetera de pruebas</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          {!permission ? (
            <View style={styles.walletState}>
              <ActivityIndicator color={green} />
            </View>
          ) : !permission.granted ? (
            <View style={styles.walletState}>
              <Text style={styles.walletCopy}>
                La cámara solo se usa para leer el QR de prueba.
              </Text>
              <Pressable style={styles.gatewayPay} onPress={() => void requestPermission()}>
                <Text style={styles.gatewayPayText}>Permitir cámara</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.walletScanner}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={handled ? undefined : (event) => void scan(event.data)}
              />
              <View pointerEvents="none" style={styles.walletGuide}>
                <View style={styles.walletGuideCorner} />
              </View>
            </View>
          )}
          <Text style={styles.walletStatus}>{status}</Text>
          {!!error && <Text style={styles.walletError}>{error}</Text>}
          {handled && !error && completed ? (
            <Pressable style={styles.gatewayPay} onPress={onClose}>
              <Text style={styles.gatewayPayText}>Listo</Text>
            </Pressable>
          ) : handled ? (
            <Pressable
              style={styles.walletRetry}
              onPress={() => {
                setHandled(false);
                setError('');
                setStatus('Apunta la cámara al QR de Lúmina Pay Demo.');
              }}
            >
              <Text style={styles.walletRetryText}>Escanear nuevamente</Text>
            </Pressable>
          ) : null}
          <Text style={styles.walletDisclaimer}>
            Simulación académica: ningún banco, tarjeta ni saldo real interviene en este pago.
          </Text>
        </View>
      </View>
    </Modal>
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
    paddingBottom: 18,
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
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#1b2720', fontSize: 21, fontWeight: '900' },
  subtitle: { color: '#7b827d', fontSize: 10, marginTop: 3 },
  walletButton: {
    minHeight: 32,
    paddingHorizontal: 9,
    borderRadius: 16,
    backgroundColor: '#e7f1e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletButtonText: { color: green, fontSize: 8, fontWeight: '900' },
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
  gatewayOverlay: {
    flex: 1,
    backgroundColor: '#111a',
    padding: 22,
    justifyContent: 'center',
  },
  gatewayCard: { backgroundColor: cream, borderRadius: 18, padding: 21 },
  gatewayBadge: {
    alignSelf: 'flex-start',
    color: '#23673e',
    backgroundColor: '#e5f3e8',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    overflow: 'hidden',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1,
  },
  gatewayTitle: { color: green, fontSize: 25, fontWeight: '900', marginTop: 15 },
  gatewayCopy: { color: '#38443c', fontSize: 11, lineHeight: 17, marginTop: 7, fontWeight: '700' },
  gatewayNotice: { color: '#737c75', fontSize: 9, lineHeight: 13, marginTop: 9 },
  gatewayLabel: {
    color: '#354139',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 16,
    marginBottom: 7,
  },
  gatewayQr: {
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d7dcd6',
    borderRadius: 9,
    padding: 13,
  },
  gatewayQrText: { color: '#657066', fontSize: 9, textAlign: 'center', lineHeight: 13 },
  gatewayCancel: { flex: 1, minHeight: 43, alignItems: 'center', justifyContent: 'center' },
  gatewayCancelText: { color: '#667068', fontSize: 10, fontWeight: '800' },
  gatewayPay: {
    minHeight: 46,
    marginTop: 8,
    borderRadius: 8,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gatewayPayText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  gatewayWaiting: {
    color: '#276743',
    backgroundColor: '#e7f1e8',
    borderRadius: 8,
    paddingVertical: 13,
    textAlign: 'center',
    marginTop: 8,
    fontSize: 10,
    fontWeight: '800',
  },
  walletOverlay: { flex: 1, backgroundColor: '#111b', padding: 20, justifyContent: 'center' },
  walletCard: { backgroundColor: cream, borderRadius: 18, padding: 18 },
  walletHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletTitle: { color: green, fontSize: 20, fontWeight: '900' },
  walletSubtitle: { color: '#758078', fontSize: 9, marginTop: 3 },
  walletState: { minHeight: 185, alignItems: 'center', justifyContent: 'center', gap: 13 },
  walletCopy: { color: '#606a62', fontSize: 10, textAlign: 'center', lineHeight: 15 },
  walletScanner: {
    height: 268,
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: '#27342c',
    marginTop: 16,
  },
  walletGuide: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  walletGuideCorner: {
    width: 176,
    height: 176,
    borderWidth: 2,
    borderColor: '#ffffffcc',
    borderRadius: 18,
  },
  walletStatus: {
    color: '#405046',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 15,
  },
  walletError: {
    color: '#9f382d',
    backgroundColor: '#fff0ec',
    borderRadius: 7,
    padding: 9,
    fontSize: 9,
    marginTop: 10,
  },
  walletRetry: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: '#b9c7bb',
    borderRadius: 8,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletRetryText: { color: green, fontSize: 10, fontWeight: '800' },
  walletDisclaimer: {
    color: '#89908a',
    fontSize: 8,
    lineHeight: 12,
    textAlign: 'center',
    marginTop: 13,
  },
});
