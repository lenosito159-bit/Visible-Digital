import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import {
  buildAbonoReceiptText,
  formatSoles,
  parseSoles,
  whatsappLink,
  whatsappShareLink,
  type AbonoInput,
  type AbonoReceipt,
  type Customer,
} from '@perupos/shared';
import { CustomerPicker } from '@/components/CustomerPicker';
import { QrPaymentModal } from '@/components/QrPaymentModal';
import { Banner, Button, Chip, Field, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { registerAbono } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

type AbonoMethod = 'CASH' | 'YAPE' | 'PLIN';

/** Abono: cliente → deuda → monto → cómo paga → constancia con saldo. */
export default function Abono() {
  const params = useLocalSearchParams<{ customerId?: string }>();
  const { user, settings } = useAuth();
  const [abonoId] = useState(() => Crypto.randomUUID());
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [picking, setPicking] = useState(!params.customerId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<AbonoMethod>('CASH');
  const [showQr, setShowQr] = useState(false);
  const [receipt, setReceipt] = useState<AbonoReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (params.customerId) void db.getCustomer(params.customerId).then(setCustomer);
  }, [params.customerId]);

  const amountCents = parseSoles(amount) ?? 0;

  const save = async (confirmation?: 'QR' | 'MANUAL', chargeId?: string) => {
    if (!customer || !user) return;
    setSaving(true);
    setError(null);
    try {
      const optimistic: AbonoReceipt = {
        id: abonoId,
        customerId: customer.id,
        customerName: customer.name,
        amountCents,
        method,
        previousBalanceCents: customer.balanceCents,
        balanceCents: customer.balanceCents - amountCents,
        userName: user.name,
        createdAt: new Date().toISOString(),
      };
      const payload: AbonoInput = {
        id: abonoId,
        customerId: customer.id,
        amountCents,
        method,
        confirmation,
        chargeId,
        createdAt: optimistic.createdAt,
      };
      const result = await registerAbono(payload, optimistic);
      setReceipt(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const submit = () => {
    if (!customer) return setPicking(true);
    if (amountCents <= 0) return setError('Escribe cuánto abona.');
    if (amountCents > customer.balanceCents) return setError(`El abono no puede ser mayor que la deuda (${formatSoles(customer.balanceCents)}).`);
    if (method === 'CASH') return void save();
    setShowQr(true);
  };

  if (receipt && settings) {
    const text = buildAbonoReceiptText(receipt, settings);
    const share = () => {
      const link = (customer?.phone && whatsappLink(customer.phone, text)) || whatsappShareLink(text);
      void Linking.openURL(link);
    };
    return (
      <Screen>
        <View style={[styles.box, { backgroundColor: colors.primarySoft }]}>
          <Text style={styles.boxLabel}>Abono registrado</Text>
          <Text style={[styles.big, { color: colors.primaryDark }]}>{formatSoles(receipt.amountCents)}</Text>
          <Text style={styles.boxLabel}>Saldo pendiente: {formatSoles(receipt.balanceCents)}</Text>
        </View>
        <View style={styles.paper}>
          <Text style={styles.mono}>{text}</Text>
        </View>
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          <Button label="Enviar constancia por WhatsApp" icon="logo-whatsapp" onPress={share} />
          <Button label="Listo" variant="ghost" icon="checkmark" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label={amountCents ? `Registrar abono de ${formatSoles(amountCents)}` : 'Registrar abono'} icon="checkmark-circle" big onPress={submit} loading={saving} />}>
      <Button label={customer ? customer.name : 'Elegir cliente'} icon="person" variant={customer ? 'ghost' : 'accent'} onPress={() => setPicking(true)} />
      {customer && (
        <View style={[styles.box, { backgroundColor: colors.dangerSoft, marginTop: spacing.md }]}>
          <Text style={styles.boxLabel}>Deuda total</Text>
          <Text style={[styles.big, { color: colors.danger }]}>{formatSoles(customer.balanceCents)}</Text>
        </View>
      )}
      <Field label="¿Cuánto abona? (S/)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      {customer && customer.balanceCents > 0 && (
        <Button label={`Paga todo (${formatSoles(customer.balanceCents)})`} variant="ghost" onPress={() => setAmount((customer.balanceCents / 100).toFixed(2))} />
      )}
      <Text style={[shared.label, { marginTop: spacing.lg }]}>¿Cómo paga?</Text>
      <View style={styles.methods}>
        <Chip label="Efectivo" icon="cash" selected={method === 'CASH'} onPress={() => setMethod('CASH')} color={colors.primaryDark} />
        <Chip label="Yape" icon="phone-portrait" selected={method === 'YAPE'} onPress={() => setMethod('YAPE')} color={colors.yape} />
        <Chip label="Plin" icon="phone-portrait" selected={method === 'PLIN'} onPress={() => setMethod('PLIN')} color="#007C88" />
      </View>
      {amountCents > 0 && customer && amountCents <= customer.balanceCents && (
        <Banner tone="info" text={`Después del abono debe ${formatSoles(customer.balanceCents - amountCents)}.`} />
      )}
      {error && <Banner tone="danger" text={error} />}

      <CustomerPicker
        visible={picking}
        onlyWithDebt
        onClose={() => {
          setPicking(false);
          if (!customer) router.back();
        }}
        onSelect={(c) => {
          setCustomer(c);
          setPicking(false);
        }}
      />
      {showQr && (
        <QrPaymentModal
          visible
          amountCents={amountCents}
          reference={abonoId}
          onPaid={(chargeId) => {
            setShowQr(false);
            void save('QR', chargeId);
          }}
          onManual={() => {
            setShowQr(false);
            void save('MANUAL');
          }}
          onCancel={() => setShowQr(false)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 18, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  boxLabel: { fontSize: font.body, fontWeight: '800', color: colors.text },
  big: { fontSize: 44, fontWeight: '900' },
  methods: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', marginBottom: spacing.md },
  paper: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, color: '#000' },
});
