import { useState, type ReactNode } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  modulesForIdentity,
  activeBusinessModule,
  type MobileBusinessModule,
} from '../modules/registry';
import { useSystemBars } from '../systemBars';
import { BusinessScreen } from '../BusinessScreen';
import { SyncScreen } from '../SyncScreen';
import { AdminOperationsScreen } from '../AdminOperationsScreen';
import type { Identity } from '../types';

type Props = {
  user: Identity;
  home: (onNavigate: (module: MobileBusinessModule) => void) => ReactNode;
};

/** La navegación aplica los permisos actuales, también al cambiar de rol. */
export function AdminNavigator({ user, home }: Props) {
  const insets = useSystemBars();
  const modules = modulesForIdentity(user);
  const [requested, setActive] = useState<MobileBusinessModule>('home');
  const active = activeBusinessModule(user, requested);
  const navigate = (module: MobileBusinessModule) => {
    if (modules.some((item) => item.id === module)) setActive(module);
  };

  return (
    <SafeAreaView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
    >
      <ScrollView
        horizontal
        contentContainerStyle={styles.tabs}
        style={styles.tabRail}
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
      >
        {modules.map((module) => (
          <Pressable
            key={module.id}
            testID={`qa-admin-tab-${module.id}`}
            accessibilityLabel={`Abrir ${module.label}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: module.id === active }}
            onPress={() => navigate(module.id)}
            style={[styles.tab, module.id === active && styles.tabActive]}
          >
            <Text style={[styles.tabText, module.id === active && styles.tabTextActive]}>
              {module.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {active === 'home' ? (
        home(navigate)
      ) : active === 'business' ? (
        <BusinessScreen />
      ) : active === 'sync' ? (
        <SyncScreen user={user} />
      ) : (
        <AdminOperationsScreen module={active} user={user} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fbfaf6' },
  tabRail: {
    flexGrow: 0,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e4dc',
    shadowColor: '#173e2a',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  tabs: { gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  tab: {
    borderColor: '#d8ded8',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: '#fbfaf6',
  },
  tabActive: { backgroundColor: '#173e2a', borderColor: '#173e2a' },
  tabText: { color: '#586258', fontSize: 10, fontWeight: '700' },
  tabTextActive: { color: '#fff' },
});
