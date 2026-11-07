import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { modulesForIdentity, type MobileBusinessModule } from '../modules/registry';
import type { Identity } from '../types';

export function StaffHome({
  user,
  onNavigate,
  onClientMode,
  onLogout,
}: {
  user: Identity;
  onNavigate: (module: MobileBusinessModule) => void;
  onClientMode: () => Promise<void>;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const openStore = async () => {
    setBusy(true);
    setError('');
    try {
      await onClientMode();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.eyebrow}>{user.tenant?.name ?? 'Lúmina'}</Text>
      <Text style={s.title}>Hola, {user.nombres}</Text>
      <Text style={s.copy}>Tu espacio de trabajo · {user.roles.join(', ')}</Text>
      <Text style={s.copy}>
        Elige el módulo que necesitas. Los accesos corresponden a tus permisos en esta tienda.
      </Text>
      <View style={s.modules}>
        {modulesForIdentity(user)
          .filter((module) => module.id !== 'home')
          .map((module) => (
            <Pressable
              key={module.id}
              accessibilityRole="button"
              accessibilityLabel={'Abrir ' + module.label}
              onPress={() => onNavigate(module.id)}
              style={s.module}
            >
              <Text style={s.moduleTitle}>{module.label}</Text>
              <Text style={s.copy}>{module.description}</Text>
            </Pressable>
          ))}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void openStore()}
        style={s.action}
      >
        <Text style={s.actionText}>{busy ? 'Abriendo…' : 'Ver tienda'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onLogout} style={s.exit}>
        <Text style={s.exitText}>Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  page: { padding: 22, gap: 14, paddingBottom: 50 },
  eyebrow: { color: '#748278', fontSize: 11, fontWeight: '800' },
  title: { color: '#173e2a', fontSize: 28, fontWeight: '900' },
  copy: { color: '#617268', fontSize: 12, lineHeight: 18 },
  modules: { gap: 12 },
  module: {
    minHeight: 78,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dce4da',
    backgroundColor: '#fff',
    borderRadius: 13,
    gap: 6,
  },
  moduleTitle: { color: '#173e2a', fontSize: 16, fontWeight: '800' },
  action: {
    padding: 14,
    backgroundColor: '#173e2a',
    borderRadius: 11,
    minHeight: 46,
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  exit: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#dce4da',
    borderRadius: 11,
    minHeight: 46,
    alignItems: 'center',
  },
  exitText: { color: '#9a2e2e', fontSize: 12, fontWeight: '700' },
  error: { color: '#9a2e2e', padding: 10, backgroundColor: '#fff0ec', borderRadius: 8 },
});
