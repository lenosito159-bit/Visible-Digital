import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Screen, StatCard, Tile } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSyncState } from '@/lib/sync';
import { colors, shared, spacing } from '@/theme';

interface Summary {
  salesCents: number;
  salesCount: number;
  cashCents: number;
  digitalCents: number;
  fiadoCents: number;
  abonosCents: number;
  averageTicketCents: number;
  cashInDrawerCents: number | null;
}

/** Panel del dueño: cómo va el día y acceso a todo. */
export default function AdminHome() {
  const { user, settings, logout } = useAuth();
  const { online } = useSyncState();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [alerts, setAlerts] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!online) return;
      api.get<Summary>('/reports/summary').then(setSummary).catch(() => {});
      api.get<{ read: boolean }[]>('/alerts').then((a) => setAlerts(a.filter((x) => !x.read).length)).catch(() => {});
    }, [online]),
  );

  return (
    <Screen>
      <Text style={[shared.sectionTitle, { fontSize: 22 }]}>{settings?.nombreComercial || settings?.razonSocial || 'Mi negocio'}</Text>
      {!online && <Banner tone="warning" text="Sin internet: los reportes se actualizan al reconectar. Puedes seguir vendiendo." />}
      {summary && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
          <StatCard label="Ventas de hoy" cents={summary.salesCents} tone={colors.primaryDark} icon="trending-up" />
          <StatCard label="N° de ventas" value={`${summary.salesCount}`} icon="receipt" />
          <StatCard label="Efectivo" cents={summary.cashCents} icon="cash" />
          <StatCard label="Yape/Plin/otros" cents={summary.digitalCents} icon="phone-portrait" tone={colors.yape} />
          <StatCard label="Fiados nuevos" cents={summary.fiadoCents} icon="book" tone={colors.danger} />
          <StatCard label="Abonos recibidos" cents={summary.abonosCents} icon="checkmark-circle" tone={colors.primaryDark} />
          {summary.cashInDrawerCents !== null && <StatCard label="En caja ahora" cents={summary.cashInDrawerCents} icon="wallet" />}
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md }}>
        <Tile label="Vender" icon="cart" onPress={() => router.push('/pos')} />
        <Tile label="Alertas" icon="notifications" badge={alerts} onPress={() => router.push('/alerts')} color="#92400E" />
        <Tile label="Productos" icon="cube" onPress={() => router.push('/admin/products')} color={colors.secondary} />
        <Tile label="Clientes y fiados" icon="book" onPress={() => router.push('/customers')} color="#7C3AED" />
        <Tile label="Reportes" icon="stats-chart" onPress={() => router.push('/admin/reports')} color="#0E7490" />
        <Tile label="Caja" icon="wallet" onPress={() => router.push('/cash')} color="#374151" />
        <Tile label="Ventas" icon="receipt" onPress={() => router.push('/my-sales')} color="#1F2937" />
        <Tile label="Usuarios" icon="people" onPress={() => router.push('/admin/users')} color="#4338CA" />
        <Tile label="Mi negocio" icon="settings" subtitle="RUC, Yape/Plin, cuentas" onPress={() => router.push('/admin/settings')} color="#475569" />
        <Tile label="Tablero financiero" icon="analytics" onPress={() => router.push('/agente')} color="#6D28D9" />
      </View>
      <Button
        label={`Salir (${user?.name ?? ''})`}
        variant="ghost"
        icon="log-out"
        style={{ marginTop: spacing.xl }}
        onPress={async () => {
          await logout();
          router.replace('/login');
        }}
      />
    </Screen>
  );
}
