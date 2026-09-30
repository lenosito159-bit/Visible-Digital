import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { TAX_AFFECTATIONS, parseSoles, type Category, type Product, type TaxAffectation } from '@perupos/shared';
import { ProductImage } from '@/components/ProductTile';
import { Banner, Button, Chip, Field, Loading, Screen, type IconName } from '@/components/ui';
import { api, errorMessage, request } from '@/lib/api';
import * as db from '@/lib/db';
import { syncNow, useSyncState } from '@/lib/sync';
import { shared, spacing } from '@/theme';

const TAX_LABELS: Record<TaxAffectation, string> = { GRAVADO: 'Con IGV', EXONERADO: 'Exonerado', INAFECTO: 'Inafecto' };

/** Solo el Admin cambia precios, stock, mínimos y afectación al IGV. */
export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { online } = useSyncState();
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState({ name: '', price: '', cost: '', minStock: '', barcode: '', restock: '' });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [tax, setTax] = useState<TaxAffectation>('GRAVADO');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    void db.listCategories().then(setCategories);
    void db.getProduct(id).then((p) => {
      if (!p) return;
      setProduct(p);
      setCategoryId(p.categoryId);
      setTax(p.taxAffectation);
      setForm({
        name: p.name,
        price: (p.priceCents / 100).toFixed(2),
        cost: p.costCents ? (p.costCents / 100).toFixed(2) : '',
        minStock: String(p.minStock),
        barcode: p.barcode ?? '',
        restock: '',
      });
    });
  }, [id]);

  if (!product) return <Loading />;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setMessage(null);
    try {
      const updated = await api.patch<Product>(`/products/${id}`, {
        name: form.name,
        priceCents: parseSoles(form.price) ?? product.priceCents,
        costCents: form.cost ? parseSoles(form.cost) : null,
        minStock: Number(form.minStock) || 0,
        barcode: form.barcode || null,
        categoryId,
        taxAffectation: tax,
      });
      const restock = Number(form.restock.replace(',', '.'));
      const final = restock > 0 ? await api.post<Product>(`/products/${id}/restock`, { quantity: restock }) : updated;
      await db.saveProducts([final]);
      setProduct(final);
      setForm((f) => ({ ...f, restock: '' }));
      setMessage({ tone: 'success', text: 'Guardado.' });
      void syncNow();
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  const changePhoto = async () => {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (result.canceled || !result.assets[0]) return;
    const form = new FormData();
    form.append('image', { uri: result.assets[0].uri, name: 'foto.jpg', type: 'image/jpeg' } as unknown as Blob);
    try {
      const updated = await request<Product>(`/products/${id}/image`, { method: 'POST', form, timeoutMs: 60_000 });
      await db.saveProducts([updated]);
      setProduct(updated);
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  const deactivate = async () => {
    await api.patch(`/products/${id}`, { active: false });
    await db.saveProducts([{ ...product, active: false }]);
    router.back();
  };

  return (
    <Screen footer={<Button label="Guardar cambios" icon="save" big onPress={save} disabled={!online} />}>
      {!online && <Banner tone="warning" text="Para editar productos necesitas internet." />}
      <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.lg }}>
        <ProductImage product={product} size={96} />
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Text style={shared.sectionTitle}>Stock actual: {product.stock}</Text>
          <Button label="Cambiar foto" icon="camera" variant="ghost" onPress={changePhoto} disabled={!online} />
        </View>
      </View>
      <Field label="Nombre" value={form.name} onChangeText={set('name')} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field label="Precio de venta (S/)" value={form.price} onChangeText={set('price')} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Costo (S/)" value={form.cost} onChangeText={set('cost')} keyboardType="decimal-pad" />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field label="Llegó mercadería (+)" value={form.restock} onChangeText={set('restock')} keyboardType="decimal-pad" placeholder="0" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Stock mínimo" value={form.minStock} onChangeText={set('minStock')} keyboardType="decimal-pad" />
        </View>
      </View>
      <Field label="Código de barras" value={form.barcode} onChangeText={set('barcode')} keyboardType="number-pad" />
      <Text style={shared.label}>Categoría</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} icon={c.icon as IconName} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
        ))}
      </View>
      <Text style={shared.label}>IGV</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
        {TAX_AFFECTATIONS.map((t) => (
          <Chip key={t} label={TAX_LABELS[t]} selected={tax === t} onPress={() => setTax(t)} />
        ))}
      </View>
      {message && <Banner tone={message.tone} text={message.text} />}
      <Button label="Dejar de vender este producto" variant="ghost" icon="eye-off" onPress={deactivate} disabled={!online} />
    </Screen>
  );
}
