import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { OfflineVariant } from './offlineCatalog';

export type EditableVariant = OfflineVariant & Readonly<{ priceText: string }>;

export function VariantEditor({
  value,
  onChange,
  onRemove,
  removable,
}: {
  value: EditableVariant;
  onChange: (value: EditableVariant) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  return <View style={styles.card}>
    <View style={styles.row}>
      <TextInput
        accessibilityLabel="Talla de variante"
        value={value.talla}
        onChangeText={(talla) => onChange({ ...value, talla })}
        placeholder="Talla"
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Color de variante"
        value={value.color}
        onChangeText={(color) => onChange({ ...value, color })}
        placeholder="Color"
        style={styles.input}
      />
    </View>
    <View style={styles.row}>
      <TextInput
        accessibilityLabel="Precio de variante"
        value={value.priceText}
        onChangeText={(priceText) => onChange({ ...value, priceText })}
        placeholder="Precio Bs"
        keyboardType="decimal-pad"
        style={styles.input}
      />
      <Pressable accessibilityRole="button" disabled={!removable} onPress={onRemove} style={[styles.remove, !removable && styles.disabled]}>
        <Text style={styles.removeText}>Quitar</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  card: { gap: 8, borderWidth: 1, borderColor: '#e2e6df', borderRadius: 12, padding: 10, backgroundColor: '#fbfcf9' },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minHeight: 42, borderWidth: 1, borderColor: '#d9dfd8', borderRadius: 9, paddingHorizontal: 10, color: '#1e3024', fontSize: 11, backgroundColor: '#fff' },
  remove: { minWidth: 82, minHeight: 42, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d9a8a1' },
  removeText: { color: '#9a3f34', fontSize: 10, fontWeight: '800' },
  disabled: { opacity: 0.35 },
});
