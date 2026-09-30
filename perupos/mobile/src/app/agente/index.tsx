import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatSoles, type Alert, type Recommendation } from '@perupos/shared';
import { BarChart, Heatmap } from '@/components/Charts';
import { Banner, Button, Chip, Loading, Screen, StatCard } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

interface Bucket {
  start: string;
  receivedCents: number;
  fiadoCents: number;
  outCents: number;
  netCents: number;
}
interface ProductStat {
  productId: string;
  name: string;
  unitsSold: number;
  revenueCents: number;
  stock: number;
  unit: string;
  daysSinceLastSale: number | null;
}
interface Dashboard {
  summary: {
    salesCents: number;
    salesCount: number;
    cashCents: number;
    digitalCents: number;
    fiadoCents: number;
    abonosCents: number;
    cashInDrawerCents: number | null;
  };
  projection: {
    weeklyAverageCents: number;
    projectedWeekCents: number;
    lastWeekCents: number;
    trend: number;
    nextDays: { date: string; dayName: string; projectedCents: number }[];
  };
  cashflow: { day: Bucket[]; week: Bucket[]; month: Bucket[] };
  topProducts: ProductStat[];
  slowProducts: ProductStat[];
  heatmap: { matrix: number[][] };
  recommendations: Recommendation[];
  alerts: Alert[];
}

const qty = (p: ProductStat) => (p.unit === 'KG' ? `${p.unitsSold.toFixed(1)} kg` : `${p.unitsSold} und`);

