import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '@/lib/api';
import { useSyncState } from '@/lib/sync';
import { colors, font, spacing } from '@/theme';
import { NumPad, applyKey } from './NumPad';
import { Banner, Button, Field } from './ui';

/**
 * El dueño autoriza en el mismo teléfono: escribe su usuario y PIN.
 * Se usa para descuentos mayores a 10 % y fiados sobre el límite.
 */
export function AuthorizeModal({
  visible,
  purpose,
  saleId,
  reason,
  onClose,
  onAuthorized,
}: {
  visible: boolean;
  purpose: 'DISCOUNT' | 'CREDIT';
  saleId: string;
  reason: string;
  onClose: () => void;
  onAuthorized: (token: string, adminName: string) => void;
}) {
  const [username, setUsername] = useState('admin');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { online } = useSyncState();

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ authorizationToken: string; adminName: string }>('/auth/authorize', {
        username,
        secret: pin,
        purpose,
        saleId,
      });
      setPin('');
      onAuthorized(res.authorizationToken, res.adminName);
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Autorización del Administrador</Text>
          <Text style={styles.reason}>{reason}</Text>
          {!online && <Banner tone="warning" text="No hay señal y el dueño no puede autorizar desde aquí. Cobra sin descuento o sin pasarte del límite de fiado." />}
          <Field label="Usuario del Administrador" value={username} onChangeText={setUsername} autoCapitalize="none" />
          <Text style={styles.pin}>{pin ? '●'.repeat(pin.length) : 'PIN'}</Text>
          {error && <Banner tone="danger" text={error} />}
          <NumPad onKey={(k) => setPin((p) => applyKey(p, k, 8).replace('.', ''))} />
          <View style={styles.actions}>
            <Button label="Cancelar" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Autorizar" icon="shield-checkmark" onPress={submit} loading={loading} disabled={pin.length < 4 || !online} style={{ flex: 1 }} />
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
  reason: { fontSize: font.body, color: colors.text, marginBottom: spacing.sm },
  pin: { fontSize: font.huge, textAlign: 'center', letterSpacing: 8, color: colors.text, marginVertical: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
});
