import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { OfflineProduct, OfflineVariant } from './offlineCatalog';
import { VariantEditor, type EditableVariant } from './VariantEditor';

type Category = Readonly<{ id: string; nombre: string }>;

function editableVariant(value?: OfflineVariant): EditableVariant {
  return {
    id: value?.id || randomUUID(),
    talla: value?.talla || '',
    color: value?.color || '',
    priceCents: value?.priceCents || 0,
    priceText: value ? (value.priceCents / 100).toFixed(2) : '',
  };
}

export function ProductEditor({
  initial,
  categories,
  onSave,
  onCancel,
  busy,
}: {
  initial: OfflineProduct;
  categories: readonly Category[];
  onSave: (product: OfflineProduct) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [name, setName] = useState(initial.nombre);
  const [brand, setBrand] = useState(initial.marca || '');
  const [material, setMaterial] = useState(initial.material);
  const [description, setDescription] = useState(initial.descripcion);
  const [categoryId, setCategoryId] = useState(initial.categoriaId || categories[0]?.id || '');
  const [variants, setVariants] = useState<EditableVariant[]>(
    initial.variants.length ? initial.variants.map(editableVariant) : [editableVariant()],
  );

  const valid = name.trim().length >= 2 && material.trim().length >= 2 &&
    description.trim().length >= 10 && Boolean(categoryId) && variants.every((variant) =>
      variant.talla.trim() && variant.color.trim() && /^\d+(?:[.,]\d{1,2})?$/.test(variant.priceText.trim()));
  const submit = () => {
    if (!valid) return;
    onSave({
      ...initial,
      nombre: name.trim(),
      ...(brand.trim() ? { marca: brand.trim() } : { marca: undefined }),
      material: material.trim(),
      descripcion: description.trim(),
      categoriaId: categoryId,
      variants: variants.map(({ priceText, ...variant }) => ({
        ...variant,
        talla: variant.talla.trim().toUpperCase(),
        color: variant.color.trim(),
        priceCents: Math.round(Number(priceText.replace(',', '.')) * 100),
      })),
    });
  };

  return <View style={styles.editor}>
    <Text style={styles.title}>{initial.version === null ? 'Nueva prenda offline' : 'Editar prenda'}</Text>
    <TextInput value={name} onChangeText={setName} placeholder="Nombre de la prenda" style={styles.input} />
    <TextInput value={brand} onChangeText={setBrand} placeholder="Marca (opcional)" style={styles.input} />
    <TextInput value={material} onChangeText={setMaterial} placeholder="Material" style={styles.input} />
    <TextInput value={description} onChangeText={setDescription} placeholder="Descripción" multiline style={[styles.input, styles.description]} />
    <Text style={styles.label}>Categoría</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {categories.map((category) => <Pressable key={category.id} onPress={() => setCategoryId(category.id)} style={[styles.chip, categoryId === category.id && styles.chipActive]}><Text style={[styles.chipText, categoryId === category.id && styles.chipTextActive]}>{category.nombre}</Text></Pressable>)}
    </ScrollView>
    <View style={styles.variantHeading}><Text style={styles.label}>Variantes</Text><Pressable onPress={() => setVariants((current) => [...current, editableVariant()])}><Text style={styles.add}>+ Agregar variante</Text></Pressable></View>
    {variants.map((variant, index) => <VariantEditor
      key={variant.id}
      value={variant}
      removable={variants.length > 1}
      onChange={(next) => setVariants((current) => current.map((item) => item.id === next.id ? next : item))}
      onRemove={() => setVariants((current) => current.filter((item) => item.id !== variant.id))}
    />)}
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" disabled={!valid || busy} onPress={submit} style={[styles.primary, (!valid || busy) && styles.disabled]}><Text style={styles.primaryText}>{busy ? 'Guardando…' : 'Guardar en el dispositivo'}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={styles.cancel}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  editor: { gap: 10, padding: 15, borderWidth: 1, borderColor: '#dce3da', borderRadius: 16, backgroundColor: '#fff' },
  title: { color: '#173e2a', fontSize: 15, fontWeight: '900' },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#d9dfd8', borderRadius: 10, paddingHorizontal: 11, color: '#1e3024', fontSize: 11 },
  description: { minHeight: 76, paddingTop: 11, textAlignVertical: 'top' },
  label: { color: '#516158', fontSize: 10, fontWeight: '900' },
  chips: { gap: 7 },
  chip: { borderWidth: 1, borderColor: '#d9dfd8', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  chipActive: { backgroundColor: '#173e2a', borderColor: '#173e2a' },
  chipText: { color: '#617067', fontSize: 9, fontWeight: '700' },
  chipTextActive: { color: '#fff' },
  variantHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  add: { color: '#2f7047', fontSize: 10, fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  primary: { minHeight: 42, borderRadius: 10, backgroundColor: '#173e2a', justifyContent: 'center', paddingHorizontal: 14 },
  primaryText: { color: '#fff', fontSize: 10, fontWeight: '900' },
  cancel: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: '#d9dfd8', justifyContent: 'center', paddingHorizontal: 14 },
  cancelText: { color: '#59675d', fontSize: 10, fontWeight: '800' },
  disabled: { opacity: 0.4 },
});
