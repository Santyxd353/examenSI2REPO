import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
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
import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import Svg, { Polygon } from 'react-native-svg';
import {
  API_URL,
  api,
  login,
  logout,
  registerClient,
  restoreSession,
  getTenantSlug,
  selectTenant,
} from './api';
import { AdminDashboard } from './AdminDashboard';
import { CatalogScreen } from './CatalogScreen';
import { connectRealtime } from './realtime';
import { detectPose, isPoseAvailable } from '../modules/pose-landmarker/src';
import { garmentImageFrame, garmentKind, garmentOutline, projectTorso } from './pose';
import type { Layout, Torso } from './pose';
import type { Catalog, CatalogLocation, Identity, Product, Variant } from './types';

type Page = 'catalog' | 'ar';
const isAdministrator = (identity: Identity) => identity.roles.includes('Administrador');

export function App() {
  const [user, setUser] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>('catalog');
  const [adminClientMode, setAdminClientMode] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({
    products: [],
    locations: [],
    filters: { brands: [], colors: [], sizes: [] },
    categories: [],
  });
  const [location, setLocation] = useState<CatalogLocation | null>(null);
  const [brand, setBrand] = useState('');
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [category, setCategory] = useState('');
  const catalogRequest = useRef(0);
  const [selection, setSelection] = useState<{ product: Product; variant: Variant } | null>(null);
  const [error, setError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);

  async function closeAccount() {
    setLoading(true);
    catalogRequest.current++;
    try {
      await logout();
    } catch (reason) {
      setError((reason as Error).message);
      setLoading(false);
      return;
    }
    setUser(null);
    setAdminClientMode(false);
    setCatalog({
      products: [],
      locations: [],
      categories: [],
      filters: { brands: [], colors: [], sizes: [] },
    });
    setLocation(null);
    setSelection(null);
    setBrand('');
    setColor('');
    setSize('');
    setSearch('');
    setDebouncedSearch('');
    setCategory('');
    setPage('catalog');
    setError('');
    setCatalogLoading(false);
    setLoading(false);
  }

  async function loadCatalog(locationId = location?.id || '') {
    const requestId = ++catalogRequest.current;
    const params = new URLSearchParams();
    params.set('channel', 'APP');
    if (locationId) params.set('location', locationId);
    if (brand) params.set('brand', brand);
    if (color) params.set('color', color);
    if (size) params.set('size', size);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (category) params.set('category', category);
    setCatalogLoading(true);
    try {
      const data = await api(`/catalog${params.size ? `?${params}` : ''}`);
      if (requestId !== catalogRequest.current) return;
      setCatalog(data);
      if (!locationId) setLocation(data.locations[0] || null);
    } finally {
      if (requestId === catalogRequest.current) setCatalogLoading(false);
    }
  }

  useEffect(() => {
    restoreSession()
      .then(async (identity) => {
        setUser(identity);
        if (identity && !isAdministrator(identity)) await loadCatalog('');
      })
      .catch((reason) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!user || !location || (isAdministrator(user) && !adminClientMode)) return;
    void loadCatalog(location.id).catch((reason) => setError(reason.message));
    return connectRealtime(location.id, () => {
      void loadCatalog(location.id).catch(() => {});
    });
  }, [user, location?.id, brand, color, size, debouncedSearch, category, adminClientMode]);

  if (loading)
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#697b5e" />
        <Text>Preparando Lúmina…</Text>
      </SafeAreaView>
    );

  if (!user)
    return (
      <LoginScreen
        error={error}
        onClearError={() => setError('')}
        onLogin={async (correo, clave) => {
          setError('');
          try {
            const identity = await login(correo, clave);
            setUser(identity);
            setAdminClientMode(false);
            if (!isAdministrator(identity)) await loadCatalog('');
          } catch (reason) {
            setError((reason as Error).message);
          }
        }}
        onRegister={async (nombres, apellidos, correo, clave) => {
          setError('');
          try {
            const identity = await registerClient(nombres, apellidos, correo, clave);
            setUser(identity);
            setAdminClientMode(false);
            await loadCatalog('');
          } catch (reason) {
            setError((reason as Error).message);
          }
        }}
      />
    );

  if (isAdministrator(user) && !adminClientMode)
    return (
      <AdminDashboard
        user={user}
        onClientMode={async () => {
          await loadCatalog('');
          setAdminClientMode(true);
        }}
        onLogout={closeAccount}
      />
    );

  if (page === 'ar' && selection)
    return (
      <ArCamera
        product={selection.product}
        variant={selection.variant}
        onBack={() => setPage('catalog')}
      />
    );

  return (
    <CatalogScreen
      user={user}
      catalog={catalog}
      loading={catalogLoading}
      error={error}
      location={location}
      brand={brand}
      color={color}
      size={size}
      search={search}
      category={category}
      onLocationChange={setLocation}
      onBrandChange={setBrand}
      onColorChange={setColor}
      onSizeChange={setSize}
      onSearchChange={setSearch}
      onCategoryChange={setCategory}
      onClearFilters={() => {
        setBrand('');
        setColor('');
        setSize('');
        setCategory('');
        setSearch('');
      }}
      onTryAr={(product, variant) => {
        setSelection({ product, variant });
        setPage('ar');
      }}
      onCatalogRefresh={() => loadCatalog(location?.id || '')}
      onIdentityChange={setUser}
      onAdminMode={
        isAdministrator(user)
          ? () => {
              setPage('catalog');
              setAdminClientMode(false);
            }
          : undefined
      }
      onLogout={closeAccount}
    />
  );
}

