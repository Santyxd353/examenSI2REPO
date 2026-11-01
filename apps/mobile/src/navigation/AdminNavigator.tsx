import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { modulesForIdentity, type MobileBusinessModule } from '../modules/registry';
import type { Identity } from '../types';

type Props = {
  user: Identity;
  home: ReactNode;
};

/** Navegación de administración; B13 conectará los módulos comerciales reales. */
export function AdminNavigator({ user, home }: Props) {
  const modules = modulesForIdentity(user);
  const [active, setActive] = useState<MobileBusinessModule>('home');
  const current = modules.find((module) => module.id === active) || modules[0];

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        contentContainerStyle={styles.tabs}
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
      >
        {modules.map((module) => (
          <Pressable
            key={module.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: module.id === active }}
            onPress={() => setActive(module.id)}
            style={[styles.tab, module.id === active && styles.tabActive]}
          >
            <Text style={[styles.tabText, module.id === active && styles.tabTextActive]}>{module.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {active === 'home' ? (
        home
      ) : (
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>{current?.label}</Text>
          <Text style={styles.placeholderText}>
            {current?.description}. Este acceso está protegido por permiso; su flujo comercial y offline se incorpora en los bloques posteriores.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbfaf6' },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e5e4dc' },
  tab: { borderColor: '#d8d9d4', borderRadius: 16, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  tabActive: { backgroundColor: '#173e2a', borderColor: '#173e2a' },
  tabText: { color: '#586258', fontSize: 10, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
  placeholder: { flex: 1, justifyContent: 'center', padding: 28 },
  placeholderTitle: { color: '#173e2a', fontSize: 24, fontWeight: '900' },
  placeholderText: { color: '#59635d', fontSize: 13, lineHeight: 20, marginTop: 10 },
});
