import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { formatSoles, type QrCharge } from '@perupos/shared';
import { api, errorMessage, OfflineError } from '@/lib/api';
import { useSyncState } from '@/lib/sync';
import { colors, font, spacing } from '@/theme';
import { Banner, Button } from './ui';

const POLL_MS = 2500;

/**
 * Cobro con QR interoperable (TAYPI): un solo QR que el cliente paga desde
 * Yape, Plin o su banco. Muestra el monto exacto y un temporizador de 2 minutos.
 */
export function QrPaymentModal({
  visible,
  amountCents,
  reference,
  onPaid,
  onManual,
  onCancel,
}: {
  visible: boolean;
  amountCents: number;
  reference: string;
  onPaid: (chargeId: string, wallet: string | null) => void;
  onManual: (reference?: string) => void;
  onCancel: () => void;
}) {
  const { online } = useSyncState();
  const [charge, setCharge] = useState<QrCharge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [manualOpen, setManualOpen] = useState(false);
  const [opRef, setOpRef] = useState('');
  const done = useRef(false);

  const create = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCharge(await api.post<QrCharge>('/payments/qr', { amountCents, reference }));
    } catch (err) {
      setError(err instanceof OfflineError ? 'No hay señal y no sale el QR.' : errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [amountCents, reference]);

  useEffect(() => {
    if (!visible) {
      setCharge(null);
      setError(null);
      setManualOpen(false);
      setOpRef('');
      done.current = false;
      return;
    }
    if (online) void create();
  }, [visible, online, create]);

  // Consulta el estado del pago y actualiza el temporizador.
  useEffect(() => {
    if (!visible || !charge || charge.status !== 'PENDING') return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const next = await api.get<QrCharge>(`/payments/qr/${charge.id}`);
        setCharge(next);
      } catch {
        // Un fallo de red puntual no corta el cobro; se reintenta.
      }
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [visible, charge]);

  useEffect(() => {
    if (charge?.status === 'PAID' && !done.current) {
      done.current = true;
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPaid(charge.id, charge.wallet);
    }
  }, [charge, onPaid]);

  const secondsLeft = charge ? Math.max(0, Math.floor((new Date(charge.expiresAt).getTime() - now) / 1000)) : 0;
  const expired = charge && (charge.status === 'EXPIRED' || charge.status === 'CANCELLED' || (charge.status === 'PENDING' && secondsLeft === 0));
  const isTest = charge?.qrPayload.startsWith('PERUPOS-PRUEBA');

  const cancel = () => {
    if (charge?.status === 'PENDING') api.post(`/payments/qr/${charge.id}/cancel`).catch(() => {});
    onCancel();
  };

  // Confirmación a mano: el vendedor mira la notificación en su celular.
  const manual = () => setManualOpen(true);
  const manualPanel = (
    <View style={styles.manual}>
      <Text style={styles.manualTitle}>¿Ya te llegó el {formatSoles(amountCents)}?</Text>
      <Text style={styles.hint}>Mira la notificación de tu Yape o Plin. Escribe el N° de operación para que nadie cobre dos veces con la misma captura.</Text>
      <TextInput
        value={opRef}
        onChangeText={setOpRef}
        placeholder="N° de operación (opcional)"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        style={styles.input}
        accessibilityLabel="Número de operación"
      />
      <Button label="Sí, ya me llegó" icon="checkmark-done" big onPress={() => onManual(opRef.trim() || undefined)} />
      <Button label="Todavía no" variant="ghost" onPress={() => setManualOpen(false)} />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cancel}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Yapea o plinea aquí</Text>
        <Text style={styles.amount}>{formatSoles(amountCents)}</Text>

        {manualOpen ? (
          manualPanel
        ) : !online ? (
          <>
            <Banner tone="warning" text="No hay señal y no sale el QR. Que te yapee a tu QR del mostrador y revisa que te llegue." />
            <Button label="Ya me llegó el Yape/Plin" icon="checkmark-done" variant="primary" big onPress={manual} />
          </>
        ) : loading && !charge ? (
          <ActivityIndicator size="large" color={colors.primaryDark} style={{ marginVertical: 60 }} />
        ) : error ? (
          <>
            <Banner tone="danger" text={error} />
            <Button label="Intentar de nuevo" icon="refresh" onPress={create} />
          </>
        ) : charge ? (
          <>
            <View style={[styles.qrBox, expired ? { opacity: 0.2 } : null]}>
              {charge.qrPayload ? (
                <QRCode value={charge.qrPayload} size={260} quietZone={12} />
              ) : charge.qrImageUrl ? (
                <Image source={{ uri: charge.qrImageUrl }} style={{ width: 260, height: 260 }} contentFit="contain" />
              ) : null}
            </View>
            <View style={styles.walletRow}>
              <Text style={[styles.wallet, { backgroundColor: colors.yape }]}>Yape</Text>
              <Text style={[styles.wallet, { backgroundColor: colors.plin, color: colors.text }]}>Plin</Text>
              <Text style={[styles.wallet, { backgroundColor: colors.secondary }]}>Bancos</Text>
            </View>
            {expired ? (
              <>
                <Banner tone="warning" text="Se acabó el tiempo del QR. Saca uno nuevo para que te pague." />
                <Button label="Generar nuevo QR" icon="qr-code" big onPress={create} loading={loading} />
              </>
            ) : (
              <>
                <Text style={styles.timer}>
                  {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                </Text>
                <Text style={styles.hint}>Esperando el pago… apenas llegue, se registra solo.</Text>
                {isTest && (
                  <Button
                    label="Simular pago (modo prueba)"
                    variant="accent"
                    icon="flask"
                    onPress={() => api.post<QrCharge>(`/payments/qr/${charge.id}/simulate`, { wallet: 'YAPE' }).then(setCharge).catch(() => {})}
                  />
                )}
              </>
            )}
          </>
        ) : null}

        <View style={{ height: spacing.lg }} />
        {online && !manualOpen && <Button label="Me yapeó a mi QR del mostrador" variant="ghost" icon="hand-left" onPress={manual} />}
        <Button label="Cancelar y cobrar de otra forma" variant="ghost" icon="close" onPress={cancel} style={{ marginTop: spacing.sm }} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, paddingTop: 60, alignItems: 'stretch', gap: spacing.md, backgroundColor: colors.background, flexGrow: 1 },
  title: { fontSize: font.title, fontWeight: '900', color: colors.secondary, textAlign: 'center' },
  amount: { fontSize: 48, fontWeight: '900', color: colors.text, textAlign: 'center' },
  qrBox: { alignSelf: 'center', padding: 12, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: colors.border },
  walletRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  wallet: { color: '#FFFFFF', fontWeight: '900', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, overflow: 'hidden', fontSize: font.body },
  timer: { fontSize: font.huge, fontWeight: '900', textAlign: 'center', color: colors.secondary, fontVariant: ['tabular-nums'] },
  hint: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  manual: { gap: spacing.md, backgroundColor: colors.surface, borderRadius: 16, padding: spacing.lg, borderWidth: 2, borderColor: colors.border },
  manualTitle: { fontSize: font.large, fontWeight: '900', color: colors.text, textAlign: 'center' },
  input: { minHeight: 56, borderWidth: 2, borderColor: colors.border, borderRadius: 12, paddingHorizontal: spacing.md, fontSize: font.large, color: colors.text, textAlign: 'center' },
});