function LoginScreen({
  error,
  onLogin,
  onRegister,
  onClearError,
}: {
  error: string;
  onLogin: (correo: string, clave: string) => Promise<void>;
  onRegister: (nombres: string, apellidos: string, correo: string, clave: string) => Promise<void>;
  onClearError: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [localError, setLocalError] = useState('');
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState(getTenantSlug());

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setLocalError('');
    onClearError();
  }

  async function submit() {
    const normalizedEmail = correo.trim().toLowerCase();
    setLocalError('');
    if (mode === 'register') {
      if (nombres.trim().length < 2 || apellidos.trim().length < 2) {
        setLocalError('Escribe tu nombre y apellido completos.');
        return;
      }
      if (clave.length < 10) {
        setLocalError('La contraseña debe tener al menos 10 caracteres.');
        return;
      }
      if (clave !== confirmacion) {
        setLocalError('Las contraseñas no coinciden.');
        return;
      }
    }
    setBusy(true);
    try {
      await selectTenant(store.trim().toLowerCase());
      if (mode === 'register')
        await onRegister(nombres.trim(), apellidos.trim(), normalizedEmail, clave);
      else await onLogin(normalizedEmail, clave);
    } catch (reason) {
      setLocalError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const disabled =
    busy ||
    !correo.trim() ||
    !clave ||
    (mode === 'register' && (!nombres.trim() || !apellidos.trim() || !confirmacion));

  return (
    <KeyboardAvoidingView
      style={styles.login}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style="dark" />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.loginContent}
      >
        <Text style={styles.brand}>lúmina°</Text>
        <Text style={styles.eyebrow}>MODA FEMENINA · APLICACIÓN MÓVIL</Text>
        <Text style={styles.loginTitle}>
          {mode === 'register' ? 'Crea tu cuenta de cliente.' : 'Tu probador, ahora en la cámara.'}
        </Text>

        <View style={styles.authTabs}>
          <Pressable
            style={[styles.authTab, mode === 'login' && styles.authTabActive]}
            onPress={() => switchMode('login')}
          >
            <Text style={[styles.authTabText, mode === 'login' && styles.authTabTextActive]}>
              Ingresar
            </Text>
          </Pressable>
          <Pressable
            style={[styles.authTab, mode === 'register' && styles.authTabActive]}
            onPress={() => switchMode('register')}
          >
            <Text style={[styles.authTabText, mode === 'register' && styles.authTabTextActive]}>
              Crear cuenta
            </Text>
          </Pressable>
        </View>

        <TextInput
          accessibilityLabel="Identificador de tienda"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          placeholder="Identificador de tienda"
          placeholderTextColor="#626a61"
          style={styles.input}
          value={store}
          onChangeText={setStore}
        />

        {mode === 'register' && (
          <>
            <TextInput
              accessibilityLabel="Nombres"
              autoCapitalize="words"
              placeholder="Nombres"
              placeholderTextColor="#626a61"
              selectionColor="#303a2e"
              cursorColor="#303a2e"
              style={styles.input}
              value={nombres}
              onChangeText={setNombres}
            />
            <TextInput
              accessibilityLabel="Apellidos"
              autoCapitalize="words"
              placeholder="Apellidos"
              placeholderTextColor="#626a61"
              selectionColor="#303a2e"
              cursorColor="#303a2e"
              style={styles.input}
              value={apellidos}
              onChangeText={setApellidos}
            />
          </>
        )}
        <TextInput
          accessibilityLabel="Correo"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="Correo"
          placeholderTextColor="#626a61"
          selectionColor="#303a2e"
          cursorColor="#303a2e"
          style={styles.input}
          value={correo}
          onChangeText={setCorreo}
        />
        <TextInput
          accessibilityLabel="Contraseña"
          placeholder={mode === 'register' ? 'Contraseña (mínimo 10 caracteres)' : 'Contraseña'}
          placeholderTextColor="#626a61"
          selectionColor="#303a2e"
          cursorColor="#303a2e"
          secureTextEntry
          style={styles.input}
          value={clave}
          onChangeText={setClave}
        />
        {mode === 'register' && (
          <TextInput
            accessibilityLabel="Confirmar contraseña"
            placeholder="Confirmar contraseña"
            placeholderTextColor="#626a61"
            selectionColor="#303a2e"
            cursorColor="#303a2e"
            secureTextEntry
            style={styles.input}
            value={confirmacion}
            onChangeText={setConfirmacion}
          />
        )}
        {!!(localError || error) && <Text style={styles.error}>{localError || error}</Text>}
        <Pressable
          style={[styles.primary, disabled && styles.primaryDisabled]}
          disabled={disabled}
          onPress={() => void submit()}
        >
          <Text style={styles.primaryText}>
            {busy
              ? mode === 'register'
                ? 'Creando cuenta…'
                : 'Ingresando…'
              : mode === 'register'
                ? 'Crear cuenta de cliente'
                : 'Ingresar'}
          </Text>
        </Pressable>
        {mode === 'register' && (
          <Text style={styles.clientNotice}>
            Esta opción crea únicamente cuentas con rol Cliente. El personal se administra desde la
            web.
          </Text>
        )}
        <Text style={styles.privacy}>La sesión se almacena de forma segura en el dispositivo.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ArCamera({
  product,
  variant,
  onBack,
}: {
  product: Product;
  variant: Variant;
  onBack: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const previous = useRef<Torso | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [layout, setLayout] = useState<Layout>({ width: 0, height: 0 });
  const [torso, setTorso] = useState<Torso | null>(null);
  const [tracking, setTracking] = useState(
    'Colócate de frente y aléjate hasta mostrar la cintura.',
  );
  const [trackingError, setTrackingError] = useState('');
  const [retry, setRetry] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const nativeAvailable = isPoseAvailable();
  const arImageUrl = variant.arImagePath
    ? `${API_URL.replace(/\/api$/, '')}${variant.arImagePath}`
    : null;
  const categoryKind = garmentKind(product.tipoPrenda || '');
  const kind = categoryKind === 'unsupported' ? garmentKind(product.nombre) : categoryKind;

  useEffect(() => {
    if (
      !permission?.granted ||
      !cameraReady ||
      !nativeAvailable ||
      kind === 'unsupported' ||
      !layout.width ||
      !layout.height
    )
      return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function sample() {
      let retryDelay = 700;
      try {
        const capture = await camera.current?.takePictureAsync({
          quality: 0.35,
          skipProcessing: false,
          shutterSound: false,
        });
        if (!capture?.uri) return;
        const pose = await detectPose(capture.uri);
        if (!active) return;
        const next = projectTorso(pose, layout, previous.current);
        previous.current = next;
        setTorso(next);
        setTrackingError('');
        setTracking(
          next
            ? 'Prenda siguiendo hombros y cadera.'
            : pose.landmarks.length
              ? 'Se detectó el cuerpo, pero faltan hombros o cadera. Aléjate un poco.'
              : 'No se detecta el cuerpo. Mejora la luz y muestra la cintura.',
        );
      } catch (reason) {
        retryDelay = 1500;
        if (active) {
          setTorso(null);
          setTrackingError((reason as Error).message);
          setTracking('Reintentando detección automáticamente…');
        }
      } finally {
        if (active) timer = setTimeout(() => void sample(), retryDelay);
      }
    }
    void sample();
    return () => {
      active = false;
      clearTimeout(timer);
      previous.current = null;
    };
  }, [
    permission?.granted,
    cameraReady,
    nativeAvailable,
    kind,
    arImageUrl,
    layout.width,
    layout.height,
    retry,
  ]);
  if (!permission)
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </SafeAreaView>
    );
  if (!permission.granted)
    return (
      <SafeAreaView style={styles.permission}>
        <Text style={styles.permissionTitle}>La cámara es necesaria</Text>
        <Text style={styles.permissionCopy}>
          La imagen se procesa localmente y no se almacena en esta primera versión.
        </Text>
        <Pressable style={styles.primary} onPress={() => void requestPermission()}>
          <Text style={styles.primaryText}>Permitir cámara</Text>
        </Pressable>
        <Pressable onPress={onBack}>
          <Text style={styles.linkLight}>Volver al catálogo</Text>
        </Pressable>
      </SafeAreaView>
    );
  return (
    <View style={styles.cameraPage}>
      <NativeStatusBar barStyle="light-content" />
      <CameraView
        ref={camera}
        style={StyleSheet.absoluteFill}
        facing="front"
        mirror
        onCameraReady={() => setCameraReady(true)}
      />
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={(event) =>
          setLayout({
            width: event.nativeEvent.layout.width,
            height: event.nativeEvent.layout.height,
          })
        }
      >
        {torso && kind !== 'unsupported' && arImageUrl && !imageFailed ? (
          <Image
            source={{ uri: arImageUrl }}
            resizeMode="stretch"
            style={[styles.garmentImage, garmentImageFrame(torso, kind)]}
            onError={() => setImageFailed(true)}
          />
        ) : torso && kind !== 'unsupported' ? (
          <Svg width={layout.width} height={layout.height}>
            <Polygon
              points={garmentOutline(torso, kind)
                .map((point) => `${point.x},${point.y}`)
                .join(' ')}
              fill={variant.color_hex || '#c9b8a7'}
              fillOpacity={0.78}
              stroke="#ffffffcc"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </Svg>
        ) : (
          <View style={styles.bodyGuide}>
            <View style={styles.headGuide} />
            <View style={styles.shoulderGuide} />
          </View>
        )}
      </View>
      <View style={styles.cameraTop}>
        <Pressable style={styles.cameraAction} onPress={onBack}>
          <Text style={styles.cameraActionText}>‹ Volver</Text>
        </Pressable>
        <View style={styles.prototypeBadge}>
          <Text style={styles.prototypeText}>
            {nativeAvailable ? 'AR EXPERIMENTAL · ANDROID' : 'GUÍA · REQUIERE BUILD ANDROID'}
          </Text>
        </View>
      </View>
      <View style={styles.cameraBottom}>
        <Text style={styles.cameraProduct}>{product.nombre}</Text>
        <Text style={styles.cameraMeta}>
          {variant.color} · Talla {variant.talla}
        </Text>
        <Text style={styles.cameraHint}>
          {kind === 'unsupported'
            ? 'Esta falda aún no tiene visualización con cámara. Usa el vestidor 3D de la web para ver una silueta aproximada.'
            : nativeAvailable
              ? tracking
              : 'Para detectar el cuerpo instala la development build de Android.'}
        </Text>
        {!!trackingError && <Text style={styles.cameraHint}>{trackingError}</Text>}
        {imageFailed && (
          <Text style={styles.cameraHint}>
            No se pudo cargar la imagen AR. Revisa la conexión con el servidor.
          </Text>
        )}
        {!!trackingError && nativeAvailable && (
          <Pressable
            style={styles.retryButton}
            onPress={() => {
              setTrackingError('');
              setRetry((value) => value + 1);
            }}
          >
            <Text style={styles.primaryText}>Reintentar detección</Text>
          </Pressable>
        )}
        {!arImageUrl && (
          <Text style={styles.cameraPrivacy}>
            Silueta de color referencial; no reproduce los detalles del vestido de marca.
          </Text>
        )}
        <Text style={styles.cameraHint}>
          Visualización aproximada. No garantiza la talla ni el ajuste físico de la prenda.
        </Text>
        <Text style={styles.cameraPrivacy}>
          La cámara se procesa en el dispositivo; las capturas temporales se eliminan.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fcf8f7' },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f6f6f1',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#dfe1d8',
  },
  brand: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 27,
    color: '#263025',
  },
  brandSub: { fontSize: 8, letterSpacing: 2, color: '#7d8777' },
  link: { color: '#65745e', fontWeight: '600' },
  list: { padding: 20, paddingBottom: 50 },
  intro: { marginBottom: 22 },
  eyebrow: { color: '#75816d', fontSize: 10, letterSpacing: 2, marginBottom: 9 },
  title: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 31,
    lineHeight: 36,
    color: '#252b24',
    maxWidth: 340,
  },
  paragraph: { color: '#6b7168', lineHeight: 20, marginTop: 10 },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    color: '#737a70',
    marginTop: 18,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#cbd0c5',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  chipActive: { backgroundColor: '#344032', borderColor: '#344032' },
  chipText: { color: '#4e574b', fontSize: 11 },
  chipTextActive: { color: '#fff', fontSize: 11 },
  productCard: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dfe1d8',
    marginBottom: 12,
  },
  swatch: { width: 58, height: 70, borderRadius: 3 },
  catalogImage: { width: 70, height: 86, resizeMode: 'cover', backgroundColor: '#e8ebe3' },
  photoChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  photoChoice: { borderWidth: 1, borderColor: '#cbd0c5', paddingHorizontal: 6, paddingVertical: 3 },
  photoChoiceActive: { borderColor: '#344032', backgroundColor: '#e8ece4' },
  photoChoiceText: { color: '#303a2e', fontSize: 9 },
  productCopy: { flex: 1, gap: 4 },
  productName: { color: '#293028', fontSize: 15, fontWeight: '600' },
  productMeta: { color: '#777e73', fontSize: 10 },
  variantChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  variantChip: { borderWidth: 1, borderColor: '#d4d9d0', paddingHorizontal: 6, paddingVertical: 4 },
  variantChipActive: { borderColor: '#344032', backgroundColor: '#e8ece4' },
  variantText: { color: '#303a2e', fontSize: 9 },
  tryButton: { backgroundColor: '#303a2e', paddingHorizontal: 13, paddingVertical: 11 },
  tryButtonText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  empty: { color: '#777e73', textAlign: 'center', padding: 30 },
  error: { color: '#a64d38', backgroundColor: '#fff0eb', padding: 11, marginTop: 10 },
  login: { flex: 1, backgroundColor: '#fcf8f7' },
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 52,
    paddingBottom: 36,
    gap: 13,
  },
  loginTitle: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 32,
    lineHeight: 38,
    color: '#322631',
    marginBottom: 14,
  },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: '#cbd0c5',
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    color: '#111712',
    fontSize: 15,
  },
  authTabs: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#cbd0c5',
    borderRadius: 8,
    padding: 3,
    backgroundColor: '#e8e9e2',
    marginBottom: 3,
  },
  authTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  authTabActive: { backgroundColor: '#fff' },
  authTabText: { color: '#6f776d', fontSize: 12, fontWeight: '700' },
  authTabTextActive: { color: '#303a2e' },
  primary: {
    minHeight: 50,
    backgroundColor: '#63354e',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginTop: 4,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: '#fff', fontWeight: '600' },
  clientNotice: {
    color: '#566052',
    backgroundColor: '#e4eadf',
    borderRadius: 6,
    padding: 10,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  privacy: { color: '#7c8178', fontSize: 10, textAlign: 'center', marginTop: 8 },
  permission: {
    flex: 1,
    backgroundColor: '#1f251f',
    justifyContent: 'center',
    padding: 28,
    gap: 16,
  },
  permissionTitle: {
    color: '#fff',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 30,
  },
  permissionCopy: { color: '#cdd3ca', lineHeight: 20 },
  linkLight: { color: '#dce3d8', textAlign: 'center', padding: 12 },
  cameraPage: { flex: 1, backgroundColor: '#000' },
  cameraTop: {
    position: 'absolute',
    top: 45,
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cameraAction: {
    backgroundColor: '#111A',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  cameraActionText: { color: '#fff', fontWeight: '600' },
  prototypeBadge: {
    backgroundColor: '#d99d57dd',
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 4,
  },
  prototypeText: { color: '#271b0f', fontSize: 8, fontWeight: '700' },
  bodyGuide: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    paddingTop: 125,
  },
  headGuide: { width: 92, height: 112, borderWidth: 1, borderColor: '#ffffff99', borderRadius: 50 },
  shoulderGuide: {
    width: 250,
    height: 70,
    borderTopWidth: 1,
    borderColor: '#ffffff99',
    borderRadius: 100,
    marginTop: 18,
  },
  garmentPreview: {
    width: 220,
    height: 260,
    marginTop: -55,
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderWidth: 1,
    borderColor: '#ffffff88',
    alignItems: 'center',
    justifyContent: 'center',
  },
  garmentImage: { position: 'absolute', opacity: 0.92 },
  garmentLabel: { color: '#fff', fontWeight: '700', textShadowColor: '#0008', textShadowRadius: 5 },
  cameraBottom: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
    backgroundColor: '#111C',
    padding: 17,
    borderRadius: 4,
  },
  cameraProduct: {
    color: '#fff',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: 22,
  },
  cameraMeta: { color: '#dce1d9', marginTop: 4 },
  cameraHint: { color: '#fff', fontSize: 11, marginTop: 12 },
  cameraPrivacy: { color: '#aeb7aa', fontSize: 9, marginTop: 5 },
  retryButton: { alignSelf: 'flex-start', marginTop: 10, padding: 9, backgroundColor: '#344032' },
});
