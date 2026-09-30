import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { daysBetween, debtReminderMessage, formatSoles, whatsappLink, type Customer } from '@perupos/shared';
import { CustomerRow } from '@/components/CustomerPicker';
import { Chip, Empty, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { colors, font, spacing } from '@/theme';

/** Días desde el último abono (o desde el fiado pendiente más antiguo si nunca abonó). */
function daysWithoutPayment(c: Customer): number {
  const ref = [c.lastPaymentAt, c.oldestDebtAt].filter(Boolean).sort().pop();
  return ref ? daysBetween(ref) : 0;
}

/** Deudas por cobrar: ordenadas por monto o antigüedad, con recordatorio por WhatsApp. */
export default function Debts() {
  const { settings } = useAuth();
  const [list, setList] = useState<Customer[]>([]);
  const [sort, setSort] = useState<'amount' | 'age'>('amount');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const overdueDays = settings?.overdueDays ?? 30;

  useFocusEffect(
    useCallback(() => {
      void db.listCustomers({ withDebt: true }).then(setList);
    }, []),
  );

  const rows = list
    .map((c) => ({ c, days: daysWithoutPayment(c) }))
    .filter((r) => !onlyOverdue || r.days > overdueDays)
    .sort((a, b) => (sort === 'amount' ? b.c.balanceCents - a.c.balanceCents : b.days - a.days));

  const remind = (c: Customer, days: number) => {
    const text = debtReminderMessage({
      customerName: c.name,
      balanceCents: c.balanceCents,
      businessName: settings?.nombreComercial || settings?.razonSocial || 'tu bodega',
      days,
    });
    const link = c.phone ? whatsappLink(c.phone, text) : null;
    if (link) void Linking.openURL(link);
  };

  const total = rows.reduce((s, r) => s + r.c.balanceCents, 0);

  return (
    <Screen>
      <Text style={styles.total}>
        {rows.length} {rows.length === 1 ? 'cliente debe' : 'clientes deben'} {formatSoles(total)}
      </Text>
      <View style={styles.filters}>
        <Chip label="Mayor deuda" icon="trending-down" selected={sort === 'amount'} onPress={() => setSort('amount')} />
        <Chip label="Más antigua" icon="time" selected={sort === 'age'} onPress={() => setSort('age')} />
        <Chip label={`Vencidos (+${overdueDays} días)`} icon="alert-circle" color={colors.danger} selected={onlyOverdue} onPress={() => setOnlyOverdue(!onlyOverdue)} />
      </View>
      <View style={{ gap: spacing.sm }}>
        {rows.map(({ c, days }) => (
          <View key={c.id}>
            <CustomerRow
              customer={c}
              onPress={() => router.push(`/customers/${c.id}`)}
              right={
                c.phone ? (
                  <Pressable accessibilityLabel={`Recordar a ${c.name} por WhatsApp`} onPress={() => remind(c, days)} style={styles.wa}>
                    <Ionicons name="logo-whatsapp" size={28} color="#FFFFFF" />
                  </Pressable>
                ) : null
              }
            />
            {days > overdueDays && <Text style={styles.overdue}>{days} días sin abonar</Text>}
          </View>
        ))}
        {rows.length === 0 && <Empty icon="happy" text={onlyOverdue ? 'No hay deudas vencidas.' : 'Nadie te debe. ¡Bien!'} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  total: { fontSize: font.large, fontWeight: '900', color: colors.danger, marginBottom: spacing.md },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  wa: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#128C7E', alignItems: 'center', justifyContent: 'center' },
  overdue: { color: colors.danger, fontWeight: '800', fontSize: font.small, marginTop: 4, marginLeft: spacing.md },
});
