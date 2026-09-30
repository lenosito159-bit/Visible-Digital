import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatSoles, type Product } from '@perupos/shared';
import { imageUrl } from '@/lib/api';
import { colors, font } from '@/theme';
import type { IconName } from './ui';

/** Ícono por categoría para productos sin foto. */
export function ProductImage({ product, icon, size }: { product: Product; icon?: string; size: number }) {
  const uri = imageUrl(product.imageUrl);
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 10 }} contentFit="cover" transition={150} />;
  return (
    <View style={[styles.placeholder, { width: size, height: size }]}>
      <Ionicons name={(icon as IconName) ?? 'pricetag'} size={size * 0.45} color={colors.secondary} />
    </View>
  );
}

export function ProductTile({ product, icon, onPress, width }: { product: Product; icon?: string; onPress: () => void; width: number }) {
  const low = product.minStock > 0 && product.stock <= product.minStock;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatSoles(product.priceCents)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { width, opacity: pressed ? 0.7 : 1 }]}
    >
      <ProductImage product={product} icon={icon} size={width - 20} />
      <Text style={styles.name} numberOfLines={2}>
        {product.name}
      </Text>
      <Text style={styles.price}>
        {formatSoles(product.priceCents)}
        {product.unit === 'KG' ? ' /kg' : ''}
      </Text>
      {low && (
        <View style={styles.lowBadge}>
          <Text style={styles.lowText}>{product.stock <= 0 ? 'Agotado' : `Quedan ${product.stock}`}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  placeholder: { backgroundColor: colors.secondarySoft, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: font.small + 1, fontWeight: '700', color: colors.text, minHeight: 38 },
  price: { fontSize: font.large, fontWeight: '900', color: colors.primaryDark },
  lowBadge: { position: 'absolute', top: 14, left: 14, backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  lowText: { fontSize: 12, fontWeight: '800', color: colors.text },
});
