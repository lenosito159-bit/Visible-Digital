import Ionicons from '@expo/vector-icons/Ionicons';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatSoles, lineTotal } from '@perupos/shared';
import { cart, cartTotals, useCart, type CartLine } from '@/lib/cart';
import { colors, font, spacing } from '@/theme';
import { ProductImage } from './ProductTile';
import { Button, Empty } from './ui';

function QtyControl({ line }: { line: CartLine }) {
  const step = line.product.unit === 'KG' ? 0.25 : 1;
  const label = line.product.unit === 'KG' ? `${line.quantity.toFixed(2)} kg` : String(line.quantity);
  return (
    <View style={styles.qty}>
      <Pressable
        accessibilityLabel="Quitar uno"
        onPress={() => cart.setQuantity(line.product.id, line.quantity - step)}
        style={styles.qtyButton}
      >
        <Ionicons name={line.quantity - step <= 0 ? 'trash' : 'remove'} size={24} color={colors.secondary} />
      </Pressable>
      <Text style={styles.qtyText}>{label}</Text>
      <Pressable accessibilityLabel="Agregar uno" onPress={() => cart.setQuantity(line.product.id, line.quantity + step)} style={styles.qtyButton}>
        <Ionicons name="add" size={24} color={colors.secondary} />
      </Pressable>
    </View>
  );
}

export function CartLineRow({ line, icon }: { line: CartLine; icon?: string }) {
  return (
    <View style={styles.line}>
      <ProductImage product={line.product} icon={icon} size={52} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name} numberOfLines={2}>
          {line.product.name}
        </Text>
        <Text style={styles.unit}>
          {formatSoles(line.product.priceCents)} {line.product.unit === 'KG' ? 'el kilo' : 'c/u'}
        </Text>
        <QtyControl line={line} />
      </View>
      <Text style={styles.subtotal}>{formatSoles(lineTotal(line.product.priceCents, line.quantity))}</Text>
    </View>
  );
}

/** Carrito con imagen, nombre, cantidad, precio unitario y subtotal. */
export function CartPanel({ icons, onCheckout }: { icons: Map<string, string>; onCheckout: () => void }) {
  const { lines } = useCart();
  const { subtotalCents } = cartTotals(lines);
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Ionicons name="cart" size={24} color={colors.secondary} />
        <Text style={styles.title}>Carrito</Text>
        {lines.length > 0 && (
          <Pressable onPress={() => cart.clear()} accessibilityLabel="Vaciar carrito" style={styles.clear}>
            <Text style={styles.clearText}>Vaciar</Text>
          </Pressable>
        )}
      </View>
      <FlatList
        data={lines}
        keyExtractor={(l) => l.product.id}
        renderItem={({ item }) => <CartLineRow line={item} icon={icons.get(item.product.categoryId ?? '')} />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={<Empty icon="scan" text="Escanea o toca un producto para agregarlo." />}
        style={{ flex: 1 }}
      />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.total}>{formatSoles(subtotalCents)}</Text>
      </View>
      <Button label={`Cobrar ${formatSoles(subtotalCents)}`} icon="cash" big onPress={onCheckout} disabled={lines.length === 0} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: colors.surface, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: font.large, fontWeight: '900', color: colors.secondary },
  clear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md },
  clearText: { color: colors.danger, fontWeight: '800', fontSize: font.body },
  line: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', paddingVertical: spacing.sm },
  name: { fontSize: font.body, fontWeight: '700', color: colors.text },
  unit: { fontSize: font.small, color: colors.textMuted },
  subtotal: { fontSize: font.large, fontWeight: '900', color: colors.text, minWidth: 90, textAlign: 'right' },
  sep: { height: 1, backgroundColor: colors.border },
  qty: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  qtyButton: { width: 48, height: 44, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  qtyText: { fontSize: font.large, fontWeight: '900', minWidth: 56, textAlign: 'center', color: colors.text },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: spacing.sm, borderTopWidth: 2, borderTopColor: colors.border },
  totalLabel: { fontSize: font.large, fontWeight: '800', color: colors.textMuted },
  total: { fontSize: font.huge, fontWeight: '900', color: colors.text },
});
