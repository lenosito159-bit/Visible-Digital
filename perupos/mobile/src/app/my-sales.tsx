import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { describePayments, formatLimaDate, formatSoles, type DaySummary, type LocalSale } from '@perupos/shared';
import { Empty, Screen, StatCard } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { saleLabel } from '@/lib/sale';
import { store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

/** Ventas guardadas en el celular: el dueño ve todas; el ayudante, las suyas. */
export default function MySales() {
  const { user } = useAuth();
  const [sales, setSales] = useState<LocalSale[]>([]);
  const [summary, setSummary] = useState<DaySummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      void Promise.all([store.listSales(user), store.daySummary(user)]).then(([list, day]) => {
        setSales(list);
        setSummary(day);
      });
    }, [user]),
  );

  return (
    <Screen>
      {summary && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
          <StatCard label="Hoy" cents={summary.salesCents} tone={colors.primaryDark} icon="today" />
          <StatCard label="Ventas" value={String(summary.salesCount)} icon="receipt" />
          {user?.role === 'ADMIN' && <StatCard label="Efectivo" cents={summary.cashCents} icon="cash" />}
          {user?.role === 'ADMIN' && <StatCard label="Yape/Plin/otros" cents={summary.digitalCents} icon="phone-portrait" tone={colors.yape} />}
        </View>
      )}
      {sales.map((sale) => (
        <Pressable key={sale.id} onPress={() => router.push(`/receipt/${sale.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {saleLabel(sale)} · {formatLimaDate(sale.createdAt)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {describePayments(sale.payments)}
              {sale.customerName ? ` · ${sale.customerName}` : ''}
            </Text>
            {sale.status === 'VOIDED' && <Text style={[styles.meta, { color: colors.danger }]}>ANULADA</Text>}
          </View>
          <Text style={[styles.amount, sale.status === 'VOIDED' && { textDecorationLine: 'line-through' }]}>{formatSoles(sale.totalCents)}</Text>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      ))}
      {sales.length === 0 && <Empty icon="receipt" text="Todavía no hay ventas." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { ...shared.card, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.md },
  title: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  amount: { fontSize: font.large, fontWeight: '900', color: colors.text },
});
