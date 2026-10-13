import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { formatLimaDate, parseSoles, type Product, type StockMovement } from '@perupos/shared';
import { ProductImage } from '@/components/ProductTile';
import { Banner, Button, Field, Loading, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import * as db from '@/lib/db';
import { useAuth } from '@/lib/auth';
import { keepPhoto, store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

const MOVEMENT_LABELS: Record<StockMovement['kind'], string> = {
  INICIAL: 'Stock inicial',
  INGRESO: 'Llegó mercadería',
  AJUSTE: 'Conteo',
  VENTA: 'Venta',
  ANULACION: 'Venta anulada',
};

/** Producto en el celular: precio, mínimo, llegó mercadería, conteo del anaquel e historial. */
export default function EditProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [form, setForm] = useState({ name: '', price: '', cost: '', minStock: '', barcode: '' });
  const [restock, setRestock] = useState('');
  const [counted, setCounted] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = async () => {
    const p = await db.getProduct(id);
    if (!p) return;
    setProduct(p);
    setHistory(await store.stockHistory(id));
    setForm({
      name: p.name,
      price: (p.priceCents / 100).toFixed(2),
      cost: p.costCents ? (p.costCents / 100).toFixed(2) : '',
      minStock: String(p.minStock),
      barcode: p.barcode ?? '',
    });
  };
  useEffect(() => {
    void load();
  }, [id]);

  if (!product || !user) return <Loading />;
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const qty = (text: string) => Number(text.replace(',', '.'));
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage(null);
    try {
      await fn();
      await load();
      setMessage({ tone: 'success', text: ok });
      return true;
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
      return false;
    }
  };

  const save = () => {
    const priceCents = parseSoles(form.price);
    if (!priceCents) return setMessage({ tone: 'danger', text: 'Escribe el precio. Ej: 3.50' });
    void run(
      () =>
        store.editProduct(user, id, {
          name: form.name,
          priceCents,
          costCents: form.cost ? parseSoles(form.cost) : null,
          minStock: qty(form.minStock) || 0,
          barcode: form.barcode || null,
        }),
      'Guardado.',
    );
  };

  const unit = product.unit === 'KG' ? 'kg' : 'und';
  return (
    <Screen footer={<Button label="Guardar cambios" icon="save" big onPress={save} />}>
      <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center', marginBottom: spacing.lg }}>
        <ProductImage product={product} size={96} />
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Text style={shared.sectionTitle}>
            Hay {product.stock} {unit}
          </Text>
          <Button
            label="Cambiar foto"
            icon="camera"
            variant="ghost"
            onPress={async () => {
              const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
              if (result.canceled || !result.assets[0]) return;
              const uri = result.assets[0].uri;
              void run(async () => store.editProduct(user, id, { imageUrl: await keepPhoto(uri, id) }), 'Foto guardada.');
            }}
          />
        </View>
      </View>

      <View style={[shared.card, { gap: spacing.sm, marginBottom: spacing.lg }]}>
        <Field label={`Llegó mercadería: ¿cuántos ${unit}?`} value={restock} onChangeText={setRestock} keyboardType="decimal-pad" placeholder="0" />
        <Button
          label="Sumar al stock"
          icon="add-circle"
          variant="secondary"
          disabled={!(qty(restock) > 0)}
          onPress={async () => {
            if (await run(() => store.restock(user, id, qty(restock)), `Sumaste ${restock} ${unit}.`)) setRestock('');
          }}
        />
        <Field label={`Conté el anaquel: hay (${unit})`} value={counted} onChangeText={setCounted} keyboardType="decimal-pad" />
        <Button
          label="Corregir stock"
          icon="clipboard"
          variant="ghost"
          disabled={counted.trim() === '' || !(qty(counted) >= 0)}
          onPress={async () => {
            if (await run(() => store.countStock(user, id, qty(counted), 'Conteo del anaquel'), 'Stock corregido.')) setCounted('');
          }}
        />
      </View>

      <Field label="Nombre" value={form.name} onChangeText={set('name')} />
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Field label="Precio de venta (S/)" value={form.price} onChangeText={set('price')} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Costo (S/, opcional)" value={form.cost} onChangeText={set('cost')} keyboardType="decimal-pad" />
        </View>
      </View>
      <Field label="Avisar cuando queden" value={form.minStock} onChangeText={set('minStock')} keyboardType="decimal-pad" />
      <Field label="Código de barras" value={form.barcode} onChangeText={set('barcode')} keyboardType="number-pad" />
      {message && <Banner tone={message.tone} text={message.text} />}

      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Movimientos</Text>
      {history.map((m) => (
        <View key={m.id} style={{ flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: font.body, fontWeight: '800', color: colors.text }}>{MOVEMENT_LABELS[m.kind]}</Text>
            <Text style={{ fontSize: font.small, color: colors.textMuted }}>
              {formatLimaDate(m.createdAt)} · quedó {m.stockAfter} {unit}
              {m.note ? ` · ${m.note}` : ''}
            </Text>
          </View>
          <Text style={{ fontSize: font.large, fontWeight: '900', color: m.quantity < 0 ? colors.danger : colors.primaryDark }}>
            {m.quantity > 0 ? '+' : ''}
            {m.quantity}
          </Text>
        </View>
      ))}

      <Button
        label="Dejar de vender este producto"
        variant="ghost"
        icon="eye-off"
        style={{ marginTop: spacing.lg }}
        onPress={async () => {
          if (await run(() => store.editProduct(user, id, { active: false }), 'Ya no aparece en la venta.')) router.back();
        }}
      />
    </Screen>
  );
}
