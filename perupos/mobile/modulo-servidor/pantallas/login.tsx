import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ROLE_LABELS, type Role } from '@perupos/shared';
import { NumPad, applyKey } from '@/components/NumPad';
import { Banner, Button, Field, type IconName } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { homeFor, recentUsers, useAuth, type RecentUser } from '@/lib/auth';
import { colors, font, spacing } from '@/theme';

const ROLE_OPTIONS: { role: Role; icon: IconName; color: string; hint: string }[] = [
  { role: 'VENDEDOR', icon: 'cart', color: colors.primaryDark, hint: 'Vender, fiar y cobrar' },
  { role: 'ADMIN', icon: 'storefront', color: colors.secondary, hint: 'Dueño del negocio' },
  { role: 'AGENTE', icon: 'stats-chart', color: '#7C3AED', hint: 'Finanzas y alertas' },
];

/** Paso 1: ¿quién eres? (rol) · Paso 2: usuario y PIN con teclado grande. */
export default function Login() {
  const { login } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [recent, setRecent] = useState<RecentUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void recentUsers().then(setRecent);
  }, []);

  const submit = async (pin = secret) => {
    if (!role) return;
    setLoading(true);
    setError(null);
    try {
      await login(username.trim().toLowerCase(), pin, role);
      router.replace(homeFor(role));
    } catch (err) {
      setError(errorMessage(err));
      setSecret('');
    } finally {
      setLoading(false);
    }
  };

  const onKey = (k: string) => {
    const next = applyKey(secret, k, 6).replace('.', '');
    setSecret(next);
  };

  if (!role) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.brand}>PeruPOS</Text>
          <Text style={styles.subtitle}>¿Quién va a usar la app?</Text>
          {ROLE_OPTIONS.map((o) => (
            <Pressable
              key={o.role}
              accessibilityRole="button"
              onPress={() => {
                setRole(o.role);
                const last = recent.find((u) => u.role === o.role);
                setUsername(last?.username ?? '');
              }}
              style={({ pressed }) => [styles.roleButton, { backgroundColor: o.color, opacity: pressed ? 0.85 : 1 }]}
            >
              <Ionicons name={o.icon} size={40} color="#FFFFFF" />
              <View>
                <Text style={styles.roleText}>{ROLE_LABELS[o.role]}</Text>
                <Text style={styles.roleHint}>{o.hint}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  const sameRole = recent.filter((u) => u.role === role);
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => setRole(null)} style={styles.back} accessibilityRole="button">
          <Ionicons name="arrow-back" size={24} color={colors.secondary} />
          <Text style={styles.backText}>{ROLE_LABELS[role]}</Text>
        </Pressable>

        {sameRole.length > 0 && (
          <View style={styles.recentRow}>
            {sameRole.map((u) => (
              <Pressable
                key={u.username}
                onPress={() => setUsername(u.username)}
                style={[styles.recent, username === u.username && { borderColor: colors.primaryDark, backgroundColor: colors.primarySoft }]}
              >
                <Text style={styles.recentInitial}>{u.name.charAt(0)}</Text>
                <Text style={styles.recentName} numberOfLines={1}>
                  {u.name.split(' ')[0]}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <Field label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} placeholder="ej. carlos" />

        {usePassword ? (
          <>
            <Field label="Contraseña" value={secret} onChangeText={setSecret} secureTextEntry onSubmitEditing={() => submit()} />
            <Button label="Ingresar" icon="log-in" big onPress={() => submit()} loading={loading} disabled={!username || !secret} />
          </>
        ) : (
          <>
            <Text style={styles.pin}>{secret ? '●'.repeat(secret.length) : 'Tu PIN'}</Text>
            {error && <Banner tone="danger" text={error} />}
            <NumPad onKey={onKey} />
            <Button
              label="Ingresar"
              icon="log-in"
              big
              onPress={() => submit()}
              loading={loading}
              disabled={!username || secret.length < 4}
              style={{ marginTop: spacing.lg }}
            />
          </>
        )}
        {usePassword && error && <Banner tone="danger" text={error} />}
        <Button
          label={usePassword ? 'Usar PIN' : 'Usar contraseña'}
          variant="ghost"
          onPress={() => {
            setUsePassword(!usePassword);
            setSecret('');
          }}
          style={{ marginTop: spacing.md }}
        />
        <Text style={styles.note}>La primera vez necesitas internet. Luego la app funciona aunque se caiga la señal.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 44, fontWeight: '900', color: colors.primaryDark, textAlign: 'center', marginTop: spacing.xl },
  subtitle: { fontSize: font.large, color: colors.text, textAlign: 'center', marginBottom: spacing.md, fontWeight: '600' },
  roleButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl, borderRadius: 18, minHeight: 96 },
  roleText: { color: '#FFFFFF', fontSize: font.title, fontWeight: '900' },
  roleHint: { color: '#FFFFFF', fontSize: font.body, opacity: 0.9 },
  back: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  backText: { fontSize: font.title, fontWeight: '900', color: colors.secondary },
  recentRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  recent: { width: 84, alignItems: 'center', padding: spacing.sm, borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  recentInitial: { fontSize: font.title, fontWeight: '900', color: colors.secondary },
  recentName: { fontSize: font.small, fontWeight: '700', color: colors.text },
  pin: { fontSize: font.huge, textAlign: 'center', letterSpacing: 10, color: colors.text, marginVertical: spacing.sm },
  note: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
