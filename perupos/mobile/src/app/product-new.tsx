import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseSoles, type Category, type Product, type Unit } from '@perupos/shared';
import { Banner, Button, Chip, Field, Screen, type IconName } from '@/components/ui';
import { cart } from '@/lib/cart';
import * as db from '@/lib/db';
import { registerProduct } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

/**
 * Alta rápida: nombre, precio, categoría y foto. Funciona sin internet.
 * Para platos preparados, el Admin puede cargar fotos de PeruFoodNet.
 */
export default function ProductNew() {
  const params = useLocalSearchParams<{ barcode?: string; name?: string }>();
  const [name, setName] = useState(params.name ?? '');
  const [price, setPrice] = useState('');
  const [unit, setUnit] = useState<Unit>('UND');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void db.listCategories().then(setCategories);
  }, []);

  const pick = async (source: 'camera' | 'gallery') => {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return setError('Sin permiso de cámara. Elige una foto de la galería.');
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0].uri);
  };

  const save = async () => {
    const priceCents = parseSoles(price);
    if (name.trim().length < 2) return setError('Escribe el nombre del producto.');
    if (!priceCents) return setError('Escribe el precio. Ej: 3.50');
    setSaving(true);
    const id = Crypto.randomUUID();
    const product: Product = {
      id,
      barcode: params.barcode ?? null,
      name: name.trim(),
      categoryId,
      priceCents,
      costCents: null,
      stock: 0,
      minStock: 0,
      unit,
      taxAffectation: 'GRAVADO',
      imageUrl: null,
      active: true,
      updatedAt: new Date().toISOString(),
    };
    await registerProduct(
      { id, barcode: product.barcode, name: product.name, categoryId, priceCents, unit },
      product,
      photo,
    );
    cart.add({ ...product, imageUrl: photo });
    router.dismissTo('/pos');
  };

  return (
    <Screen footer={<Button label="Guardar y agregar a la venta" icon="checkmark-circle" big onPress={save} loading={saving} />}>
      {params.barcode ? <Banner tone="info" icon="barcode" text={`Código ${params.barcode} no registrado. Créalo ahora:`} /> : null}
      <View style={styles.photoRow}>
        <View style={styles.photo}>
          {photo ? <Image source={{ uri: photo }} style={styles.photoImg} contentFit="cover" /> : <Ionicons name="image" size={48} color={colors.textMuted} />}
        </View>
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Button label="Tomar foto" icon="camera" variant="secondary" onPress={() => pick('camera')} />
          <Button label="Galería" icon="images" variant="ghost" onPress={() => pick('gallery')} />
        </View>
      </View>
      <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Galleta Soda Field" autoFocus={!params.name} />
      <Field label="Precio (S/)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="0.00" />
      <Text style={shared.label}>Se vende por</Text>
      <View style={styles.chips}>
        <Chip label="Unidad" selected={unit === 'UND'} onPress={() => setUnit('UND')} icon="cube" />
        <Chip label="Kilo (a granel)" selected={unit === 'KG'} onPress={() => setUnit('KG')} icon="scale" />
      </View>
      <Text style={shared.label}>Categoría</Text>
      <View style={styles.chips}>
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} icon={c.icon as IconName} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
        ))}
      </View>
      {error && <Banner tone="danger" text={error} />}
      <Pressable onPress={() => router.back()} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={styles.cancel}>Cancelar</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' },
  photo: { width: 120, height: 120, borderRadius: 16, backgroundColor: colors.secondarySoft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoImg: { width: 120, height: 120 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  cancel: { color: colors.danger, fontSize: font.body, fontWeight: '700', textAlign: 'center' },
});
