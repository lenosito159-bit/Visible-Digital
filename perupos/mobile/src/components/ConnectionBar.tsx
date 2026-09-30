import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';
import { syncNow, useSyncState } from '@/lib/sync';
import { colors, font } from '@/theme';

/**
 * Indicador siempre visible de conexión: el vendedor sabe si está sin
 * internet y cuántas operaciones faltan enviar. Tocarlo fuerza el envío.
 */
export function ConnectionBar() {
  const s = useSyncState();
  const pendingText = s.pending > 0 ? ` · ${s.pending} por enviar` : '';
  const failedText = s.failed > 0 ? ` · ${s.failed} con problema` : '';
  const offline = !s.online;
  const label = offline
    ? `Sin internet — la app sigue funcionando${pendingText}`
    : s.syncing
      ? 'Sincronizando…'
      : `En línea${pendingText}${failedText}`;
  const bg = offline ? colors.accent : s.failed > 0 ? colors.dangerSoft : colors.primarySoft;
  const fg = offline ? colors.text : s.failed > 0 ? colors.danger : colors.primaryDark;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => void syncNow()}
      style={[styles.bar, { backgroundColor: bg }]}
    >
      <Ionicons name={offline ? 'cloud-offline' : s.syncing ? 'sync' : 'cloud-done'} size={18} color={fg} />
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, minHeight: 36 },
  text: { fontSize: font.small, fontWeight: '800', flex: 1 },
});
