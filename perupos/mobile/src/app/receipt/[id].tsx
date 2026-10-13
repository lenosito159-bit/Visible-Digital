import * as Print from 'expo-print';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  formatSoles,
  internalSaleTicket,
  ticketHtml,
  ticketText,
  whatsappLink,
  whatsappShareLink,
  type LocalSale,
} from '@perupos/shared';
import { Banner, Button, Field, Loading, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { store } from '@/lib/store';
import { colors, font, spacing } from '@/theme';

/** Ticket interno de la venta: imprimir, guardar PDF o enviar por WhatsApp. Anular (solo el dueño). */
export default function Receipt() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, can, business } = useAuth();
  const [sale, setSale] = useState<LocalSale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const load = useCallback(async () => {
    setSale(await store.getSale(id));
  }, [id]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!sale || !business) return <Loading />;
  // Comprobante interno: sin RUC ni datos de SUNAT; Yape/Plin confirmados por el comerciante.
  const lines = internalSaleTicket(sale, business);
  const text = ticketText(lines, 32);
  const html = ticketHtml(lines);

  const print = () => Print.printAsync({ html }).catch(() => {});
  const sharePdf = async () => {
    const { uri } = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Compartir ticket' });
  };
  const whatsapp = () => {
    const link = (phone && whatsappLink(phone, text)) || whatsappShareLink(text);
    void Linking.openURL(link);
  };

  return (
    <Screen>
      {sale.status === 'VOIDED' && <Banner tone="danger" text="Esta venta está ANULADA: el stock volvió y el fiado se descontó." />}
      <View style={styles.success}>
        <Text style={styles.successTitle}>{sale.status === 'VOIDED' ? `Venta N° ${sale.number}` : '¡Venta registrada!'}</Text>
        <Text style={styles.successAmount}>{formatSoles(sale.totalCents)}</Text>
        {sale.changeCents > 0 && <Text style={styles.change}>Vuelto: {formatSoles(sale.changeCents)}</Text>}
      </View>

      <View style={styles.paper}>
        <ScrollView horizontal>
          <Text style={styles.mono}>{text}</Text>
        </ScrollView>
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
        {can('sales.void') && sale.status !== 'VOIDED' && (
          <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
            {voiding ? (
              <>
                <Field label="¿Por qué la anulas?" value={voidReason} onChangeText={setVoidReason} placeholder="Ej. se cobró dos veces" />
                <Button
                  label="Sí, anular esta venta"
                  icon="close-circle"
                  variant="danger"
                  disabled={!voidReason.trim()}
                  onPress={async () => {
                    try {
                      await store.voidSale(user!, sale.id, voidReason);
                      setVoiding(false);
                      await load();
                    } catch (err) {
                      setError(errorMessage(err));
                    }
                  }}
                />
                <Button label="No anular" variant="ghost" onPress={() => setVoiding(false)} />
              </>
            ) : (
              <Button label="Anular venta" icon="close-circle" variant="ghost" onPress={() => setVoiding(true)} />
            )}
            {error && <Banner tone="danger" text={error} />}
          </View>
        )}
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
