import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import {
  PAYMENT_METHOD_LABELS,
  REMINDER_TEMPLATE_LABELS,
  REMINDER_TEMPLATES,
  daysBetween,
  debtReminderMessage,
  fechaPe,
  formatLimaDate,
  formatSoles,
  parseSoles,
  paydayInfo,
  whatsappLink,
  whatsappShareLink,
  type CreditMovement,
  type Customer,
  type CustomerReputation,
  type CustomerTreatment,
  type ReminderTemplate,
} from '@perupos/shared';
import { Banner, Button, Chip, Field, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { syncNow, useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

/** Ficha del cliente: lo que debe, hasta cuánto se le fía, su "cuaderno" y el recordatorio. */
export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, settings } = useAuth();
  const { online } = useSyncState();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<CreditMovement[] | null>(null);
  const [limit, setLimit] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const payday = paydayInfo();
  const [template, setTemplate] = useState<ReminderTemplate>(payday?.kind ?? 'AMABLE');

  const reload = useCallback(() => {
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
  }, [id, online]);
  useFocusEffect(reload);

  if (!customer) return <Loading />;
  const lastActivity = [customer.lastPaymentAt, customer.oldestDebtAt].filter(Boolean).sort().pop();
  const days = lastActivity ? daysBetween(lastActivity) : 0;
  const usage = customer.creditLimitCents ? customer.balanceCents / customer.creditLimitCents : 0;
  const reminder = debtReminderMessage({
    customerName: customer.name,
    trato: customer.trato,
    balanceCents: customer.balanceCents,
    businessName: settings?.nombreComercial || settings?.razonSocial || 'la tienda',
    since: customer.oldestDebtAt,
    template,
  });

  const remind = () => {
    const link = (customer.phone && whatsappLink(customer.phone, reminder)) || whatsappShareLink(reminder);
    void Linking.openURL(link);
  };

  const update = async (patch: { trato?: CustomerTreatment; reputation?: CustomerReputation; creditLimitCents?: number }) => {
    setMessage(null);
    try {
      await api.patch(`/customers/${id}`, patch);
      await syncNow();
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: customer.name }} />
      <View style={[styles.debtBox, { backgroundColor: customer.balanceCents > 0 ? colors.dangerSoft : colors.primarySoft }]}>
        <Text style={styles.debtLabel}>{customer.balanceCents > 0 ? 'Debe' : 'No debe nada'}</Text>
        <Text style={[styles.debt, { color: customer.balanceCents > 0 ? colors.danger : colors.primaryDark }]}>{formatSoles(customer.balanceCents)}</Text>
        <Text style={styles.meta}>
          Le fías hasta {formatSoles(customer.creditLimitCents)} · usado {Math.round(usage * 100)}%
          {customer.balanceCents > 0 && days > 0 ? ` · ${days} días sin abonar` : ''}
        </Text>
        {customer.oldestDebtAt && customer.balanceCents > 0 ? <Text style={styles.meta}>Debe desde el {fechaPe(customer.oldestDebtAt)}</Text> : null}
        {customer.phone ? <Text style={styles.meta}>Cel. {customer.phone}</Text> : null}
      </View>

      {customer.balanceCents > 0 && can('credit.abono') && (
        <Button label="Registrar abono" icon="cash" big onPress={() => router.push({ pathname: '/abono', params: { customerId: customer.id } })} />
      )}

      {customer.balanceCents > 0 && (
        <View style={[shared.card, { marginTop: spacing.lg, gap: spacing.sm }]}>
          <Text style={shared.sectionTitle}>Recordar por WhatsApp</Text>
          {payday && <Banner tone="success" icon="calendar" text={payday.label} />}
          <View style={styles.chips}>
            {REMINDER_TEMPLATES.map((t) => (
              <Chip key={t} label={REMINDER_TEMPLATE_LABELS[t]} selected={template === t} onPress={() => setTemplate(t)} />
            ))}
          </View>
          <Text style={styles.preview}>{reminder}</Text>
          <Button label={customer.phone ? 'Enviar por WhatsApp' : 'Elegir contacto en WhatsApp'} icon="logo-whatsapp" onPress={remind} />
        </View>
      )}

      <View style={[shared.card, { marginTop: spacing.lg, gap: spacing.sm }]}>
        <Text style={shared.label}>¿Cómo le dices?</Text>
        <View style={styles.chips}>
          <Chip label="Don" selected={customer.trato === 'DON'} onPress={() => update({ trato: 'DON' })} />
          <Chip label="Doña" selected={customer.trato === 'DONA'} onPress={() => update({ trato: 'DONA' })} />
          <Chip label="Solo el nombre" selected={!customer.trato} onPress={() => update({ trato: null })} />
        </View>
        <Text style={shared.label}>¿Cómo paga?</Text>
        <View style={styles.chips}>
          <Chip label="Siempre paga" icon="thumbs-up" color={colors.primaryDark} selected={customer.reputation === 'CUMPLIDO'} onPress={() => update({ reputation: customer.reputation === 'CUMPLIDO' ? null : 'CUMPLIDO' })} />
          <Chip label="Le cuesta pagar" icon="alert-circle" color={colors.danger} selected={customer.reputation === 'MOROSO'} onPress={() => update({ reputation: customer.reputation === 'MOROSO' ? null : 'MOROSO' })} />
        </View>
        {!online && <Text style={styles.meta}>Necesitas señal para cambiar estos datos.</Text>}
      </View>
      {message && <Banner tone="danger" text={message} />}

      {can('customers.editCreditLimit') && (
        <View style={[shared.card, { marginTop: spacing.lg }]}>
          <Field label="¿Hasta cuánto le fías? (S/)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
          <Button
            label="Guardar"
            variant="ghost"
            icon="save"
            disabled={!online}
            onPress={() => {
              const value = parseSoles(limit);
              if (value === null) return setMessage('Escribe un monto. Ej: 80');
              void update({ creditLimitCents: value });
            }}
          />
        </View>
      )}

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Cuaderno de {customer.name.split(' ')[0]}</Text>
      {!online && <Banner tone="warning" text="Con señal se ve el cuaderno completo." />}
      {ledger?.map((m) => (
        <View key={m.id} style={styles.movement}>
          <View style={{ flex: 1 }}>
            <Text style={styles.movementTitle}>
              {m.kind === 'FIADO' ? 'Fió' : m.method ? `Abonó (${PAYMENT_METHOD_LABELS[m.method]})` : 'Anulado'}
            </Text>
            <Text style={styles.movementMeta}>
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preview: { fontSize: font.body, color: colors.text, backgroundColor: '#DCF8C6', borderRadius: 12, padding: spacing.md },
  movement: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  movementTitle: { fontSize: font.body, fontWeight: '800', color: colors.text },
  movementMeta: { fontSize: font.small, color: colors.textMuted },
  amount: { fontSize: font.large, fontWeight: '900' },
});
