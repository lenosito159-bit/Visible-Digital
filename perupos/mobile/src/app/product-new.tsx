import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseSoles, type Category, type Product, type Unit } from '@perupos/shared';
import { Banner, Button, Chip, Field, Screen, type IconName } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { useAuth } from '@/lib/auth';
import { cart } from '@/lib/cart';
import * as db from '@/lib/db';
import { keepPhoto, store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

/**
 * Producto nuevo: nombre, precio, cuántos hay y (opcional) foto y código.
 * Se guarda en el celular. Desde la venta, además se agrega al carrito.
 */
export default function ProductNew() {
  const params = useLocalSearchParams<{ barcode?: string; name?: string; from?: string }>();
  const fromAdmin = params.from === 'admin';
  const { user } = useAuth();
  const [id] = useState(() => Crypto.randomUUID());
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [barcode, setBarcode] = useState(params.barcode ?? '');
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
    const stockQty = stock.trim() ? Number(stock.replace(',', '.')) : 0;
    const minQty = minStock.trim() ? Number(minStock.replace(',', '.')) : 0;
    if (!Number.isFinite(stockQty) || stockQty < 0 || !Number.isFinite(minQty) || minQty < 0) {
      return setError('Revisa la cantidad: solo números.');
    }
    setError(null);
    setSaving(true);
    try {
      // La foto se copia a la carpeta de la app con el id del producto (reintentos sin duplicar).
      const imageUrl = photo ? await keepPhoto(photo, id) : null;
      const saved = await store.newProduct(user!, {
        id,
        name,
        priceCents,
        stock: stockQty,
        minStock: minQty,
        unit,
        barcode: barcode || null,
        categoryId,
        imageUrl,
      });
      if (fromAdmin) router.back();
      else {
        cart.add(saved);
        router.dismissTo('/pos');
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen footer={<Button label={fromAdmin ? 'Guardar producto' : 'Guardar y agregar a la venta'} icon="checkmark-circle" big onPress={save} loading={saving} />}>
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
      {(
        <>
          <View style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ flex: 1 }}>
              <Field label={unit === 'KG' ? '¿Cuántos kilos tienes?' : '¿Cuántos tienes ahora?'} value={stock} onChangeText={setStock} keyboardType="decimal-pad" placeholder="0" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Avisar cuando queden (opcional)" value={minStock} onChangeText={setMinStock} keyboardType="decimal-pad" placeholder="0" />
            </View>
          </View>
          <Field label="Código de barras (opcional)" value={barcode} onChangeText={setBarcode} keyboardType="number-pad" />
        </>
      )}
      {categories.length > 0 && <Text style={shared.label}>Categoría</Text>}
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
