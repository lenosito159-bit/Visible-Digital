import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LocalError, formatRecoveryCode } from '@perupos/shared';
import { Banner, Button, Field } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { colors, font, spacing } from '@/theme';

/**
 * Primera vez que se abre la app: solo el nombre del negocio, tu nombre y un
 * PIN. Sin RUC, sin correo, sin internet. Todo queda en este celular.
 */
export default function Setup() {
  const { setup } = useAuth();
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (pin !== pin2) {
      setError('Los dos PIN no son iguales. Escríbelos de nuevo.');
      setPin2('');
      return;
    }
    setSaving(true);
    try {
      setRecoveryCode(await setup({ businessName, ownerName, pin, phone: phone || null }));
    } catch (err) {
      setError(err instanceof LocalError ? err.message : 'No se pudo guardar. Vuelve a intentar.');
    } finally {
      setSaving(false);
    }
  };

  if (recoveryCode) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Ionicons name="key" size={56} color={colors.accent} style={{ alignSelf: 'center' }} />
          <Text style={styles.title}>Anota este código</Text>
          <Text style={styles.text}>
            Si un día olvidas tu PIN, con este código pones uno nuevo. Escríbelo en un papel y guárdalo junto a tus
            cosas importantes. No se vuelve a mostrar.
          </Text>
          <View style={styles.codeBox}>
            <Text style={styles.code} selectable>
              {formatRecoveryCode(recoveryCode)}
            </Text>
          </View>
          <Banner tone="warning" text="No lo guardes en este mismo celular: si lo pierdes, también pierdes el código." />
          <Button label="Ya lo anoté" icon="checkmark-circle" big onPress={() => router.replace('/')} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>PeruPOS</Text>
        <Text style={styles.title}>Prepara tu negocio</Text>
        <Text style={styles.text}>
          No necesitas RUC ni internet. Tus ventas, productos y fiados se guardan en este celular.
        </Text>
        <Field label="Nombre de tu negocio" value={businessName} onChangeText={setBusinessName} placeholder="ej. Bodega Rosita" maxLength={60} />
        <Field label="Tu nombre" value={ownerName} onChangeText={setOwnerName} placeholder="ej. Rosa" maxLength={60} />
        <Field
          label="Tu celular (opcional, sale en tus tickets)"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="987 654 321"
          maxLength={15}
        />
        <Field
          label="Crea tu PIN (4 a 6 números)"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        <Field
          label="Repite tu PIN"
          value={pin2}
          onChangeText={(v) => setPin2(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
        />
        {error && <Banner tone="danger" text={error} />}
        <Button
          label="Empezar"
          icon="storefront"
          big
          loading={saving}
          disabled={!businessName.trim() || !ownerName.trim() || pin.length < 4 || pin2.length < 4}
          onPress={() => void submit()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, gap: spacing.md, maxWidth: 520, width: '100%', alignSelf: 'center' },
  brand: { fontSize: 40, fontWeight: '900', color: colors.primaryDark, textAlign: 'center', marginTop: spacing.lg },
  title: { fontSize: font.title, fontWeight: '900', color: colors.text, textAlign: 'center' },
  text: { fontSize: font.body, color: colors.textMuted, textAlign: 'center' },
  codeBox: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.accent, borderRadius: 16, padding: spacing.xl },
  code: { fontSize: font.huge, fontWeight: '900', letterSpacing: 4, textAlign: 'center', color: colors.text },
});
