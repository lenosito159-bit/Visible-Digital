import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  PAYMENT_METHOD_LABELS,
  REPORT_PERIOD_LABELS,
  formatSoles,
  type PaymentMethod,
  type PeriodReport,
  type ReportPeriod,
} from '@perupos/shared';
import { Text, View } from 'react-native';
import { Chip, Loading, Screen, StatCard } from '@/components/ui';
import { store } from '@/lib/store';
import { BarChart } from '@/components/Charts';
import { colors, font, shared, spacing } from '@/theme';

const METHODS: PaymentMethod[] = ['CASH', 'YAPE', 'PLIN', 'CARD', 'TRANSFER', 'FIADO'];
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Informes calculados en el celular: cuánto vendí, cómo me pagaron, qué se vende más y cuánto gané. */
export default function Reports() {
  const [period, setPeriod] = useState<ReportPeriod>('SEMANA');
  const [report, setReport] = useState<PeriodReport | null>(null);
  useFocusEffect(
    useCallback(() => {
      setReport(null);
      void store.report(period).then(setReport);
    }, [period]),
  );
  const label = (day: string) => {
    const d = new Date(`${day}T12:00:00Z`);
    return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
  };
  const line = (text: string, cents: number, key?: string) => (
    <View key={key ?? text} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ fontSize: font.body, color: colors.textMuted, flex: 1 }}>{text}</Text>
      <Text style={{ fontSize: font.body, fontWeight: '800', color: colors.text }}>{formatSoles(cents)}</Text>
    </View>
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
        {(Object.keys(REPORT_PERIOD_LABELS) as ReportPeriod[]).map((p) => (
          <Chip key={p} label={REPORT_PERIOD_LABELS[p]} selected={period === p} onPress={() => setPeriod(p)} />
        ))}
      </View>
      {!report ? (
        <Loading />
      ) : (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}>
            <StatCard label="Vendiste" cents={report.salesCents} tone={colors.primaryDark} icon="trending-up" />
            <StatCard label="N° de ventas" value={String(report.salesCount)} icon="receipt" />
            <StatCard label="Venta promedio" cents={report.averageTicketCents} icon="pricetag" />
            <StatCard label="Te deben (hoy)" cents={report.totalDebtCents} tone={colors.danger} icon="book" />
          </View>

          {report.byDay.length > 1 && (
            <BarChart data={report.byDay.map((d) => ({ label: label(d.day), value: d.salesCents }))} color={colors.primary} legend={['Vendido']} />
          )}

          <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Cómo te pagaron</Text>
          <View style={shared.card}>
            {METHODS.filter((m) => report.byMethod[m]).map((m) =>
              line(m === 'FIADO' ? 'Fiado (quedaron debiendo)' : PAYMENT_METHOD_LABELS[m], report.byMethod[m]!, m),
            )}
            {report.salesCount === 0 && <Text style={{ color: colors.textMuted }}>No hubo ventas en este periodo.</Text>}
            {(report.byMethod.YAPE || report.byMethod.PLIN) && (
              <Text style={{ fontSize: font.small, color: colors.textMuted, marginTop: spacing.sm }}>
                Yape y Plin: confirmados manualmente por el comerciante. Compáralos con tu app de Yape/Plin.
              </Text>
            )}
          </View>

          <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Fiados</Text>
          <View style={shared.card}>
            {line('Fiaste', report.fiadoCents)}
            {line('Te abonaron', report.abonosCents)}
            {METHODS.filter((m) => report.abonosByMethod[m]).map((m) => line(`   en ${PAYMENT_METHOD_LABELS[m]}`, report.abonosByMethod[m]!, `a-${m}`))}
          </View>

          <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Ganancia aproximada</Text>
          <View style={shared.card}>
            {line('Ganancia (venta − costo)', report.margin.cents)}
            <Text style={{ fontSize: font.small, color: colors.textMuted }}>
              {report.margin.uncoveredSalesCents > 0
                ? `Solo cuenta productos con costo anotado. ${formatSoles(report.margin.uncoveredSalesCents)} de ventas no tienen costo: anótalo en Productos para ver la ganancia completa.`
                : 'Calculada con el costo que anotaste en cada producto.'}
            </Text>
          </View>

          <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Lo que más se vende</Text>
          <View style={shared.card}>
            {report.topProducts.map((t, i) =>
              line(`${i + 1}. ${t.name} (${t.unit === 'KG' ? `${t.quantity} kg` : `${t.quantity} und`})`, t.totalCents, t.productId),
            )}
            {report.topProducts.length === 0 && <Text style={{ color: colors.textMuted }}>Todavía nada.</Text>}
          </View>
          {(report.discountCents > 0 || report.voidedCount > 0) && (
            <Text style={{ fontSize: font.small, color: colors.textMuted, marginTop: spacing.md }}>
              {report.discountCents > 0 ? `Descuentos dados: ${formatSoles(report.discountCents)}. ` : ''}
              {report.voidedCount > 0 ? `Ventas anuladas (no cuentan): ${report.voidedCount}.` : ''}
            </Text>
          )}
        </>
      )}
    </Screen>
  );
}
