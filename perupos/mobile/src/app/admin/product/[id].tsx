import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { TAX_AFFECTATIONS, formatLimaDate, parseSoles, type Category, type Product, type StockMovement, type TaxAffectation } from '@perupos/shared';
import { ProductImage } from '@/components/ProductTile';
import { Banner, Button, Chip, Field, Loading, Screen, type IconName } from '@/components/ui';
import { api, errorMessage, request } from '@/lib/api';
import * as db from '@/lib/db';
import { syncNow, useSyncState } from '@/lib/sync';
import { useAuth } from '@/lib/auth';
import { SERVER_ENABLED } from '@/lib/mode';
import { keepPhoto, store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

const TAX_LABELS: Record<TaxAffectation, string> = { GRAVADO: 'Con IGV', EXONERADO: 'Exonerado', INAFECTO: 'Inafecto' };

export default function EditProduct() {
  return SERVER_ENABLED ? <ServerEditProduct /> : <LocalEditProduct />;
}

/** Módulo de servidor: solo el Admin cambia precios, stock, mínimos y afectación al IGV. */
function ServerEditProduct() {
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

const MOVEMENT_LABELS: Record<StockMovement['kind'], string> = {
  INICIAL: 'Stock inicial',
  INGRESO: 'Llegó mercadería',
  AJUSTE: 'Conteo',
  VENTA: 'Venta',
  ANULACION: 'Venta anulada',
};

/** Producto en el celular: precio, mínimo, llegó mercadería, conteo del anaquel e historial. */
function LocalEditProduct() {
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
