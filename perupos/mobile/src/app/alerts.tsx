import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatLimaDate, type Alert, type Notification } from '@perupos/shared';
import { Banner, Empty, Screen, type IconName } from '@/components/ui';
import { api } from '@/lib/api';
import { useSyncState } from '@/lib/sync';
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

/** Alertas automáticas y mensajes del Agente Financiero. */
export default function Alerts() {
  const { online } = useSyncState();
  const [alerts, setAlerts] = useState<(Alert & { read: boolean })[]>([]);
  const [messages, setMessages] = useState<Notification[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!online) return;
      api.get<(Alert & { read: boolean })[]>('/alerts').then(setAlerts).catch(() => {});
      api.get<Notification[]>('/notifications').then(setMessages).catch(() => {});
    }, [online]),
  );

  const open = (a: Alert) => {
    void api.post(`/alerts/${a.id}/read`).catch(() => {});
    if ((a.type === 'DEUDA_VENCIDA' || a.type === 'LIMITE_CREDITO') && a.entityId) router.push(`/customers/${a.entityId}`);
    if (a.type === 'CAJA_BAJA') router.push('/cash');
  };

  return (
    <Screen>
      {!online && <Banner tone="warning" text="Conéctate a internet para ver las alertas." />}
      {messages.length > 0 && (
        <>
          <Text style={shared.sectionTitle}>Mensajes del Agente Financiero</Text>
          {messages.slice(0, 10).map((m) => (
            <Pressable
              key={m.id}
              onPress={() => void api.post(`/notifications/${m.id}/read`).catch(() => {})}
              style={[styles.card, { borderLeftColor: '#7C3AED' }, !m.readAt && styles.unread]}
            >
              <Text style={styles.title}>{m.title}</Text>
              <Text style={styles.body}>{m.body}</Text>
              <Text style={styles.meta}>
                {m.fromName} · {formatLimaDate(m.createdAt)}
              </Text>
            </Pressable>
          ))}
        </>
      )}
      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Alertas</Text>
      {alerts.map((a) => {
        const s = SEVERITY[a.severity];
        return (
          <Pressable key={a.id} onPress={() => open(a)} style={[styles.card, { backgroundColor: s.bg, borderLeftColor: s.fg }]}>
            <View style={styles.row}>
              <Ionicons name={ALERT_ICONS[a.type]} size={26} color={s.fg} />
              <Text style={[styles.title, { color: s.fg, flex: 1 }]}>{a.title}</Text>
              {!a.read && <View style={styles.dot} />}
            </View>
            <Text style={styles.body}>{a.message}</Text>
          </Pressable>
        );
      })}
      {online && alerts.length === 0 && <Empty icon="checkmark-done-circle" text="Todo en orden. No hay alertas." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { ...shared.card, borderLeftWidth: 6, marginBottom: spacing.sm, gap: 4 },
  unread: { borderColor: '#7C3AED' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { fontSize: font.body, fontWeight: '900', color: colors.text },
  body: { fontSize: font.body, color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger },
});
