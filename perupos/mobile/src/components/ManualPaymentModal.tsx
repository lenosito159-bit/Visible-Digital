import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { formatSoles } from '@perupos/shared';
import { colors, font, spacing } from '@/theme';
import { Banner, Button, Field } from './ui';

/**
 * Yape / Plin sin integración: el comerciante revisa en SU app que le llegó
 * el pago y lo confirma aquí. Queda como "confirmado por ti", no como
 * verificado: la app no revisa Yape por su cuenta.
 */
export function ManualPaymentModal({
  visible,
  method,
  amountCents,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  method: 'YAPE' | 'PLIN';
  amountCents: number;
  onConfirm: (reference?: string) => void;
  onCancel: () => void;
}) {
  const [reference, setReference] = useState('');
  const app = method === 'YAPE' ? 'Yape' : 'Plin';
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Revisa tu app de {app}</Text>
          <Text style={styles.text}>¿Ya te llegó?</Text>
          <Text style={[styles.amount, { color: method === 'YAPE' ? colors.yape : '#007C88' }]}>{formatSoles(amountCents)}</Text>
          <Banner
            tone="info"
            text={`Confírmalo solo si ya ves el pago en tu ${app}. Queda anotado como "confirmado por ti": esta app no revisa ${app} por su cuenta.`}
          />
          <Field
            label="N° de operación (opcional, evita cobrar dos veces con la misma captura)"
            value={reference}
            onChangeText={setReference}
            autoCapitalize="characters"
            maxLength={30}
          />
          <View style={styles.actions}>
            <Button label="Todavía no" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              label="Sí, ya me llegó"
              icon="checkmark-circle"
              variant={method === 'YAPE' ? 'yape' : 'plin'}
              onPress={() => {
                const ref = reference.trim() || undefined;
                setReference('');
                onConfirm(ref);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(17,24,39,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: spacing.sm },
  title: { fontSize: font.title, fontWeight: '900', color: colors.secondary },
  text: { fontSize: font.large, color: colors.text, fontWeight: '700' },
  amount: { fontSize: 44, fontWeight: '900', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
});
