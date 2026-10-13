import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Screen, StatCard, Tile } from '@/components/ui';
import type { DaySummary } from '@perupos/shared';
import { useAuth } from '@/lib/auth';
import { backupReminderText } from '@/lib/backup';
import { store } from '@/lib/store';
import { colors, shared, spacing } from '@/theme';

/** Panel del dueño: cómo va el día y acceso a todo. */
export default function AdminHome() {
  const { user, settings, business, logout, endDemo } = useAuth();
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [alerts, setAlerts] = useState(0);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) void store.daySummary(user).then(setSummary);
      void store.alerts().then((a) => setAlerts(a.length));
      void backupReminderText().then(setBackupNote);
    }, [user]),
  );

  return (
    <Screen>
      <Text style={[shared.sectionTitle, { fontSize: 22 }]}>{settings?.nombreComercial || settings?.razonSocial || 'Mi negocio'}</Text>
      {backupNote && (
        <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
          <Banner tone="warning" icon="cloud-upload" text={backupNote} />
          <Button label="Hacer copia ahora" icon="cloud-upload" variant="accent" onPress={() => router.push('/admin/settings')} />
        </View>
      )}
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
        <Tile label="Avisos" icon="notifications" badge={alerts} onPress={() => router.push('/alerts')} color="#92400E" />
        <Tile label="Productos" icon="cube" onPress={() => router.push('/admin/products')} color={colors.secondary} />
        <Tile label="Clientes y fiados" icon="book" onPress={() => router.push('/customers')} color="#7C3AED" />
        <Tile label="Informes" icon="stats-chart" onPress={() => router.push('/admin/reports')} color="#0E7490" />
        <Tile label="Caja" icon="wallet" onPress={() => router.push('/cash')} color="#374151" />
        <Tile label="Ventas" icon="receipt" onPress={() => router.push('/my-sales')} color="#1F2937" />
        <Tile label="Ayudantes" icon="people" onPress={() => router.push('/admin/users')} color="#4338CA" />
        <Tile label="Mi negocio" icon="settings" subtitle="Nombre, PIN, copia de seguridad" onPress={() => router.push('/admin/settings')} color="#475569" />
        <Tile label="Fiados por cobrar" icon="alarm" onPress={() => router.push('/debts')} color="#92400E" />
      </View>
      {business?.isDemo && (
        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          <Banner tone="warning" text="Estás en la demostración. Cuando quieras empezar con tu negocio, borra la demostración: se borran todos los datos de ejemplo." />
          <Button
            label="Borrar demostración y empezar mi negocio"
            icon="trash"
            variant="danger"
            onPress={async () => {
              await endDemo();
              router.replace('/');
            }}
          />
        </View>
      )}
      <Button
        label={`Salir (${user?.name ?? ''})`}
        variant="ghost"
        icon="log-out"
        style={{ marginTop: spacing.xl }}
        onPress={async () => {
          await logout();
          router.replace('/');
        }}
      />
    </Screen>
  );
}
