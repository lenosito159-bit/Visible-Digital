import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocalError, listLocalUsers, resetOwnerPin, type LocalUser } from '@perupos/shared';
import { NumPad, applyKey } from '@/components/NumPad';
import { Banner, Button, Field } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { localCrypto, localDb } from '@/lib/localDb';
import { colors, font, spacing } from '@/theme';

/** Entrar con PIN. No usa internet: el PIN se revisa en el celular. */
export default function Unlock() {
  const { business, unlock } = useAuth();
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    void listLocalUsers(localDb).then((list) => {
      setUsers(list);
      setSelected((s) => s ?? list[0]?.id ?? null);
    });
  }, []);

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const result = await unlock(selected, pin);
      if (result.ok) router.replace('/');
      else setError(result.message);
    } catch (err) {
      setError(err instanceof LocalError ? err.message : 'No se pudo entrar. Vuelve a intentar.');
    } finally {
      setPin('');
      setBusy(false);
    }
  };

  if (recovering) return <Recover onDone={() => setRecovering(false)} />;

  const current = users.find((u) => u.id === selected);
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>{business?.name ?? 'PeruPOS'}</Text>
        {business?.isDemo && <Banner tone="warning" text="Demostración con datos de ejemplo. El PIN es 1234." />}
        {users.length > 1 && (
          <View style={styles.users}>
            {users.map((u) => (
              <Pressable
                key={u.id}
                accessibilityRole="button"
                onPress={() => {
                  setSelected(u.id);
                  setPin('');
                  setError(null);
                }}
                style={[styles.user, selected === u.id && styles.userActive]}
              >
                <Text style={styles.initial}>{u.name.charAt(0)}</Text>
                <Text style={styles.userName} numberOfLines={1}>
                  {u.name.split(' ')[0]}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.hello}>Hola, {current?.name.split(' ')[0] ?? ''}</Text>
        <Text style={styles.pin}>{pin ? '●'.repeat(pin.length) : 'Tu PIN'}</Text>
        {error && <Banner tone="danger" text={error} />}
        <NumPad onKey={(k) => setPin((p) => applyKey(p, k, 6).replace('.', ''))} />
        <Button label="Entrar" icon="lock-open" big loading={busy} disabled={pin.length < 4 || !selected} onPress={() => void submit()} />
        {current?.role === 'ADMIN' && (
          <Button label="Olvidé mi PIN" variant="ghost" onPress={() => setRecovering(true)} style={{ marginTop: spacing.md }} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Con el código de recuperación que se anotó al configurar el negocio. */
function Recover({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (pin !== pin2) {
      setError('Los dos PIN no son iguales.');
      return;
    }
    try {
      await resetOwnerPin(localDb, localCrypto, code, pin);
      setDone(true);
    } catch (err) {
      setError(err instanceof LocalError ? err.message : 'No se pudo cambiar el PIN.');
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hello}>Olvidé mi PIN</Text>
        {done ? (
          <>
            <Banner tone="success" text="Listo. Ya puedes entrar con tu PIN nuevo." />
            <Button label="Entrar" icon="lock-open" big onPress={onDone} />
          </>
        ) : (
          <>
            <Text style={styles.note}>Escribe el código de 10 números que anotaste cuando preparaste el negocio.</Text>
            <Field label="Código de recuperación" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="12345-67890" maxLength={11} />
            <Field label="PIN nuevo (4 a 6 números)" value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, ''))} keyboardType="number-pad" secureTextEntry maxLength={6} />
            <Field label="Repite el PIN nuevo" value={pin2} onChangeText={(v) => setPin2(v.replace(/\D/g, ''))} keyboardType="number-pad" secureTextEntry maxLength={6} />
            {error && <Banner tone="danger" text={error} />}
            <Button label="Cambiar PIN" icon="key" big disabled={code.replace(/\D/g, '').length !== 10 || pin.length < 4} onPress={() => void submit()} />
            <Button label="Volver" variant="ghost" onPress={onDone} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brand: { fontSize: font.huge, fontWeight: '900', color: colors.primaryDark, textAlign: 'center', marginTop: spacing.lg },
  hello: { fontSize: font.title, fontWeight: '800', color: colors.text, textAlign: 'center' },
  users: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  user: { width: 84, alignItems: 'center', padding: spacing.sm, borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  userActive: { borderColor: colors.primaryDark, backgroundColor: colors.primarySoft },
  initial: { fontSize: font.title, fontWeight: '900', color: colors.secondary },
  userName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  pin: { fontSize: font.huge, textAlign: 'center', letterSpacing: 10, color: colors.text, marginVertical: spacing.sm },
  note: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
});