/** Tablero del Agente Financiero: caja, proyección, productos, horarios, alertas y consejos. */
export default function AgentDashboard() {
  const { logout, user } = useAuth();
  const { online } = useSyncState();
  const [data, setData] = useState<Dashboard | null>(null);
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<number>>(new Set());

  useFocusEffect(
    useCallback(() => {
      if (!online) return;
      api.get<Dashboard>('/agent/dashboard').then(setData).catch((e) => setError(errorMessage(e)));
    }, [online]),
  );

  if (!online && !data) return <Screen><Banner tone="warning" text="El tablero necesita internet." /></Screen>;
  if (!data) return error ? <Screen><Banner tone="danger" text={error} /></Screen> : <Loading />;

  const s = data.summary;
  const p = data.projection;
  const flow = data.cashflow[period];
  const label = (start: string) => (period === 'month' ? start.slice(0, 7) : start.slice(5).split('-').reverse().join('/'));

  const send = async (rec: Recommendation, index: number) => {
    try {
      await api.post('/notifications', {
        title: rec.kind === 'REPONER' ? 'Reponer stock' : rec.kind === 'COBRAR' ? 'Cobrar deuda' : 'Recomendación',
        body: rec.message,
        targetRoles: rec.targetRoles,
      });
      setSent(new Set(sent).add(index));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Screen>
      <Text style={shared.sectionTitle}>Hoy</Text>
      <View style={styles.grid}>
        <StatCard label="Ventas" cents={s.salesCents} tone={colors.primaryDark} icon="trending-up" />
        <StatCard label="Efectivo en caja" value={s.cashInDrawerCents === null ? 'Caja cerrada' : formatSoles(s.cashInDrawerCents)} icon="wallet" />
        <StatCard label="Pagos digitales" cents={s.digitalCents} tone={colors.yape} icon="phone-portrait" />
        <StatCard label="Fiados nuevos" cents={s.fiadoCents} tone={colors.danger} icon="book" />
        <StatCard label="Abonos recibidos" cents={s.abonosCents} tone={colors.primaryDark} icon="checkmark-circle" />
        <StatCard label="N° de ventas" value={String(s.salesCount)} icon="receipt" />
      </View>

      {data.alerts.length > 0 && (
        <>
          <Text style={[shared.sectionTitle, styles.section]}>Alertas activas ({data.alerts.length})</Text>
          {data.alerts.slice(0, 5).map((a) => (
            <Banner key={a.id} tone={a.severity === 'CRITICAL' ? 'danger' : a.severity === 'WARNING' ? 'warning' : 'info'} text={`${a.title}: ${a.message}`} />
          ))}
          {data.alerts.length > 5 && <Button label="Ver todas" variant="ghost" onPress={() => router.push('/alerts')} />}
        </>
      )}

      <Text style={[shared.sectionTitle, styles.section]}>Recomendaciones</Text>
      {data.recommendations.length === 0 && <Banner tone="success" text="Sin recomendaciones por ahora: el negocio va en orden." />}
      {data.recommendations.map((rec, i) => (
        <View key={i} style={[shared.card, styles.rec]}>
          <Ionicons name="bulb" size={24} color={colors.accent} />
          <Text style={styles.recText}>{rec.message}</Text>
          <Button
            label={sent.has(i) ? 'Enviada' : 'Enviar'}
            icon={sent.has(i) ? 'checkmark' : 'send'}
            variant={sent.has(i) ? 'ghost' : 'secondary'}
            disabled={sent.has(i)}
            onPress={() => send(rec, i)}
          />
        </View>
      ))}
      <Button label="Escribir un mensaje al equipo" icon="create" variant="ghost" onPress={() => router.push('/agente/send')} />

      <Text style={[shared.sectionTitle, styles.section]}>Flujo de caja</Text>
      <View style={styles.row}>
        <Chip label="Diario" selected={period === 'day'} onPress={() => setPeriod('day')} />
        <Chip label="Semanal" selected={period === 'week'} onPress={() => setPeriod('week')} />
        <Chip label="Mensual" selected={period === 'month'} onPress={() => setPeriod('month')} />
      </View>
      <BarChart
        data={flow.map((b) => ({ label: label(b.start), value: b.receivedCents, secondary: b.fiadoCents }))}
        color={colors.primaryDark}
        secondaryColor={colors.accent}
        legend={['Dinero que entró', 'Fiado (por cobrar)']}
      />

      <Text style={[shared.sectionTitle, styles.section]}>Proyección de la semana</Text>
      <View style={styles.grid}>
        <StatCard label="Próximos 7 días" cents={p.projectedWeekCents} tone={colors.secondary} icon="calendar" />
        <StatCard
          label="Última semana vs promedio"
          value={`${p.trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(p.trend * 100))}%`}
          tone={p.trend >= 0 ? colors.primaryDark : colors.danger}
          icon={p.trend >= 0 ? 'trending-up' : 'trending-down'}
        />
      </View>
      <Text style={styles.note}>Basado en el promedio de las últimas 4 semanas ({formatSoles(p.weeklyAverageCents)} por semana).</Text>
      <BarChart data={p.nextDays.map((d) => ({ label: d.dayName.slice(0, 3), value: d.projectedCents }))} color={colors.secondary} legend={['Venta esperada']} />

      <Text style={[shared.sectionTitle, styles.section]}>Top 5 más vendidos (4 semanas)</Text>
      {data.topProducts.map((prod, i) => (
        <View key={prod.productId} style={styles.listRow}>
          <Text style={styles.rank}>{i + 1}</Text>
          <Text style={styles.listName}>{prod.name}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.listValue}>{formatSoles(prod.revenueCents)}</Text>
            <Text style={styles.note}>{qty(prod)} · stock {prod.stock}</Text>
          </View>
        </View>
      ))}

      <Text style={[shared.sectionTitle, styles.section]}>Top 5 con menor rotación</Text>
      {data.slowProducts.map((prod, i) => (
        <View key={prod.productId} style={styles.listRow}>
          <Text style={[styles.rank, { backgroundColor: colors.accentSoft, color: '#92400E' }]}>{i + 1}</Text>
          <Text style={styles.listName}>{prod.name}</Text>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.listValue}>{qty(prod)}</Text>
            <Text style={styles.note}>{prod.daysSinceLastSale != null ? `última venta hace ${prod.daysSinceLastSale} días` : 'sin ventas'}</Text>
          </View>
        </View>
      ))}

      <Text style={[shared.sectionTitle, styles.section]}>¿Cuándo se vende más?</Text>
      <Heatmap matrix={data.heatmap.matrix} />
      <Text style={styles.note}>Promedio por semana de las últimas 4 semanas. Refuerza personal en los cuadros más oscuros.</Text>

      {error && <Banner tone="danger" text={error} />}
      {user?.role === 'AGENTE' && (
        <Button
          label="Salir"
          variant="ghost"
          icon="log-out"
          style={{ marginTop: spacing.xl }}
          onPress={async () => {
            await logout();
            router.replace('/login');
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { marginTop: spacing.xl },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  rec: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  recText: { flex: 1, fontSize: font.body, color: colors.text },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  rank: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primarySoft, color: colors.primaryDark, textAlign: 'center', lineHeight: 32, fontWeight: '900', overflow: 'hidden' },
  listName: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.text },
  listValue: { fontSize: font.body, fontWeight: '900', color: colors.text },
  note: { fontSize: font.small, color: colors.textMuted },
});
