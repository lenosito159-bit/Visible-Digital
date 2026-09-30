import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import {
  PAYMENT_METHOD_LABELS,
  buildCashCloseText,
  formatLimaDate,
  formatSoles,
  parseSoles,
  whatsappShareLink,
  type CashSummary,
  type PaymentMethod,
} from '@perupos/shared';
import { Banner, Button, Chip, Field, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

const METHODS: PaymentMethod[] = ['CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD', 'FIADO'];

function Line({ label, cents, strong, negative }: { label: string; cents: number; strong?: boolean; negative?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.lineValue, strong && styles.strong]}>
        {negative ? '−' : ''}
        {formatSoles(cents)}
      </Text>
    </View>
  );
}

/** Caja del día: apertura, sacar/meter plata y cierre con arqueo y desglose por método. */
export default function Cash() {
  const { can, settings } = useAuth();
  const { online } = useSyncState();
  const [cash, setCash] = useState<CashSummary | null | undefined>(undefined);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'OUT' | 'IN'>('OUT');
  const [counted, setCounted] = useState('');
  const [transferred, setTransferred] = useState('');
  const [closed, setClosed] = useState<CashSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!online) return setCash(undefined);
    api.get<CashSummary | null>('/cash/current').then(setCash).catch((e) => setError(errorMessage(e)));
  }, [online]);
  useFocusEffect(load);

  const run = async (fn: () => Promise<CashSummary>) => {
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

  const share = (summary: CashSummary) => {
    if (!settings) return;
    void Linking.openURL(whatsappShareLink(buildCashCloseText(summary, settings)));
  };

  if (!online) {
    return (
      <Screen>
        <Banner tone="warning" text="No hay señal. La caja se cuadra con las ventas de todos los celulares, así que necesita internet." />
      </Screen>
    );
  }
  if (cash === undefined) return <Loading />;

  if (closed) {
    const diff = closed.differenceCents ?? 0;
    return (
      <Screen>
        <View style={[styles.box, { backgroundColor: diff === 0 ? colors.primarySoft : colors.accentSoft }]}>
          <Text style={styles.label}>Caja cerrada</Text>
          <Text style={styles.big}>{diff === 0 ? 'Cuadra exacto' : diff > 0 ? `Sobran ${formatSoles(diff)}` : `Faltan ${formatSoles(-diff)}`}</Text>
          <Text style={styles.label}>
            Debía haber {formatSoles(closed.expectedCents)} · contaste {formatSoles(closed.countedCents ?? 0)}
            {closed.transferredCents ? ` · yapeaste ${formatSoles(closed.transferredCents)}` : ''}
          </Text>
        </View>
        <Button label="Mandar resumen por WhatsApp" icon="logo-whatsapp" onPress={() => share(closed)} />
        <Button label="Listo" variant="ghost" onPress={() => { setClosed(null); load(); }} style={{ marginTop: spacing.sm }} />
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
  const countedCents = parseSoles(counted);
  const transferredCents = parseSoles(transferred) ?? 0;
  const preview = countedCents === null ? null : countedCents + transferredCents - cash.expectedCents;

  return (
    <Screen>
      <View style={[styles.box, { backgroundColor: low ? colors.accentSoft : colors.primarySoft }]}>
        <Text style={styles.label}>Debe haber en el cajón</Text>
        <Text style={styles.big}>{formatSoles(cash.expectedCents)}</Text>
        <Text style={styles.small}>Abrió {cash.openedBy} · {formatLimaDate(cash.openedAt)}</Text>
      </View>
      {low && <Banner tone="warning" text="Te queda poco sencillo. Cambia billetes para poder dar vuelto." />}

      <Text style={shared.sectionTitle}>Ventas del turno ({cash.salesCount})</Text>
      <View style={shared.card}>
        {METHODS.filter((m) => cash.byMethod[m]).map((m) => (
          <Line key={m} label={m === 'FIADO' ? 'Fiado (apuntado)' : PAYMENT_METHOD_LABELS[m]} cents={cash.byMethod[m]!} />
        ))}
        {METHODS.some((m) => cash.abonosByMethod[m]) && <Text style={[shared.label, { marginTop: spacing.sm }]}>Abonos cobrados</Text>}
        {METHODS.filter((m) => cash.abonosByMethod[m]).map((m) => (
          <Line key={`a-${m}`} label={PAYMENT_METHOD_LABELS[m]} cents={cash.abonosByMethod[m]!} />
        ))}
        {cash.salesCount === 0 && <Text style={styles.small}>Todavía no hay ventas en este turno.</Text>}
      </View>

      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Efectivo en el cajón</Text>
      <View style={shared.card}>
        <Line label="Apertura" cents={cash.openingCents} />
        <Line label="Ventas en efectivo" cents={cash.cashSalesCents} />
        {cash.digitalChangeCents > 0 && <Line label="Vuelto de yapeos de más" cents={cash.digitalChangeCents} negative />}
        {cash.cashAbonosCents > 0 && <Line label="Abonos en efectivo" cents={cash.cashAbonosCents} />}
        {cash.inCents > 0 && <Line label="Metiste" cents={cash.inCents} />}
        {cash.outCents > 0 && <Line label="Sacaste (pagos, retiros)" cents={cash.outCents} negative />}
        <Line label="Debe haber" cents={cash.expectedCents} strong />
      </View>

      {can('cash.operate') && (
        <>
          <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Sacar o meter plata</Text>
          <View style={styles.row}>
            <Chip label="Saco plata" icon="arrow-up" selected={kind === 'OUT'} onPress={() => setKind('OUT')} color={colors.danger} />
            <Chip label="Meto plata" icon="arrow-down" selected={kind === 'IN'} onPress={() => setKind('IN')} />
          </View>
          <Field label="Monto (S/)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          <Field label="¿Para qué?" value={reason} onChangeText={setReason} placeholder="Ej. le pagué al de las gaseosas" />
          <Button
            label="Anotar"
            variant="secondary"
            icon="create"
            onPress={async () => {
              const next = await run(() => api.post('/cash/movements', { kind, amountCents: parseSoles(amount) ?? 0, reason }));
              if (next) setCash(next);
            }}
          />

          <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Cierre del día</Text>
          <Field label="¿Cuánto contaste en el cajón? (S/)" value={counted} onChangeText={setCounted} keyboardType="decimal-pad" />
          <Field
            label="¿Le yapeaste algo al administrador para cuadrar? (S/)"
            value={transferred}
            onChangeText={setTransferred}
            keyboardType="decimal-pad"
            placeholder="0.00"
          />
          {preview !== null && (
            <Banner
              tone={preview === 0 ? 'success' : 'warning'}
              text={preview === 0 ? 'Cuadra exacto.' : preview > 0 ? `Sobran ${formatSoles(preview)}.` : `Faltan ${formatSoles(-preview)}.`}
            />
          )}
          <Button
            label="Cerrar caja"
            variant="accent"
            icon="lock-closed"
            big
            disabled={countedCents === null}
            onPress={async () => {
              const result = await run(() => api.post('/cash/close', { countedCents: countedCents ?? 0, transferredCents }));
              if (result) {
                setCounted('');
                setTransferred('');
                setClosed(result);
              }
            }}
          />
          <Button label="Mandar cómo va la caja por WhatsApp" variant="ghost" icon="logo-whatsapp" onPress={() => share(cash)} style={{ marginTop: spacing.sm }} />
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
  strong: { color: colors.text, fontWeight: '900', fontSize: font.large },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
});
