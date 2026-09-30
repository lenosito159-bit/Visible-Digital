import * as Print from 'expo-print';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildReceiptText, formatSoles, whatsappLink, whatsappShareLink, type Sale } from '@perupos/shared';
import { Banner, Button, Field, Loading, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { receiptHtml } from '@/lib/sale';
import { useSyncState } from '@/lib/sync';
import { colors, font, spacing } from '@/theme';

/** Comprobante: imprimir, guardar PDF o enviar por WhatsApp. */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useAuth();
  const { online, pending } = useSyncState();
  const [sale, setSale] = useState<Sale | null>(null);
  const [status, setStatus] = useState<db.LocalSaleStatus>('PENDING');
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const local = await db.getLocalSale(id);
      if (local && alive) {
        setSale(local.sale);
        setStatus(local.status);
        setError(local.error);
      }
      // El PSE emite en segundos: se vuelve a pedir para mostrar el QR de SUNAT.
      if (online && (!local || local.status === 'SYNCED')) {
        for (const wait of [0, 2500, 6000]) {
          await new Promise((r) => setTimeout(r, wait));
          const fresh = await api.get<Sale>(`/sales/${id}`).catch(() => null);
          if (!fresh || !alive) break;
          setSale(fresh);
          setStatus('SYNCED');
          if (fresh.sunatStatus !== 'PENDIENTE') break;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, online, pending]);

  if (!sale || !settings) return <Loading />;
  const text = buildReceiptText(sale, settings, 32);

  const print = () => Print.printAsync({ html: receiptHtml(sale, settings) }).catch(() => {});
  const sharePdf = async () => {
    const { uri } = await Print.printToFileAsync({ html: receiptHtml(sale, settings) });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Compartir comprobante' });
  };
  const whatsapp = () => {
    const link = (phone && whatsappLink(phone, text)) || whatsappShareLink(text);
    void Linking.openURL(link);
  };

  return (
    <Screen>
      <View style={styles.success}>
        <Text style={styles.successTitle}>¡Venta registrada!</Text>
        <Text style={styles.successAmount}>{formatSoles(sale.totalCents)}</Text>
        {sale.changeCents > 0 && <Text style={styles.change}>Vuelto: {formatSoles(sale.changeCents)}</Text>}
      </View>
      {status === 'PENDING' && <Banner tone="warning" text="Guardada en el teléfono. Se enviará sola cuando vuelva el internet." icon="cloud-offline" />}
      {status === 'FAILED' && <Banner tone="danger" text={`No se pudo registrar en el servidor: ${error ?? ''}. Avisa al Administrador.`} />}
      {sale.sunatStatus === 'RECHAZADO' && <Banner tone="danger" text="SUNAT rechazó el comprobante. El Administrador debe revisarlo." />}

      <View style={styles.paper}>
        <ScrollView horizontal>
          <Text style={styles.mono}>{text}</Text>
        </ScrollView>
        {sale.sunatQr ? (
          <View style={{ alignItems: 'center', marginTop: spacing.md }}>
            <QRCode value={sale.sunatQr} size={140} />
          </View>
        ) : null}
      </View>

      <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
        <Button label="Nueva venta" icon="cart" big onPress={() => router.dismissTo('/pos')} />
        <View style={styles.row}>
          <Button label="Imprimir" icon="print" variant="secondary" onPress={print} style={{ flex: 1 }} />
          <Button label="PDF" icon="document" variant="ghost" onPress={sharePdf} style={{ flex: 1 }} />
        </View>
        <Field label="Celular del cliente (opcional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="987 654 321" />
        <Button label="Enviar por WhatsApp" icon="logo-whatsapp" variant="primary" onPress={whatsapp} />
        <Button label="Ir al inicio" variant="ghost" icon="home" onPress={() => router.dismissAll()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  success: { backgroundColor: colors.primarySoft, borderRadius: 18, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md },
  successTitle: { fontSize: font.title, fontWeight: '900', color: colors.primaryDark },
  successAmount: { fontSize: 44, fontWeight: '900', color: colors.primaryDark },
  change: { fontSize: font.title, fontWeight: '900', color: colors.text },
  paper: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, color: '#000', lineHeight: 18 },
  row: { flexDirection: 'row', gap: spacing.sm },
});
