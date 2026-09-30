import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatSoles, type Category, type Product } from '@perupos/shared';
import { CartPanel } from '@/components/CartPanel';
import { ConnectionBar } from '@/components/ConnectionBar';
import { ProductTile } from '@/components/ProductTile';
import { Button, Chip, Empty, type IconName } from '@/components/ui';
import { cart, cartTotals, useCart } from '@/lib/cart';
import * as db from '@/lib/db';
import { onDataChanged } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

/**
 * Pantalla de venta. En tablet: carrito a la izquierda y productos a la
 * derecha. En celular: productos a pantalla completa y el carrito abajo.
 */
export default function Pos() {
  const { width } = useWindowDimensions();
  const wide = width >= 720;
  const { lines } = useCart();
  const { subtotalCents, count } = cartTotals(lines);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);
  useFocusEffect(
    useCallback(() => {
      void db.listCategories().then(setCategories);
      void db.listProducts({ search, categoryId }).then(setProducts);
    }, [search, categoryId, version]),
  );

  const icons = useMemo(() => new Map(categories.map((c) => [c.id, c.icon])), [categories]);
  const gridWidth = wide ? width * 0.6 : width;
  const columns = Math.max(2, Math.floor((gridWidth - spacing.md) / 170));
  const tileWidth = (gridWidth - spacing.md * (columns + 1)) / columns;

  const add = (p: Product) => {
    cart.add(p);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const checkout = () => {
    setShowCart(false);
    router.push('/checkout');
  };

  const grid = (
    <View style={{ flex: 1 }}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={22} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar por nombre o código"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} accessibilityLabel="Borrar búsqueda" style={{ padding: 8 }}>
              <Ionicons name="close-circle" size={22} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Escanear código de barras" onPress={() => router.push('/scanner')} style={styles.scan}>
          <Ionicons name="barcode" size={30} color={colors.text} />
          <Text style={styles.scanText}>Escanear</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="Todos" selected={!categoryId} onPress={() => setCategoryId(null)} icon="apps" />
        {categories.map((c) => (
          <Chip key={c.id} label={c.name} icon={c.icon as IconName} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
        ))}
      </ScrollView>
      <FlatList
        key={columns}
        data={products}
        numColumns={columns}
        keyExtractor={(p) => p.id}
        columnWrapperStyle={{ gap: spacing.md }}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 120 }}
        renderItem={({ item }) => <ProductTile product={item} icon={icons.get(item.categoryId ?? '')} width={tileWidth} onPress={() => add(item)} />}
        ListEmptyComponent={
          <View>
            <Empty icon="search" text="No hay productos con ese nombre." />
            <Button label="Crear producto nuevo" icon="add-circle" variant="accent" onPress={() => router.push({ pathname: '/product-new', params: { name: search } })} />
          </View>
        }
      />
    </View>
  );

  if (wide) {
    return (
      <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
        <ConnectionBar />
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ width: width * 0.4, borderRightWidth: 1, borderRightColor: colors.border }}>
            <CartPanel icons={icons} onCheckout={checkout} />
          </View>
          {grid}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom', 'left', 'right']}>
      <ConnectionBar />
      {grid}
      {lines.length > 0 && (
        <View style={styles.bottomBar}>
          <Pressable accessibilityRole="button" onPress={() => setShowCart(true)} style={styles.cartSummary}>
            <Ionicons name="cart" size={26} color={colors.secondary} />
            <View>
              <Text style={styles.cartCount}>{count} {count === 1 ? 'producto' : 'productos'}</Text>
              <Text style={styles.cartLink}>Ver carrito</Text>
            </View>
          </Pressable>
          <Button label={`Cobrar ${formatSoles(subtotalCents)}`} icon="cash" onPress={checkout} style={{ flex: 1 }} big />
        </View>
      )}
      <Modal visible={showCart} animationType="slide" onRequestClose={() => setShowCart(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }}>
          <Pressable onPress={() => setShowCart(false)} style={styles.closeCart} accessibilityRole="button">
            <Ionicons name="chevron-down" size={28} color={colors.secondary} />
            <Text style={shared.sectionTitle}>Seguir vendiendo</Text>
          </Pressable>
          <CartPanel icons={icons} onCheckout={checkout} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    minHeight: 56,
  },
  searchInput: { flex: 1, fontSize: font.body, color: colors.text },
  scan: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', minWidth: 96 },
  scanText: { fontSize: 13, fontWeight: '900', color: colors.text },
  chips: { gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cartSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, minHeight: 56 },
  cartCount: { fontSize: font.body, fontWeight: '900', color: colors.text },
  cartLink: { fontSize: font.small, fontWeight: '700', color: colors.secondary, textDecorationLine: 'underline' },
  closeCart: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
});
