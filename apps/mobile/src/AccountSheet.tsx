import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { CustomerAddress, CustomerProfile, Identity } from './types';
import { useSystemBars } from './systemBars';

export type AddressInput = Omit<CustomerAddress, 'id' | 'activa'>;

type Props = {
  visible: boolean;
  user: Identity;
  profile: CustomerProfile | null;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  onClose: () => void;
  onReload: () => Promise<void>;
  onSaveProfile: (input: {
    nombres: string;
    apellidos: string;
    telefono: string | null;
  }) => Promise<boolean>;
  onSaveAddress: (input: AddressInput, id?: string) => Promise<boolean>;
  onMakeDefault: (id: string) => Promise<void>;
  onDeleteAddress: (id: string) => Promise<void>;
  onAdminMode?: () => void;
  onLogout: () => void;
};

const emptyAddress = (): AddressInput => ({
  alias: '',
  destinatario: '',
  telefono: '',
  ciudad: '',
  zona: '',
  detalle: '',
  predeterminada: false,
});

export function AccountSheet({
  visible,
  user,
  profile,
  loading,
  busy,
  error,
  message,
  onClose,
  onReload,
  onSaveProfile,
  onSaveAddress,
  onMakeDefault,
  onDeleteAddress,
  onAdminMode,
  onLogout,
}: Props) {
  const insets = useSystemBars();
  const [section, setSection] = useState<'summary' | 'profile' | 'address'>('summary');
  const [nombres, setNombres] = useState(user.nombres);
  const [apellidos, setApellidos] = useState(user.apellidos);
  const [telefono, setTelefono] = useState('');
  const [address, setAddress] = useState<AddressInput>(emptyAddress());
  const [editingId, setEditingId] = useState<string>();

  useEffect(() => {
    if (!visible) return;
    setSection('summary');
    void onReload();
  }, [visible]);

  useEffect(() => {
    if (!profile) return;
    setNombres(profile.nombres);
    setApellidos(profile.apellidos);
    setTelefono(profile.telefono || '');
  }, [profile]);

  function startAddress(current?: CustomerAddress) {
    setEditingId(current?.id);
    setAddress(
      current
        ? {
            alias: current.alias,
            destinatario: current.destinatario,
            telefono: current.telefono,
            ciudad: current.ciudad,
            zona: current.zona,
            detalle: current.detalle,
            predeterminada: current.predeterminada,
          }
        : {
            ...emptyAddress(),
            destinatario: `${profile?.nombres || user.nombres} ${profile?.apellidos || user.apellidos}`,
            telefono: profile?.telefono || '',
          },
    );
    setSection('address');
  }

  const validAddress =
    address.alias.trim().length >= 2 &&
    address.destinatario.trim().length >= 3 &&
    address.telefono.trim().length >= 7 &&
    address.ciudad.trim().length >= 2 &&
    address.zona.trim().length >= 2 &&
    address.detalle.trim().length >= 5;

  async function saveAddress() {
    if (await onSaveAddress(address, editingId)) {
      setAddress(emptyAddress());
      setEditingId(undefined);
      setSection('summary');
    }
  }

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>
                {section === 'profile'
                  ? 'Editar perfil'
                  : section === 'address'
                    ? editingId
                      ? 'Editar dirección'
                      : 'Nueva dirección'
                    : 'Mi cuenta'}
              </Text>
              <Text style={styles.subtitle}>{user.correo}</Text>
            </View>
            <Pressable style={styles.close} onPress={onClose}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>

          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!message && <Text style={styles.message}>{message}</Text>}

          {loading && !profile ? (
            <View style={styles.loading}>
              <ActivityIndicator color="#173e2a" />
              <Text style={styles.loadingText}>Cargando tu perfil…</Text>
            </View>
          ) : section === 'profile' ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Field label="Nombres" value={nombres} onChangeText={setNombres} />
              <Field label="Apellidos" value={apellidos} onChangeText={setApellidos} />
              <Field
                label="Teléfono"
                value={telefono}
                onChangeText={setTelefono}
                keyboardType="phone-pad"
                placeholder="Ej. +591 70000000"
              />
              <PrimaryButton
                label={busy ? 'Guardando…' : 'Guardar perfil'}
                disabled={busy || nombres.trim().length < 2 || apellidos.trim().length < 2}
                onPress={() =>
                  void onSaveProfile({
                    nombres: nombres.trim(),
                    apellidos: apellidos.trim(),
                    telefono: telefono.trim() || null,
                  }).then((saved) => saved && setSection('summary'))
                }
              />
              <SecondaryButton label="Cancelar" onPress={() => setSection('summary')} />
            </ScrollView>
          ) : section === 'address' ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Field
                label="Alias"
                value={address.alias}
                onChangeText={(alias) => setAddress({ ...address, alias })}
                placeholder="Casa, trabajo…"
              />
              <Field
                label="Destinatario"
                value={address.destinatario}
                onChangeText={(destinatario) => setAddress({ ...address, destinatario })}
              />
              <Field
                label="Teléfono"
                value={address.telefono}
                onChangeText={(telefonoValue) =>
                  setAddress({ ...address, telefono: telefonoValue })
                }
                keyboardType="phone-pad"
              />
              <Field
                label="Ciudad"
                value={address.ciudad}
                onChangeText={(ciudad) => setAddress({ ...address, ciudad })}
              />
              <Field
                label="Zona"
                value={address.zona}
                onChangeText={(zona) => setAddress({ ...address, zona })}
              />
              <Field
                label="Calle, número y referencia"
                value={address.detalle}
                onChangeText={(detalle) => setAddress({ ...address, detalle })}
                multiline
              />
              <Pressable
                style={styles.defaultRow}
                onPress={() => setAddress({ ...address, predeterminada: !address.predeterminada })}
              >
                <View style={[styles.checkbox, address.predeterminada && styles.checkboxActive]}>
                  <Text style={styles.checkText}>{address.predeterminada ? '✓' : ''}</Text>
                </View>
                <Text style={styles.defaultText}>Usar como dirección predeterminada</Text>
              </Pressable>
              <PrimaryButton
                label={busy ? 'Guardando…' : 'Guardar dirección'}
                disabled={busy || !validAddress}
                onPress={() => void saveAddress()}
              />
              <SecondaryButton label="Cancelar" onPress={() => setSection('summary')} />
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.identity}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {(profile?.nombres || user.nombres).slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.identityCopy}>
                  <Text style={styles.name}>
                    {profile?.nombres || user.nombres} {profile?.apellidos || user.apellidos}
                  </Text>
                  <Text style={styles.role}>{user.roles.join(' · ')}</Text>
                  <Text style={styles.phone}>{profile?.telefono || 'Sin teléfono registrado'}</Text>
                </View>
              </View>
              <PrimaryButton label="Editar perfil" onPress={() => setSection('profile')} />

              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Mis direcciones</Text>
                  <Text style={styles.sectionMeta}>Úsalas al confirmar tus compras</Text>
                </View>
                <Pressable style={styles.addButton} onPress={() => startAddress()}>
                  <Text style={styles.addText}>+ Agregar</Text>
                </Pressable>
              </View>
              {profile?.direccion.length ? (
                profile.direccion.map((item) => (
                  <View key={item.id} style={styles.addressCard}>
                    <View style={styles.addressHeader}>
                      <Text style={styles.addressAlias}>{item.alias}</Text>
                      {item.predeterminada && <Text style={styles.defaultBadge}>Principal</Text>}
                    </View>
                    <Text style={styles.addressText}>
                      {item.destinatario} · {item.telefono}
                    </Text>
                    <Text style={styles.addressText}>
                      {item.ciudad}, {item.zona}
                    </Text>
                    <Text style={styles.addressDetail}>{item.detalle}</Text>
                    <View style={styles.addressActions}>
                      <Pressable onPress={() => startAddress(item)}>
                        <Text style={styles.actionText}>Editar</Text>
                      </Pressable>
                      {!item.predeterminada && (
                        <Pressable disabled={busy} onPress={() => void onMakeDefault(item.id)}>
                          <Text style={styles.actionText}>Hacer principal</Text>
                        </Pressable>
                      )}
                      <Pressable disabled={busy} onPress={() => void onDeleteAddress(item.id)}>
                        <Text style={styles.deleteText}>Eliminar</Text>
                      </Pressable>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.empty}>No tienes direcciones guardadas todavía.</Text>
              )}
              {onAdminMode && (
                <SecondaryButton label="Volver al panel administrador" onPress={onAdminMode} />
              )}
              <Pressable style={styles.logout} onPress={onLogout}>
                <Text style={styles.logoutText}>Cerrar sesión</Text>
              </Pressable>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  multiline,
  ...props
}: { label: string; multiline?: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor="#697168"
        selectionColor="#173e2a"
        cursorColor="#173e2a"
        style={[styles.input, multiline && styles.inputMultiline]}
      />
    </View>
  );
}

function PrimaryButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      style={[styles.primary, disabled && styles.disabled]}
      onPress={onPress}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.secondary} onPress={onPress}>
      <Text style={styles.secondaryText}>{label}</Text>
    </Pressable>
  );
}

const green = '#173e2a';
const border = '#e1e2dc';
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#1118', justifyContent: 'flex-end' },
  dismiss: { flex: 1 },
  sheet: {
    height: '90%',
    backgroundColor: '#fbfaf6',
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: border,
  },
  headerCopy: { flex: 1 },
  title: { color: '#1b2720', fontSize: 21, fontWeight: '900' },
  subtitle: { color: '#7b827d', fontSize: 10, marginTop: 3 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#27352d', fontSize: 25, lineHeight: 27 },
  content: { paddingVertical: 15, paddingBottom: 30 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#747b75', fontSize: 11 },
  error: {
    color: '#9f382d',
    backgroundColor: '#fff0ec',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    fontSize: 10,
  },
  message: {
    color: '#225f3c',
    backgroundColor: '#e8f4ea',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    fontSize: 10,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: border,
    marginBottom: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: green,
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '900' },
  identityCopy: { flex: 1 },
  name: { color: '#1f2923', fontSize: 14, fontWeight: '900' },
  role: { color: '#768078', fontSize: 9, marginTop: 3 },
  phone: { color: '#596159', fontSize: 10, marginTop: 4 },
  field: { marginBottom: 12 },
  label: { color: '#374139', fontSize: 10, fontWeight: '800', marginBottom: 6 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#cfd3cc',
    borderRadius: 7,
    backgroundColor: '#fff',
    color: '#111712',
    fontSize: 14,
    paddingHorizontal: 12,
  },
  inputMultiline: { minHeight: 86, paddingTop: 11, textAlignVertical: 'top' },
  primary: {
    minHeight: 46,
    borderRadius: 7,
    backgroundColor: green,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  primaryText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  secondary: {
    minHeight: 44,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#cbd0ca',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  secondaryText: { color: green, fontSize: 11, fontWeight: '800' },
  disabled: { opacity: 0.42 },
  defaultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    marginBottom: 6,
  },
  checkbox: {
    width: 21,
    height: 21,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#aab0aa',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  checkboxActive: { backgroundColor: green, borderColor: green },
  checkText: { color: '#fff', fontWeight: '900' },
  defaultText: { color: '#475148', fontSize: 11 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 23,
    marginBottom: 10,
  },
  sectionTitle: { color: '#1d2921', fontSize: 15, fontWeight: '900' },
  sectionMeta: { color: '#7b827c', fontSize: 9, marginTop: 3 },
  addButton: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#e8eee7',
  },
  addText: { color: green, fontSize: 9, fontWeight: '900' },
  addressCard: {
    borderWidth: 1,
    borderColor: border,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 9,
  },
  addressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addressAlias: { color: '#1f2923', fontSize: 12, fontWeight: '900' },
  defaultBadge: {
    color: '#22633d',
    backgroundColor: '#e5f3e8',
    fontSize: 8,
    fontWeight: '900',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  addressText: { color: '#6b736c', fontSize: 9, marginTop: 5 },
  addressDetail: { color: '#3d463f', fontSize: 10, lineHeight: 14, marginTop: 5 },
  addressActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    borderTopWidth: 1,
    borderTopColor: '#efefe9',
    marginTop: 10,
    paddingTop: 9,
  },
  actionText: { color: green, fontSize: 9, fontWeight: '800' },
  deleteText: { color: '#a34236', fontSize: 9, fontWeight: '800' },
  empty: {
    color: '#818781',
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 9,
    textAlign: 'center',
    fontSize: 10,
  },
  logout: { alignItems: 'center', padding: 14, marginTop: 12 },
  logoutText: { color: '#a34236', fontWeight: '800', fontSize: 11 },
});
