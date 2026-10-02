import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Banner, Button, Chip, Field, Screen } from '@/components/ui';
import { BarChart } from '@/components/Charts';
import { API_URL, api, currentSession, errorMessage } from '@/lib/api';
import { colors, shared, spacing } from '@/theme';

interface Bucket {
  start: string;
  salesCents: number;
  receivedCents: number;
  fiadoCents: number;
  outCents: number;
  netCents: number;
}

function previousPeriod(): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Flujo de caja y libro de ventas para el SIRE de SUNAT. */
export default function Reports() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [data, setData] = useState<Bucket[]>([]);
  const [sirePeriod, setSirePeriod] = useState(previousPeriod());
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    const buckets = period === 'day' ? 14 : period === 'week' ? 8 : 6;
    api.get<Bucket[]>(`/reports/cashflow?period=${period}&buckets=${buckets}`).then(setData).catch((e) => setMessage({ tone: 'danger', text: errorMessage(e) }));
  }, [period]);

  const exportSire = async () => {
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/reports/sire?period=${sirePeriod}`, {
        headers: { Authorization: `Bearer ${currentSession()?.accessToken}` },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'No se pudo exportar.');
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `sire-${sirePeriod}.txt`;
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      file.write(await res.text());
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: 'Registro de ventas SIRE' });
      setMessage({ tone: 'success', text: `${res.headers.get('x-sire-rows') ?? 0} comprobantes exportados. Revísalo con tu contador antes de subirlo.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : errorMessage(err) });
    }
  };

  const label = (start: string) => (period === 'month' ? start.slice(0, 7) : start.slice(5).split('-').reverse().join('/'));

  return (
    <Screen>
      <Text style={shared.sectionTitle}>Flujo de caja</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Chip label="Diario" selected={period === 'day'} onPress={() => setPeriod('day')} />
        <Chip label="Semanal" selected={period === 'week'} onPress={() => setPeriod('week')} />
        <Chip label="Mensual" selected={period === 'month'} onPress={() => setPeriod('month')} />
      </View>
      <BarChart
        data={data.map((b) => ({ label: label(b.start), value: b.receivedCents, secondary: b.fiadoCents }))}
        color={colors.primaryDark}
        secondaryColor={colors.accent}
        legend={['Dinero que entró', 'Fiado (por cobrar)']}
      />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Libro de ventas (SIRE)</Text>
      <Banner text="Exporta tus boletas y facturas del mes en el formato de reemplazo del Registro de Ventas (RVIE)." />
      <Field label="Periodo (AAAAMM)" value={sirePeriod} onChangeText={setSirePeriod} keyboardType="number-pad" maxLength={6} />
      <Button label="Exportar para SIRE" icon="download" onPress={exportSire} disabled={!/^\d{6}$/.test(sirePeriod)} />
      {message && <View style={{ marginTop: spacing.md }}><Banner tone={message.tone} text={message.text} /></View>}
    </Screen>
  );
}
