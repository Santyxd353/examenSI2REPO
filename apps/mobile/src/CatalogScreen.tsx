import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { API_URL, api } from './api';
import { AccountSheet, type AddressInput } from './AccountSheet';
import { MobileCommerceSheet, type MobileCartLine, type MobileOrder } from './MobileCommerceSheet';
import type {
  Catalog,
  CatalogLocation,
  CustomerProfile,
  Identity,
  Product,
  Variant,
} from './types';

type Props = {
  user: Identity;
  catalog: Catalog;
  loading: boolean;
  error: string;
  location: CatalogLocation | null;
  brand: string;
  color: string;
  size: string;
  search: string;
  category: string;
  onLocationChange: (value: CatalogLocation) => void;
  onBrandChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onSizeChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onClearFilters: () => void;
  onTryAr: (product: Product, variant: Variant) => void;
  onCatalogRefresh: () => Promise<void>;
  onIdentityChange: (identity: Identity) => void;
  onAdminMode?: () => void;
  onLogout: () => void;
};

const serverUrl = API_URL.replace(/\/api$/, '');
const money = (amount: number) => `Bs. ${Number(amount).toFixed(amount % 1 ? 2 : 0)}`;

function productImage(product: Product) {
  const image = product.imagenes?.[0];
  return image ? `${serverUrl}${image.url}` : null;
}

