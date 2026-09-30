import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import {
  PAYMENT_METHOD_LABELS,
  daysBetween,
  debtReminderMessage,
  formatLimaDate,
  formatSoles,
  parseSoles,
  whatsappLink,
  type CreditMovement,
  type Customer,
} from '@perupos/shared';
import { Banner, Button, Field, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { syncNow, useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

/** Ficha del cliente: deuda, límite, historial de fiados y abonos. */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, settings } = useAuth();
  const { online } = useSyncState();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<CreditMovement[] | null>(null);
  const [limit, setLimit] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void db.getCustomer(id).then((c) => {
        setCustomer(c);
        if (c) setLimit((c.creditLimitCents / 100).toFixed(2));
      });
      if (online) {
        api
          .get<{ customer: Customer; ledger: CreditMovement[] }>(`/customers/${id}`)
          .then((r) => setLedger(r.ledger))
          .catch(() => setLedger(null));
      }
    }, [id, online]),
  );

  if (!customer) return <Loading />;
  const days = customer.oldestDebtAt ? daysBetween(customer.lastPaymentAt && customer.lastPaymentAt > customer.oldestDebtAt ? customer.lastPaymentAt : customer.oldestDebtAt) : 0;
  const usage = customer.creditLimitCents ? customer.balanceCents / customer.creditLimitCents : 0;

  const remind = () => {
    const text = debtReminderMessage({
      customerName: customer.name,
      balanceCents: customer.balanceCents,
      businessName: settings?.nombreComercial || settings?.razonSocial || 'tu bodega',
      days,
    });
    const link = customer.phone ? whatsappLink(customer.phone, text) : null;
    if (!link) return setMessage('Este cliente no tiene celular guardado.');
    void Linking.openURL(link);
  };

  const saveLimit = async () => {
    const cents = parseSoles(limit);
    if (cents === null) return setMessage('Monto inválido.');
    try {
      await api.patch(`/customers/${id}`, { creditLimitCents: cents });
      await syncNow();
      setCustomer(await db.getCustomer(id));
      setMessage('Límite actualizado.');
    } catch (err) {
      setMessage(errorMessage(err));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: customer.name }} />
      <View style={[styles.debtBox, { backgroundColor: customer.balanceCents > 0 ? colors.dangerSoft : colors.primarySoft }]}>
        <Text style={styles.debtLabel}>{customer.balanceCents > 0 ? 'Debe' : 'Sin deuda'}</Text>
        <Text style={[styles.debt, { color: customer.balanceCents > 0 ? colors.danger : colors.primaryDark }]}>{formatSoles(customer.balanceCents)}</Text>
        <Text style={styles.meta}>
          Límite {formatSoles(customer.creditLimitCents)} · usado {Math.round(usage * 100)}%
          {days > 0 ? ` · ${days} días sin pagar` : ''}
        </Text>
        {customer.phone ? <Text style={styles.meta}>Cel. {customer.phone}</Text> : null}
      </View>

      <View style={{ gap: spacing.sm }}>
        {customer.balanceCents > 0 && can('credit.abono') && (
          <Button label="Registrar abono" icon="cash" big onPress={() => router.push({ pathname: '/abono', params: { customerId: customer.id } })} />
        )}
        {customer.balanceCents > 0 && <Button label="Recordar por WhatsApp" icon="logo-whatsapp" variant="secondary" onPress={remind} />}
      </View>
      {message && <Banner text={message} />}

      {can('customers.editCreditLimit') && (
        <View style={[shared.card, { marginTop: spacing.lg }]}>
          <Field label="Límite de crédito (S/)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
          <Button label="Guardar límite" variant="ghost" icon="save" onPress={saveLimit} disabled={!online} />
        </View>
      )}

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Historial</Text>
      {!online && <Banner tone="warning" text="Conéctate a internet para ver el historial completo." />}
      {ledger?.map((m) => (
        <View key={m.id} style={styles.movement}>
          <View style={{ flex: 1 }}>
            <Text style={styles.movementTitle}>
              {m.kind === 'FIADO' ? 'Fiado' : m.method ? `Abono (${PAYMENT_METHOD_LABELS[m.method]})` : 'Anulación'}
            </Text>
            <Text style={styles.meta}>
              {formatLimaDate(m.createdAt)} · {m.userName}
              {m.note ? ` · ${m.note}` : ''}
            </Text>
          </View>
          <Text style={[styles.amount, { color: m.kind === 'FIADO' ? colors.danger : colors.primaryDark }]}>
            {m.kind === 'FIADO' ? '+' : '−'}
            {formatSoles(m.amountCents)}
          </Text>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  debtBox: { borderRadius: 18, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  debtLabel: { fontSize: font.body, fontWeight: '800', color: colors.text },
  debt: { fontSize: 44, fontWeight: '900' },
  meta: { fontSize: font.small, color: colors.textMuted, textAlign: 'center' },
  movement: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  movementTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  amount: { fontSize: font.large, fontWeight: '900' },
});
