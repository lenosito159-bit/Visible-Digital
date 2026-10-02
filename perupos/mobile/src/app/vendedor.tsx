import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatSoles } from '@perupos/shared';
import { Button, Screen, Tile } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSyncState } from '@/lib/sync';
import { colors, font, spacing } from '@/theme';

/** Inicio del vendedor: cuatro botones grandes y nada más. */
export default function VendedorHome() {
  const { user, logout } = useAuth();
  const { online } = useSyncState();
  const [today, setToday] = useState<{ salesCents: number; salesCount: number } | null>(null);
  const [alerts, setAlerts] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!online) return;
      api.get<{ salesCents: number; salesCount: number }>('/reports/summary').then(setToday).catch(() => {});
      api.get<{ read: boolean }[]>('/alerts').then((a) => setAlerts(a.filter((x) => !x.read).length)).catch(() => {});
    }, [online]),
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: `Hola, ${user?.name.split(' ')[0] ?? ''}` }} />
      {today && (
        <View style={styles.today}>
          <Text style={styles.todayLabel}>Vendiste hoy</Text>
          <Text style={styles.todayValue}>{formatSoles(today.salesCents)}</Text>
          <Text style={styles.todayLabel}>{today.salesCount} ventas</Text>
        </View>
      )}
      <View style={styles.grid}>
        <Tile label="Nueva Venta" icon="cart" onPress={() => router.push('/pos')} color={colors.primaryDark} />
        <Tile label="Fiado" icon="book" subtitle="Clientes y deudas" onPress={() => router.push('/customers')} color={colors.secondary} />
        <Tile label="Abono" icon="cash" subtitle="Cobrar una deuda" onPress={() => router.push('/abono')} color="#7C3AED" />
        <Tile label="Mis Ventas" icon="receipt" onPress={() => router.push('/my-sales')} color="#0E7490" />
      </View>
      <View style={[styles.grid, { marginTop: spacing.md }]}>
        <Tile label="Caja" icon="wallet" onPress={() => router.push('/cash')} color="#374151" />
        <Tile label="Alertas" icon="notifications" badge={alerts} onPress={() => router.push('/alerts')} color="#92400E" />
      </View>
      <Button
        label="Salir"
        variant="ghost"
        icon="log-out"
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
        style={{ marginTop: spacing.xl }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  today: { backgroundColor: colors.primarySoft, borderRadius: 16, padding: spacing.lg, marginBottom: spacing.lg, alignItems: 'center' },
  todayLabel: { fontSize: font.body, color: colors.primaryDark, fontWeight: '700' },
  todayValue: { fontSize: font.huge, fontWeight: '900', color: colors.primaryDark },
});
