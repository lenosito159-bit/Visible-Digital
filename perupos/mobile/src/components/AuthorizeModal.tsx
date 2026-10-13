import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { errorMessage } from '@/lib/errors';
import { store } from '@/lib/store';
import { colors, font, spacing } from '@/theme';
import { NumPad, applyKey } from './NumPad';
import { Banner, Button } from './ui';

/**
 * El dueño autoriza en el mismo celular con su PIN. Se usa para descuentos
 * mayores a 10 % y fiados sobre el límite que hace un ayudante.
 * `onAuthorized` recibe el id del dueño.
 */
export function AuthorizeModal({
  visible,
  reason,
  onClose,
  onAuthorized,
}: {
  visible: boolean;
  reason: string;
  onClose: () => void;
  onAuthorized: (ownerId: string, ownerName: string) => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await store.authorizeWithOwnerPin(pin);
      if (result.ok) onAuthorized(result.ownerId, result.ownerName);
      else setError(result.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPin('');
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Que el dueño ponga su PIN</Text>
          <Text style={styles.reason}>{reason}</Text>
          <Text style={styles.pin}>{pin ? '●'.repeat(pin.length) : 'PIN'}</Text>
          {error && <Banner tone="danger" text={error} />}
          <NumPad onKey={(k) => setPin((p) => applyKey(p, k, 6).replace('.', ''))} />
          <View style={styles.actions}>
            <Button label="Cancelar" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
            <Button label="Autorizar" icon="shield-checkmark" onPress={() => void submit()} loading={loading} disabled={pin.length < 4} style={{ flex: 1 }} />
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