function operationId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function CatalogScreen({
  user,
  catalog,
  loading,
  error,
  location,
  brand,
  color,
  size,
  search,
  category,
  onLocationChange,
  onBrandChange,
  onColorChange,
  onSizeChange,
  onSearchChange,
  onCategoryChange,
  onClearFilters,
  onTryAr,
  onCatalogRefresh,
  onIdentityChange,
  onAdminMode,
  onLogout,
}: Props) {
  const topInset = Platform.OS === 'android' ? NativeStatusBar.currentHeight || 24 : 0;
  const measuredSystemBars =
    Dimensions.get('screen').height - Dimensions.get('window').height - topInset;
  const bottomInset = Platform.OS === 'android' ? Math.max(24, measuredSystemBars) : 12;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [cartLines, setCartLines] = useState<MobileCartLine[]>([]);
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [commerceBusy, setCommerceBusy] = useState(false);
  const [commerceError, setCommerceError] = useState('');
  const [commerceMessage, setCommerceMessage] = useState('');
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileMessage, setProfileMessage] = useState('');

  const products = useMemo(
    () =>
      favoritesOnly
        ? catalog.products.filter((product) => favorites[product.id])
        : catalog.products,
    [catalog.products, favorites, favoritesOnly],
  );
  const cartCount = cartLines.reduce((total, line) => total + line.quantity, 0);
  const favoriteCount = Object.values(favorites).filter(Boolean).length;
  const subtotal = cartLines.reduce((total, line) => total + Number(line.price) * line.quantity, 0);
  const activeFilters = [brand, color, size, category].filter(Boolean).length;

  function variantFor(product: Product) {
    return (
      product.variantes.find((variant) => variant.id === selectedVariants[product.id]) ??
      product.variantes[0]
    );
  }

  async function loadCommerce() {
    try {
      const [serverCart, nextOrders, locationCatalog] = await Promise.all([
        api('/commerce/cart'),
        api('/commerce/orders'),
        location
          ? api(`/catalog?channel=APP&location=${encodeURIComponent(location.id)}`)
          : Promise.resolve(catalog),
      ]);
      const indexed = new Map<string, { product: Product; variant: Variant }>();
      for (const product of (locationCatalog as Catalog).products)
        for (const variant of product.variantes) indexed.set(variant.id, { product, variant });
      setCartLines(
        serverCart.item_carrito.map(
          (item: {
            variante_id: string;
            cantidad: number;
            variante: {
              talla: string;
              color: string;
              producto: { nombre: string; marca?: string | null };
            };
          }) => {
            const current = indexed.get(item.variante_id);
            return {
              variantId: item.variante_id,
              quantity: item.cantidad,
              productName: current?.product.nombre || item.variante.producto.nombre,
              brand: current?.product.marca || item.variante.producto.marca || 'Sin marca',
              size: current?.variant.talla || item.variante.talla,
              color: current?.variant.color || item.variante.color,
              price: Number(current?.variant.precio || 0),
              available: current?.variant.disponible || 0,
              imageUrl: current ? productImage(current.product) : null,
            } satisfies MobileCartLine;
          },
        ),
      );
      setOrders(nextOrders);
    } catch (reason) {
      setCommerceError((reason as Error).message);
    }
  }

  useEffect(() => {
    void loadCommerce();
  }, [location?.id]);

  useEffect(() => {
    void loadProfile();
  }, [user.id]);

  async function addToCart(variant: Variant) {
    if (variant.disponible <= 0) return;
    const existing = cartLines.find((line) => line.variantId === variant.id);
    const quantity = Math.min((existing?.quantity || 0) + 1, variant.disponible);
    setCommerceBusy(true);
    setCommerceError('');
    setCommerceMessage('');
    try {
      await api('/commerce/cart/items', {
        method: 'POST',
        body: JSON.stringify({ variantId: variant.id, quantity }),
      });
      await loadCommerce();
      setCommerceMessage('Prenda agregada al carrito.');
    } catch (reason) {
      setCommerceError((reason as Error).message);
    } finally {
      setCommerceBusy(false);
    }
  }

  async function changeQuantity(variantId: string, quantity: number) {
    setCommerceBusy(true);
    setCommerceError('');
    setCommerceMessage('');
    try {
      await api('/commerce/cart/items', {
        method: 'POST',
        body: JSON.stringify({ variantId, quantity: Math.max(0, quantity) }),
      });
      await loadCommerce();
    } catch (reason) {
      setCommerceError((reason as Error).message);
    } finally {
      setCommerceBusy(false);
    }
  }

  async function checkout(address: string, addressId?: string) {
    if (!location) return false;
    setCommerceBusy(true);
    setCommerceError('');
    setCommerceMessage('');
    try {
      const order = await api('/commerce/checkout', {
        method: 'POST',
        body: JSON.stringify({
          locationId: location.id,
          address,
          ...(addressId ? { addressId } : {}),
          idempotency: operationId(),
        }),
      });
      setCommerceMessage(
        `Pedido ${order.numero} creado. Completa el pago de prueba antes de 15 minutos.`,
      );
      await Promise.all([loadCommerce(), onCatalogRefresh()]);
      return true;
    } catch (reason) {
      setCommerceError((reason as Error).message);
      return false;
    } finally {
      setCommerceBusy(false);
    }
  }

  async function pay(orderId: string, decision: 'APROBAR' | 'RECHAZAR') {
    setCommerceBusy(true);
    setCommerceError('');
    setCommerceMessage('');
    try {
      await api(`/commerce/orders/${orderId}/payment`, {
        method: 'POST',
        body: JSON.stringify({ decision, idempotency: operationId() }),
      });
      setCommerceMessage(
        decision === 'APROBAR'
          ? 'Pago de prueba aprobado. El pedido quedó confirmado.'
          : 'Pago de prueba rechazado. La reserva fue liberada.',
      );
      await Promise.all([loadCommerce(), onCatalogRefresh()]);
    } catch (reason) {
      setCommerceError((reason as Error).message);
    } finally {
      setCommerceBusy(false);
    }
  }

  async function loadProfile() {
    setProfileLoading(true);
    setProfileError('');
    try {
      const next = (await api('/profile')) as CustomerProfile;
      setProfile(next);
      onIdentityChange(next.identity);
    } catch (reason) {
      setProfileError((reason as Error).message);
    } finally {
      setProfileLoading(false);
    }
  }

  async function saveProfile(input: {
    nombres: string;
    apellidos: string;
    telefono: string | null;
  }) {
    setProfileBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const next = (await api('/profile', {
        method: 'PATCH',
        body: JSON.stringify(input),
      })) as CustomerProfile;
      setProfile(next);
      onIdentityChange(next.identity);
      setProfileMessage('Perfil actualizado correctamente.');
      return true;
    } catch (reason) {
      setProfileError((reason as Error).message);
      return false;
    } finally {
      setProfileBusy(false);
    }
  }

  async function saveAddress(input: AddressInput, id?: string) {
    setProfileBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const next = (await api(id ? `/profile/addresses/${id}` : '/profile/addresses', {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      })) as CustomerProfile;
      setProfile(next);
      setProfileMessage(id ? 'Dirección actualizada.' : 'Dirección agregada.');
      return true;
    } catch (reason) {
      setProfileError((reason as Error).message);
      return false;
    } finally {
      setProfileBusy(false);
    }
  }

  async function makeDefaultAddress(id: string) {
    setProfileBusy(true);
    setProfileError('');
    setProfileMessage('');
    try {
      const next = (await api(`/profile/addresses/${id}/default`, {
        method: 'POST',
      })) as CustomerProfile;
      setProfile(next);
      setProfileMessage('Dirección principal actualizada.');
    } catch (reason) {
      setProfileError((reason as Error).message);
    } finally {
      setProfileBusy(false);
    }
  }

  function deleteAddress(id: string) {
    Alert.alert(
      'Eliminar dirección',
      'La dirección dejará de estar disponible para nuevas compras.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setProfileBusy(true);
              setProfileError('');
              setProfileMessage('');
              try {
                const next = (await api(`/profile/addresses/${id}`, {
                  method: 'DELETE',
                })) as CustomerProfile;
                setProfile(next);
                setProfileMessage('Dirección eliminada.');
              } catch (reason) {
                setProfileError((reason as Error).message);
              } finally {
                setProfileBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  function resetHome() {
    setFavoritesOnly(false);
    onClearFilters();
  }

  return (
    <SafeAreaView style={[styles.safe, { paddingTop: topInset }]}>
      <StatusBar style="dark" />
      <NativeStatusBar barStyle="dark-content" backgroundColor="#fbfaf6" />
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={resetHome}>
          <Text style={styles.logo}>lúmina°</Text>
          <Text style={styles.logoSub}>MODA FEMENINA</Text>
        </Pressable>
        <View style={styles.headerActions}>
          <HeaderAction
            icon={favoritesOnly ? '♥' : '♡'}
            count={favoriteCount}
            label="Favoritos"
            onPress={() => setFavoritesOnly((value) => !value)}
          />
          <HeaderAction
            icon="⌑"
            count={cartCount}
            label="Carrito"
            onPress={() => setCartOpen(true)}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mi cuenta"
            style={styles.avatar}
            onPress={() => setAccountOpen(true)}
          >
            <Text style={styles.avatarText}>{user.nombres.slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder="Buscar prendas o marcas…"
            placeholderTextColor="#8b8f88"
            style={styles.searchInput}
            returnKeyType="search"
          />
          {!!search && (
            <Pressable accessibilityLabel="Limpiar búsqueda" onPress={() => onSearchChange('')}>
              <Text style={styles.clearSearch}>×</Text>
            </Pressable>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir filtros"
          style={styles.filterButton}
          onPress={() => setFiltersOpen(true)}
        >
          <Text style={styles.filterButtonIcon}>☷</Text>
          {!!activeFilters && (
            <View style={styles.filterCount}>
              <Text style={styles.filterCountText}>{activeFilters}</Text>
            </View>
          )}
        </Pressable>
      </View>

      <FlatList
        key="catalog-grid"
        data={loading ? [] : products}
        numColumns={2}
        keyExtractor={(item) => item.id}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.list, { paddingBottom: 94 + bottomInset }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryBar}
            >
              <CategoryTab
                label="Inicio"
                active={!category && !favoritesOnly}
                onPress={resetHome}
              />
              {catalog.categories.map((item) => (
                <CategoryTab
                  key={item.id}
                  label={item.nombre}
                  active={category === item.id}
                  onPress={() => {
                    setFavoritesOnly(false);
                    onCategoryChange(item.id);
                  }}
                />
              ))}
            </ScrollView>

            <View style={styles.promo}>
              <View style={styles.promoCopy}>
                <Text style={styles.promoBadge}>COLECCIÓN FEMENINA</Text>
                <Text style={styles.promoTitle}>Vestidos y faldas,{`\n`}a tu manera.</Text>
                <Text style={styles.promoText}>
                  Explora prendas reales. La vista con cámara de vestidos es aproximada.
                </Text>
                <Pressable
                  style={styles.promoButton}
                  onPress={() => {
                    const product = catalog.products.find((item) => item.tipoPrenda === 'Vestidos');
                    const variant = product && variantFor(product);
                    if (product && variant) onTryAr(product, variant);
                  }}
                >
                  <Text style={styles.promoButtonText}>Ver vestido en AR →</Text>
                </Pressable>
              </View>
              <View style={styles.promoArt}>
                <Text style={styles.promoAr}>AR</Text>
                <Text style={styles.promoDegree}>°</Text>
              </View>
            </View>

            <View style={styles.resultsRow}>
              <View>
                <Text style={styles.resultsTitle}>
                  {favoritesOnly ? 'Mis favoritos' : 'Catálogo para mujer'}
                </Text>
                <Text style={styles.resultsMeta}>
                  {products.length}{' '}
                  {products.length === 1 ? 'prenda encontrada' : 'prendas encontradas'}
                </Text>
              </View>
              <Pressable style={styles.compactFilter} onPress={() => setFiltersOpen(true)}>
                <Text style={styles.compactFilterText}>
                  Filtros{activeFilters ? ` · ${activeFilters}` : ''}
                </Text>
              </Pressable>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{loading ? '…' : '◇'}</Text>
            <Text style={styles.emptyTitle}>
              {loading ? 'Cargando catálogo…' : 'No encontramos prendas'}
            </Text>
            {!loading && (
              <Pressable onPress={resetHome}>
                <Text style={styles.emptyAction}>Limpiar búsqueda y filtros</Text>
              </Pressable>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const variant = variantFor(item);
          if (!variant) return null;
          const image = productImage(item);
          const favorite = !!favorites[item.id];
          const available = variant.disponible > 0;
          return (
            <View style={styles.productCard}>
              <View style={styles.imageStage}>
                {image ? (
                  <Image
                    source={{ uri: image }}
                    accessibilityLabel={item.imagenes?.[0]?.textoAlternativo || item.nombre}
                    style={styles.productImage}
                    resizeMode="contain"
                  />
                ) : (
                  <View
                    style={[
                      styles.productSwatch,
                      { backgroundColor: variant.color_hex || '#dedbd2' },
                    ]}
                  >
                    <Text style={styles.swatchLabel}>{item.nombre.slice(0, 1)}</Text>
                  </View>
                )}
                {!!variant.arImagePath && (
                  <View style={styles.arBadge}>
                    <Text style={styles.arBadgeText}>AR</Text>
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={favorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  style={styles.favoriteButton}
                  onPress={() =>
                    setFavorites((current) => ({ ...current, [item.id]: !current[item.id] }))
                  }
                >
                  <Text style={[styles.favoriteIcon, favorite && styles.favoriteIconActive]}>
                    {favorite ? '♥' : '♡'}
                  </Text>
                </Pressable>
              </View>
              <View style={styles.productBody}>
                <Text numberOfLines={1} style={styles.productName}>
                  {item.nombre}
                </Text>
                <Text numberOfLines={1} style={styles.productBrand}>
                  {item.marca || 'Sin marca'}
                </Text>
                <Text numberOfLines={1} style={styles.productColor}>
                  {variant.color}
                </Text>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{money(variant.precio)}</Text>
                  <Text style={[styles.stock, !available && styles.stockEmpty]}>
                    {available ? `${variant.disponible} disp.` : 'Sin stock'}
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.sizes}
                >
                  {item.variantes.map((option) => (
                    <Pressable
                      key={option.id}
                      accessibilityState={{ selected: option.id === variant.id }}
                      style={[styles.size, option.id === variant.id && styles.sizeActive]}
                      onPress={() =>
                        setSelectedVariants((current) => ({ ...current, [item.id]: option.id }))
                      }
                    >
                      <Text
                        style={[styles.sizeText, option.id === variant.id && styles.sizeTextActive]}
                      >
                        {option.talla}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <View style={styles.cardActions}>
                  {!!variant.arImagePath &&
                    (item.tipoPrenda === 'Vestidos' || item.tipoPrenda === 'Faldas') && (
                      <Pressable style={styles.arButton} onPress={() => onTryAr(item, variant)}>
                        <Text style={styles.arButtonText}>◇ AR aprox.</Text>
                      </Pressable>
                    )}
                  <Pressable
                    disabled={!available || commerceBusy}
                    style={[
                      styles.addButton,
                      (!available || commerceBusy) && styles.buttonDisabled,
                    ]}
                    onPress={() => void addToCart(variant)}
                  >
                    <Text style={styles.addButtonText}>{available ? '+ Agregar' : 'Agotado'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        }}
      />

      <View style={[styles.bottomNav, { minHeight: 68 + bottomInset, paddingBottom: bottomInset }]}>
        <BottomAction label="Inicio" icon="⌂" active={!favoritesOnly} onPress={resetHome} />
        <BottomAction
          label="Favoritos"
          icon={favoritesOnly ? '♥' : '♡'}
          active={favoritesOnly}
          badge={favoriteCount}
          onPress={() => setFavoritesOnly((value) => !value)}
        />
        <BottomAction
          label="Carrito"
          icon="⌑"
          badge={cartCount}
          onPress={() => setCartOpen(true)}
        />
        <BottomAction label="Cuenta" icon="●" onPress={() => setAccountOpen(true)} />
      </View>

      <FilterSheet
        visible={filtersOpen}
        catalog={catalog}
        location={location}
        brand={brand}
        color={color}
        size={size}
        onLocationChange={onLocationChange}
        onBrandChange={onBrandChange}
        onColorChange={onColorChange}
        onSizeChange={onSizeChange}
        onClear={onClearFilters}
        onClose={() => setFiltersOpen(false)}
      />

      <MobileCommerceSheet
        visible={cartOpen}
        lines={cartLines}
        orders={orders}
        subtotal={subtotal}
        locations={catalog.locations}
        location={location}
        busy={commerceBusy}
        error={commerceError}
        message={commerceMessage}
        addresses={profile?.direccion || []}
        onClose={() => setCartOpen(false)}
        onLocationChange={onLocationChange}
        onChangeQuantity={changeQuantity}
        onCheckout={checkout}
        onPay={pay}
        onReload={loadCommerce}
      />

      <AccountSheet
        visible={accountOpen}
        user={user}
        profile={profile}
        loading={profileLoading}
        busy={profileBusy}
        error={profileError}
        message={profileMessage}
        onClose={() => setAccountOpen(false)}
        onReload={loadProfile}
        onSaveProfile={saveProfile}
        onSaveAddress={saveAddress}
        onMakeDefault={makeDefaultAddress}
        onDeleteAddress={async (id) => deleteAddress(id)}
        onAdminMode={onAdminMode}
        onLogout={onLogout}
      />
    </SafeAreaView>
  );
}

function HeaderAction({
  icon,
  count,
  label,
  onPress,
}: {
  icon: string;
  count: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.headerAction}
      onPress={onPress}
    >
      <Text style={styles.headerIcon}>{icon}</Text>
      {!!count && (
        <View style={styles.headerCount}>
          <Text style={styles.headerCountText}>{count}</Text>
        </View>
      )}
    </Pressable>
  );
}

function CategoryTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.categoryTab, active && styles.categoryTabActive]} onPress={onPress}>
      <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{label}</Text>
    </Pressable>
  );
}

function BottomAction({
  label,
  icon,
  active = false,
  badge = 0,
  onPress,
}: {
  label: string;
  icon: string;
  active?: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.bottomAction} onPress={onPress}>
      <View>
        <Text style={[styles.bottomIcon, active && styles.bottomIconActive]}>{icon}</Text>
        {!!badge && (
          <View style={styles.bottomBadge}>
            <Text style={styles.bottomBadgeText}>{badge}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.bottomLabel, active && styles.bottomLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function ChoiceRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={styles.filterLabel}>{label}</Text>
      <View style={styles.filterChoices}>
        <Pressable
          style={[styles.choice, !value && styles.choiceActive]}
          onPress={() => onChange('')}
        >
          <Text style={[styles.choiceText, !value && styles.choiceTextActive]}>Todas</Text>
        </Pressable>
        {options.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.choice, value === option.value && styles.choiceActive]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.choiceText, value === option.value && styles.choiceTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function FilterSheet({
  visible,
  catalog,
  location,
  brand,
  color,
  size,
  onLocationChange,
  onBrandChange,
  onColorChange,
  onSizeChange,
  onClear,
  onClose,
}: {
  visible: boolean;
  catalog: Catalog;
  location: CatalogLocation | null;
  brand: string;
  color: string;
  size: string;
  onLocationChange: (value: CatalogLocation) => void;
  onBrandChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onSizeChange: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <Pressable style={styles.sheetDismiss} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Filtrar prendas</Text>
              <Text style={styles.sheetSubtitle}>Refina el catálogo disponible</Text>
            </View>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.filterGroup}>
              <Text style={styles.filterLabel}>Sucursal o almacén</Text>
              <View style={styles.filterChoices}>
                {catalog.locations.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[styles.choice, item.id === location?.id && styles.choiceActive]}
                    onPress={() => onLocationChange(item)}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        item.id === location?.id && styles.choiceTextActive,
                      ]}
                    >
                      {item.nombre}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <ChoiceRow
              label="Marca"
              options={catalog.filters.brands.map((value) => ({ label: value, value }))}
              value={brand}
              onChange={onBrandChange}
            />
            <ChoiceRow
              label="Color"
              options={catalog.filters.colors.map((value) => ({ label: value, value }))}
              value={color}
              onChange={onColorChange}
            />
            <ChoiceRow
              label="Talla"
              options={catalog.filters.sizes.map((value) => ({ label: value, value }))}
              value={size}
              onChange={onSizeChange}
            />
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable style={styles.clearButton} onPress={onClear}>
              <Text style={styles.clearButtonText}>Limpiar</Text>
            </Pressable>
            <Pressable style={styles.applyButton} onPress={onClose}>
              <Text style={styles.applyButtonText}>Ver resultados</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const green = '#63354e';
const cream = '#fcf8f7';
const line = '#eadde3';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: cream },
  header: {
    height: 68,
    paddingHorizontal: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: line,
  },
  logo: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 27,
    lineHeight: 28,
    color: green,
    letterSpacing: -1,
  },
  logoSub: { fontSize: 6, letterSpacing: 2.2, color: '#7d877f' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAction: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerIcon: { color: '#183427', fontSize: 24, lineHeight: 27 },
  headerCount: {
    position: 'absolute',
    top: 0,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  headerCountText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: cream,
  },
  searchBox: {
    flex: 1,
    height: 45,
    borderWidth: 1,
    borderColor: '#deded7',
    backgroundColor: '#fff',
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
  },
  searchIcon: { color: '#243a30', fontSize: 22, marginRight: 8, transform: [{ rotate: '-20deg' }] },
  searchInput: { flex: 1, color: '#202821', fontSize: 13, paddingVertical: 0 },
  clearSearch: { color: '#727870', fontSize: 23, paddingHorizontal: 4 },
  filterButton: {
    width: 46,
    height: 45,
    borderRadius: 12,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonIcon: { color: '#fff', fontSize: 22 },
  filterCount: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#f42169',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: cream,
  },
  filterCountText: { color: '#fff', fontSize: 9, fontWeight: '800' },
  list: { paddingHorizontal: 12, paddingBottom: 110 },
  categoryBar: { paddingHorizontal: 4, paddingBottom: 12, gap: 20 },
  categoryTab: { paddingVertical: 8, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  categoryTabActive: { borderBottomColor: green },
  categoryText: { color: '#555d56', fontSize: 12 },
  categoryTextActive: { color: green, fontWeight: '700' },
  promo: {
    minHeight: 176,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#f7e9ef',
    flexDirection: 'row',
    marginBottom: 18,
  },
  promoCopy: { flex: 1.4, padding: 18, zIndex: 2 },
  promoBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 8,
    color: '#29372f',
    letterSpacing: 1,
  },
  promoTitle: {
    marginTop: 10,
    color: green,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 27,
    lineHeight: 28,
  },
  promoText: { color: '#49574d', fontSize: 10, lineHeight: 14, marginTop: 5 },
  promoButton: {
    alignSelf: 'flex-start',
    marginTop: 11,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: green,
  },
  promoButtonText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  promoArt: {
    flex: 0.8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#e6c4d2',
    borderTopLeftRadius: 90,
    borderBottomLeftRadius: 90,
    marginLeft: -24,
  },
  promoAr: {
    color: green,
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 52,
    fontWeight: '700',
  },
  promoDegree: { position: 'absolute', color: '#fff', fontSize: 42, top: 35, right: 20 },
  resultsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 13,
    paddingHorizontal: 3,
  },
  resultsTitle: { color: '#19231d', fontSize: 16, fontWeight: '800' },
  resultsMeta: { color: '#7b817b', fontSize: 10, marginTop: 3 },
  compactFilter: {
    borderWidth: 1,
    borderColor: '#d8dad4',
    borderRadius: 8,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  compactFilterText: { color: '#354039', fontSize: 10, fontWeight: '600' },
  gridRow: { gap: 9 },
  productCard: {
    flex: 1,
    maxWidth: '50%',
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#eeede7',
    overflow: 'hidden',
  },
  imageStage: {
    height: 177,
    backgroundColor: '#f6f5f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImage: { width: '100%', height: '100%' },
  productSwatch: {
    width: 100,
    height: 125,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchLabel: { color: '#ffffffaa', fontSize: 40, fontWeight: '800' },
  favoriteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ffffffdd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favoriteIcon: { color: '#26362d', fontSize: 19 },
  favoriteIconActive: { color: '#f42169' },
  arBadge: {
    position: 'absolute',
    left: 8,
    top: 9,
    borderRadius: 11,
    backgroundColor: '#1f914c',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  arBadgeText: { color: '#fff', fontWeight: '800', fontSize: 8 },
  productBody: { padding: 10 },
  productName: { color: '#17221b', fontWeight: '800', fontSize: 12 },
  productBrand: { color: '#7a807b', fontSize: 10, marginTop: 4 },
  productColor: { color: '#8c918d', fontSize: 9, marginTop: 2, textTransform: 'capitalize' },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 7,
  },
  price: { color: '#111913', fontSize: 13, fontWeight: '900' },
  stock: { color: '#7e847f', fontSize: 8 },
  stockEmpty: { color: '#ed1f4f' },
  sizes: { gap: 5, paddingVertical: 9 },
  size: {
    minWidth: 27,
    height: 27,
    borderWidth: 1,
    borderColor: '#dcddd8',
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  sizeActive: { backgroundColor: green, borderColor: green },
  sizeText: { color: '#344039', fontSize: 9 },
  sizeTextActive: { color: '#fff', fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 5 },
  arButton: {
    flex: 0.85,
    minHeight: 34,
    borderWidth: 1,
    borderColor: green,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arButtonText: { color: green, fontSize: 9, fontWeight: '700' },
  addButton: {
    flex: 1.15,
    minHeight: 34,
    borderRadius: 5,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  buttonDisabled: { opacity: 0.35 },
  error: {
    color: '#9f382d',
    backgroundColor: '#fff0ec',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  empty: { minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyIcon: { color: '#92a092', fontSize: 38 },
  emptyTitle: { color: '#2b372f', fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptyAction: { color: green, marginTop: 12, textDecorationLine: 'underline' },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 72,
    backgroundColor: '#fffffff5',
    borderTopWidth: 1,
    borderTopColor: line,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  bottomAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 7 },
  bottomIcon: { color: '#777f79', fontSize: 22 },
  bottomIconActive: { color: green },
  bottomLabel: { color: '#858a86', fontSize: 8 },
  bottomLabelActive: { color: green, fontWeight: '800' },
  bottomBadge: {
    position: 'absolute',
    top: -3,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#f42169',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bottomBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  sheetOverlay: { flex: 1, backgroundColor: '#1118', justifyContent: 'flex-end' },
  sheetDismiss: { flex: 1 },
  sheet: {
    maxHeight: '82%',
    minHeight: '56%',
    backgroundColor: cream,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 30 : 18,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#c8cbc5',
    marginTop: 9,
    marginBottom: 13,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: line,
  },
  sheetTitle: { color: '#1b2720', fontSize: 20, fontWeight: '900' },
  sheetSubtitle: { color: '#7b827d', fontSize: 10, marginTop: 3 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#27352d', fontSize: 25, lineHeight: 27 },
  filterGroup: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: line },
  filterLabel: { color: '#26332b', fontSize: 12, fontWeight: '800', marginBottom: 10 },
  filterChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: {
    borderWidth: 1,
    borderColor: '#d4d7d1',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  choiceActive: { backgroundColor: green, borderColor: green },
  choiceText: { color: '#535b55', fontSize: 10 },
  choiceTextActive: { color: '#fff', fontWeight: '700' },
  sheetActions: { flexDirection: 'row', gap: 10, paddingTop: 14 },
  clearButton: {
    flex: 0.8,
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd0ca',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: { color: '#4f5952', fontWeight: '700' },
  applyButton: {
    flex: 1.2,
    minHeight: 48,
    backgroundColor: green,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyButtonText: { color: '#fff', fontWeight: '800' },
});
