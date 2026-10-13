import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { LocalError, changePin, parseSoles, updateBusiness } from '@perupos/shared';
import { router } from 'expo-router';
import { BackupPanel } from '@/components/BackupPanel';
import { ServerSettings } from '@/components/ServerSettings';
import { Banner, Button, Field, Loading, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { localCrypto, localDb } from '@/lib/localDb';
import { SERVER_ENABLED } from '@/lib/mode';
import { colors, font, shared, spacing } from '@/theme';

const soles = (c: number) => (c / 100).toFixed(2);

export default function Settings() {
  return SERVER_ENABLED ? <ServerSettings /> : <LocalSettings />;
}

/** Mi negocio, guardado en el celular: sin RUC ni datos tributarios. */
function LocalSettings() {
  const { business, user, reloadBusiness, logout } = useAuth();
  const [form, setForm] = useState(() => ({
    name: business?.name ?? '',
    ownerName: business?.ownerName ?? '',
    phone: business?.phone ?? '',
    receiptFooter: business?.receiptFooter ?? '',
    creditLimit: soles(business?.defaultCreditLimitCents ?? 0),
    overdueDays: String(business?.overdueDays ?? 30),
    cashLow: soles(business?.cashLowThresholdCents ?? 0),
  }));
  const [pins, setPins] = useState({ current: '', next: '', repeat: '' });
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pinMessage, setPinMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  if (!business || !user) return <Loading />;
  const set = (k: keyof typeof form) => (v: string) => setForm({ ...form, [k]: v });
  const fail = (err: unknown) => (err instanceof LocalError ? err.message : 'No se pudo guardar. Vuelve a intentar.');

  const save = async () => {
    setMessage(null);
    const creditLimit = parseSoles(form.creditLimit);
    const cashLow = parseSoles(form.cashLow);
    const overdueDays = Number(form.overdueDays);
    if (creditLimit === null || cashLow === null || !Number.isInteger(overdueDays)) {
      return setMessage({ tone: 'danger', text: 'Revisa los montos y los días: solo números.' });
    }
    try {
      await updateBusiness(localDb, {
        name: form.name,
        ownerName: form.ownerName,
        phone: form.phone || null,
        receiptFooter: form.receiptFooter || null,
        defaultCreditLimitCents: creditLimit,
        overdueDays,
        cashLowThresholdCents: cashLow,
      });
      await reloadBusiness();
      setMessage({ tone: 'success', text: 'Guardado en este celular.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: fail(err) });
    }
  };

  const savePin = async () => {
    setPinMessage(null);
    if (pins.next !== pins.repeat) return setPinMessage({ tone: 'danger', text: 'Los dos PIN nuevos no son iguales.' });
    try {
      await changePin(localDb, localCrypto, user.id, pins.current, pins.next);
      setPins({ current: '', next: '', repeat: '' });
      setPinMessage({ tone: 'success', text: 'PIN cambiado.' });
    } catch (err) {
      setPinMessage({ tone: 'danger', text: fail(err) });
    }
  };

  const digits = (k: keyof typeof pins) => (v: string) => setPins({ ...pins, [k]: v.replace(/\D/g, '') });

  return (
    <Screen>
      <Text style={shared.sectionTitle}>Tu negocio</Text>
      <Field label="Nombre del negocio" value={form.name} onChangeText={set('name')} maxLength={60} />
      <Field label="Tu nombre" value={form.ownerName} onChangeText={set('ownerName')} maxLength={60} />
      <Field label="Celular (opcional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={15} />
      <Field label="Mensaje al pie del ticket (opcional)" value={form.receiptFooter} onChangeText={set('receiptFooter')} placeholder="¡Gracias por su compra, casero!" maxLength={120} />

      <Text style={shared.sectionTitle}>Fiado y caja</Text>
      <Field label="Fiado máximo para un cliente nuevo (S/)" value={form.creditLimit} onChangeText={set('creditLimit')} keyboardType="decimal-pad" />
      <Field label="Días para que un fiado se considere vencido" value={form.overdueDays} onChangeText={set('overdueDays')} keyboardType="number-pad" maxLength={3} />
      <Field label="Avisar cuando la caja baje de (S/)" value={form.cashLow} onChangeText={set('cashLow')} keyboardType="decimal-pad" />
      {message && <Banner tone={message.tone} text={message.text} />}
      <Button label="Guardar" icon="save" big onPress={() => void save()} />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Cambiar mi PIN</Text>
      <Field label="PIN actual" value={pins.current} onChangeText={digits('current')} keyboardType="number-pad" secureTextEntry maxLength={6} />
      <Field label="PIN nuevo (4 a 6 números)" value={pins.next} onChangeText={digits('next')} keyboardType="number-pad" secureTextEntry maxLength={6} />
      <Field label="Repite el PIN nuevo" value={pins.repeat} onChangeText={digits('repeat')} keyboardType="number-pad" secureTextEntry maxLength={6} />
      {pinMessage && <Banner tone={pinMessage.tone} text={pinMessage.text} />}
      <Button label="Cambiar PIN" icon="key" variant="secondary" disabled={pins.current.length < 4 || pins.next.length < 4} onPress={() => void savePin()} />

      {user.role === 'ADMIN' && (
        <>
          <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Copia de seguridad</Text>
          <BackupPanel
            lastBackupAt={business.lastBackupAt}
            onRestored={async () => {
              // Lo recuperado tiene sus propios usuarios y PIN: se vuelve a entrar.
              await reloadBusiness();
              await logout();
              router.replace('/');
            }}
          />
        </>
      )}

      <Text style={styles.note}>Todo se guarda solo en este celular. No se envía a ningún lado si tú no lo compartes.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: font.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
