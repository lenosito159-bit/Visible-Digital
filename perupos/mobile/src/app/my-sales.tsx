import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { describePayments, formatLimaDate, formatSoles, type Sale } from '@perupos/shared';
import { Banner, Empty, Screen, StatCard } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { saleLabel } from '@/lib/sale';
import { useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

type Row = { sale: Omit<Sale, 'items'>; status: db.LocalSaleStatus | 'SERVER'; error?: string | null };

/** Historial de ventas propias (el vendedor solo ve las suyas; el Admin, todas). */
export default function MySales() {
  const { user } = useAuth();
  const { online, pending } = useSyncState();
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<{ salesCents: number; salesCount: number; cashCents: number; digitalCents: number } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      (async () => {
        const local = await db.listLocalSales(user.id, 100);
        const localRows: Row[] = local.map((l) => ({ sale: l.sale, status: l.status, error: l.error }));
        if (!online) return setRows(localRows);
        try {
          const server = await api.get<Omit<Sale, 'items'>[]>('/sales?limit=100');
          const serverIds = new Set(server.map((s) => s.id));
          // Las ventas que aún no suben se muestran arriba.
          const notSynced = localRows.filter((r) => r.status !== 'SYNCED' && !serverIds.has(r.sale.id));
          setRows([...notSynced, ...server.map((s) => ({ sale: s, status: 'SERVER' as const }))]);
          setSummary(await api.get('/reports/summary'));
        } catch {
          setRows(localRows);
        }
      })();
    }, [user, online, pending]),
  );

  return (
    <Screen>
      {summary && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
          <StatCard label="Hoy" cents={summary.salesCents} tone={colors.primaryDark} icon="today" />
          <StatCard label="Ventas" value={String(summary.salesCount)} icon="receipt" />
          <StatCard label="Efectivo" cents={summary.cashCents} icon="cash" />
          <StatCard label="Yape/Plin/otros" cents={summary.digitalCents} icon="phone-portrait" tone={colors.yape} />
        </View>
      )}
      {!online && <Banner tone="warning" text="No hay señal: estas son las ventas guardadas en este celular." />}
      {rows.map(({ sale, status, error }) => (
        <Pressable key={sale.id} onPress={() => router.push(`/receipt/${sale.id}`)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              {saleLabel(sale as Sale)} · {formatLimaDate(sale.createdAt)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {describePayments(sale.payments)}
              {sale.customerName ? ` · ${sale.customerName}` : ''}
            </Text>
            {status === 'PENDING' && <Text style={[styles.meta, { color: '#92400E' }]}>Guardada, falta enviar</Text>}
            {status === 'FAILED' && <Text style={[styles.meta, { color: colors.danger }]}>No se registró: {error}</Text>}
            {sale.status === 'VOIDED' && <Text style={[styles.meta, { color: colors.danger }]}>ANULADA</Text>}
          </View>
          <Text style={[styles.amount, sale.status === 'VOIDED' && { textDecorationLine: 'line-through' }]}>{formatSoles(sale.totalCents)}</Text>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </Pressable>
      ))}
      {rows.length === 0 && <Empty icon="receipt" text="Todavía no hay ventas." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { ...shared.card, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.md },
  title: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  amount: { fontSize: font.large, fontWeight: '900', color: colors.text },
});
