import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatSoles, type Product } from '@perupos/shared';
import { ProductImage } from '@/components/ProductTile';
import { Button, Chip, Field, Screen } from '@/components/ui';
import * as db from '@/lib/db';
import { onDataChanged } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

/** Catálogo del Admin: precios, stock y mínimos. */
export default function AdminProducts() {
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [list, setList] = useState<Product[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);
  useFocusEffect(
    useCallback(() => {
      void db.listProducts({ search }).then(setList);
    }, [search, version]),
  );

  const rows = onlyLow ? list.filter((p) => p.minStock > 0 && p.stock <= p.minStock) : list;

  const header = (
    <View>
      <Button label="Nuevo producto" icon="add-circle" variant="accent" onPress={() => router.push('/product-new')} />
      <View style={{ height: spacing.md }} />
      <Field label="Buscar" value={search} onChangeText={setSearch} placeholder="Nombre o código" />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Chip label="Todos" selected={!onlyLow} onPress={() => setOnlyLow(false)} />
        <Chip label="Por reponer" icon="warning" color={colors.danger} selected={onlyLow} onPress={() => setOnlyLow(true)} />
      </View>
    </View>
  );

  return (
    <Screen scroll={false} padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        initialNumToRender={15}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: p }) => {
          const low = p.minStock > 0 && p.stock <= p.minStock;
          return (
            <Pressable onPress={() => router.push(`/admin/product/${p.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
              <ProductImage product={p} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{p.name}</Text>
                <Text style={[styles.meta, low && { color: colors.danger, fontWeight: '800' }]}>
                  Stock {p.stock} {p.unit === 'KG' ? 'kg' : 'und'} · mín. {p.minStock}
                </Text>
              </View>
              <Text style={styles.price}>{formatSoles(p.priceCents)}</Text>
              <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { ...shared.card, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm, padding: spacing.md },
  name: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  price: { fontSize: font.large, fontWeight: '900', color: colors.primaryDark },
});
