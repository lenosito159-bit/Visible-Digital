import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Alert, LocalAlert } from '@perupos/shared';
import { Empty, Screen, type IconName } from '@/components/ui';
import { store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

const ALERT_ICONS: Record<Alert['type'], IconName> = {
  STOCK_BAJO: 'cube',
  LIMITE_CREDITO: 'card',
  CAJA_BAJA: 'wallet',
  DEUDA_VENCIDA: 'alarm',
  SIN_MOVIMIENTO: 'hourglass',
};

const SEVERITY = {
  CRITICAL: { bg: colors.dangerSoft, fg: colors.danger },
  WARNING: { bg: colors.accentSoft, fg: '#92400E' },
  INFO: { bg: colors.secondarySoft, fg: colors.secondary },
};

/** Avisos calculados en el celular. Desaparecen solos cuando se resuelven. */
export default function Alerts() {
  const [alerts, setAlerts] = useState<LocalAlert[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      void store.alerts().then(setAlerts);
    }, []),
  );
  const open = (a: LocalAlert) => {
    if ((a.type === 'DEUDA_VENCIDA' || a.type === 'LIMITE_CREDITO') && a.entityId) router.push(`/customers/${a.entityId}`);
    else if ((a.type === 'STOCK_BAJO' || a.type === 'SIN_MOVIMIENTO') && a.entityId) router.push(`/admin/product/${a.entityId}`);
    else if (a.type === 'CAJA_BAJA') router.push('/cash');
  };
  return (
    <Screen>
      <Text style={styles.meta}>Se revisan en este celular. Desaparecen solos cuando se resuelven (llegó mercadería, el cliente abonó…).</Text>
      {alerts?.map((a) => {
        const s = SEVERITY[a.severity];
        return (
          <Pressable key={a.key} onPress={() => open(a)} style={[styles.card, { backgroundColor: s.bg, borderLeftColor: s.fg, marginTop: spacing.sm }]}>
            <View style={styles.row}>
              <Ionicons name={ALERT_ICONS[a.type]} size={26} color={s.fg} />
              <Text style={[styles.title, { color: s.fg, flex: 1 }]}>{a.title}</Text>
            </View>
            <Text style={styles.body}>{a.message}</Text>
          </Pressable>
        );
      })}
      {alerts?.length === 0 && <Empty icon="checkmark-done-circle" text="Todo en orden. No hay avisos." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...shared.card, borderLeftWidth: 6, marginBottom: spacing.sm, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: font.body, fontWeight: '900', color: colors.text },
  body: { fontSize: font.body, color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
});
