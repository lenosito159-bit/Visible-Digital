import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatLimaDate, formatSoles, parseSoles } from '@perupos/shared';
import { Banner, Button, Chip, Field, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

interface CashStatus {
  openedAt: string;
  openedBy: string;
  openingCents: number;
  cashSalesCents: number;
  cashAbonosCents: number;
  inCents: number;
  outCents: number;
  expectedCents: number;
  closedAt: string | null;
  countedCents: number | null;
  differenceCents: number | null;
  movements: { id: string; kind: 'IN' | 'OUT'; amountCents: number; reason: string; createdAt: string }[];
}

/** Apertura, retiros y cuadre de caja: para saber si falta o sobra plata. */
export default function Cash() {
  const { can, settings } = useAuth();
  const { online } = useSyncState();
  const [cash, setCash] = useState<CashStatus | null | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [counted, setCounted] = useState('');
  const [kind, setKind] = useState<'OUT' | 'IN'>('OUT');
  const [closed, setClosed] = useState<CashStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!online) return setCash(undefined);
    api.get<CashStatus | null>('/cash/current').then(setCash).catch((e) => setError(errorMessage(e)));
  }, [online]);
  useFocusEffect(load);

  const run = async (fn: () => Promise<CashStatus>) => {
    setError(null);
    try {
      const next = await fn();
      setAmount('');
      setReason('');
      return next;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    }
  };

  if (!online) return <Screen><Banner tone="warning" text="La caja necesita internet para cuadrarse con las ventas de todos los teléfonos." /></Screen>;
  if (cash === undefined) return <Loading />;

  if (closed) {
    const diff = closed.differenceCents ?? 0;
    return (
      <Screen>
        <View style={[styles.box, { backgroundColor: diff === 0 ? colors.primarySoft : colors.accentSoft }]}>
          <Text style={styles.label}>Caja cerrada</Text>
          <Text style={styles.big}>{diff === 0 ? 'Cuadra exacto' : diff > 0 ? `Sobran ${formatSoles(diff)}` : `Faltan ${formatSoles(-diff)}`}</Text>
          <Text style={styles.label}>Debía haber {formatSoles(closed.expectedCents)} · contaste {formatSoles(closed.countedCents ?? 0)}</Text>
        </View>
        <Button label="Listo" onPress={() => { setClosed(null); load(); }} />
      </Screen>
    );
  }

  if (!cash) {
    return (
      <Screen>
        <Banner text="Abre la caja al empezar el día con el sencillo que tienes para dar vuelto." />
        <Field label="¿Con cuánto abres? (S/)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="100.00" />
        {error && <Banner tone="danger" text={error} />}
        <Button
          label="Abrir caja"
          icon="lock-open"
          big
          disabled={!can('cash.operate')}
          onPress={async () => setCash(await run(() => api.post('/cash/open', { openingCents: parseSoles(amount) ?? 0 })))}
        />
      </Screen>
    );
  }

  const low = settings && cash.expectedCents < settings.cashLowThresholdCents;
  return (
    <Screen>
      <View style={[styles.box, { backgroundColor: low ? colors.accentSoft : colors.primarySoft }]}>
        <Text style={styles.label}>Debe haber en caja</Text>
        <Text style={styles.big}>{formatSoles(cash.expectedCents)}</Text>
        <Text style={styles.small}>Abierta por {cash.openedBy} · {formatLimaDate(cash.openedAt)}</Text>
      </View>
      {low && <Banner tone="warning" text="Queda poco sencillo. Cambia billetes para poder dar vuelto." />}
      <View style={shared.card}>
        {[
          ['Apertura', cash.openingCents],
          ['Ventas en efectivo', cash.cashSalesCents],
          ['Abonos en efectivo', cash.cashAbonosCents],
          ['Ingresos', cash.inCents],
          ['Retiros y pagos', -cash.outCents],
        ].map(([label, value]) => (
          <View key={label as string} style={styles.line}>
            <Text style={styles.lineLabel}>{label}</Text>
            <Text style={styles.lineValue}>{formatSoles(value as number)}</Text>
          </View>
        ))}
      </View>

      {can('cash.operate') && (
        <>
          <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Sacar o meter plata</Text>
          <View style={styles.row}>
            <Chip label="Saco plata" icon="arrow-up" selected={kind === 'OUT'} onPress={() => setKind('OUT')} color={colors.danger} />
            <Chip label="Meto plata" icon="arrow-down" selected={kind === 'IN'} onPress={() => setKind('IN')} />
          </View>
          <Field label="Monto (S/)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="Motivo" value={reason} onChangeText={setReason} placeholder="Ej. pago al proveedor de gaseosas" />
          <Button
            label="Anotar"
            variant="secondary"
            icon="create"
            onPress={async () => {
              const next = await run(() => api.post('/cash/movements', { kind, amountCents: parseSoles(amount) ?? 0, reason }));
              if (next) setCash(next);
            }}
          />
          <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Cerrar caja</Text>
          <Field label="¿Cuánto contaste? (S/)" value={counted} onChangeText={setCounted} keyboardType="decimal-pad" />
          <Button
            label="Cerrar y cuadrar"
            variant="accent"
            icon="lock-closed"
            big
            onPress={async () => {
              const result = await run(() => api.post('/cash/close', { countedCents: parseSoles(counted) ?? 0 }));
              if (result) setClosed(result);
            }}
          />
        </>
      )}
      {error && <Banner tone="danger" text={error} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 18, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  label: { fontSize: font.body, fontWeight: '800', color: colors.text, textAlign: 'center' },
  big: { fontSize: 40, fontWeight: '900', color: colors.text },
  small: { fontSize: font.small, color: colors.textMuted },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  lineLabel: { fontSize: font.body, color: colors.textMuted },
  lineValue: { fontSize: font.body, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
});
