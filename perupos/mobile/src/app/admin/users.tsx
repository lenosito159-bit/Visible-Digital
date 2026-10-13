import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LocalUser } from '@perupos/shared';
import { Banner, Button, Field, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/errors';
import { store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

/**
 * Ayudantes en el mismo celular: cada uno entra con su propio PIN y puede
 * vender, fiar, cobrar abonos y usar la caja. No cambia precios, no ve los
 * informes ni anula ventas.
 */
export default function Users() {
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const load = useCallback(() => {
    void store.users().then(setUsers);
  }, []);
  useFocusEffect(load);

  const add = async () => {
    setMessage(null);
    if (pin !== pin2) return setMessage({ tone: 'danger', text: 'Los dos PIN no son iguales.' });
    try {
      const helper = await store.addHelper(name, pin);
      setName('');
      setPin('');
      setPin2('');
      setMessage({ tone: 'success', text: `Listo. ${helper.name} entra eligiendo su nombre y poniendo su PIN.` });
      load();
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  return (
    <Screen>
      <Text style={shared.sectionTitle}>Quiénes usan este celular</Text>
      {users.map((u) => (
        <View key={u.id} style={[shared.card, { marginBottom: spacing.sm, gap: spacing.sm }]}>
          <Text style={styles.name}>{u.name}</Text>
          <Text style={styles.meta}>{u.role === 'ADMIN' ? 'Dueño: puede todo' : 'Ayudante: vende, fía, cobra y usa la caja'}</Text>
          {u.role !== 'ADMIN' &&
            (confirmRemove === u.id ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Button label="No" variant="ghost" onPress={() => setConfirmRemove(null)} style={{ flex: 1 }} />
                <Button
                  label="Sí, quitar"
                  variant="danger"
                  style={{ flex: 1 }}
                  onPress={async () => {
                    await store.removeHelper(u.id);
                    setConfirmRemove(null);
                    load();
                  }}
                />
              </View>
            ) : (
              <Button label="Quitar acceso" icon="person-remove" variant="ghost" onPress={() => setConfirmRemove(u.id)} />
            ))}
        </View>
      ))}
      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Agregar ayudante</Text>
      <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Pepe" maxLength={60} />
      <Field label="Su PIN (4 a 6 números)" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} keyboardType="number-pad" secureTextEntry maxLength={6} />
      <Field label="Repite su PIN" value={pin2} onChangeText={(v) => setPin2(v.replace(/\D/g, ''))} keyboardType="number-pad" secureTextEntry maxLength={6} />
      {message && <Banner tone={message.tone} text={message.text} />}
      <Button label="Agregar" icon="person-add" disabled={!name.trim() || pin.length < 4 || pin2.length < 4} onPress={() => void add()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { ...shared.card, gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
});
