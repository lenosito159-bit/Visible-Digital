import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ROLE_LABELS, ROLES, type Role, type User } from '@perupos/shared';
import { Banner, Button, Chip, Field, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { colors, font, shared, spacing } from '@/theme';

/** Crear, editar y desactivar usuarios. */
export default function Users() {
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [role, setRole] = useState<Role>('VENDEDOR');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [newPin, setNewPin] = useState('');

  const load = useCallback(() => {
    api.get<User[]>('/users').then(setUsers).catch((e) => setMessage({ tone: 'danger', text: errorMessage(e) }));
  }, []);
  useFocusEffect(load);

  const create = async () => {
    try {
      await api.post('/users', { name, username, role, secret });
      setName('');
      setUsername('');
      setSecret('');
      setMessage({ tone: 'success', text: `Usuario creado. Entra con "${username.toLowerCase()}" y su PIN.` });
      load();
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  const toggle = async (u: User) => {
    try {
      await api.patch(`/users/${u.id}`, { active: !u.active });
      load();
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  const resetPin = async (u: User) => {
    try {
      await api.patch(`/users/${u.id}`, { secret: newPin });
      setPinFor(null);
      setNewPin('');
      setMessage({ tone: 'success', text: `PIN de ${u.name} actualizado.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  return (
    <Screen>
      {users.map((u) => (
        <View key={u.id} style={[styles.row, !u.active && { opacity: 0.5 }]}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{u.name}</Text>
              <Text style={styles.meta}>
                {u.username} · {ROLE_LABELS[u.role]}
                {u.active ? '' : ' · desactivado'}
              </Text>
            </View>
            <Button label={u.active ? 'Desactivar' : 'Activar'} variant="ghost" onPress={() => toggle(u)} />
            <Button label="PIN" variant="ghost" onPress={() => setPinFor(pinFor === u.id ? null : u.id)} />
          </View>
          {pinFor === u.id && (
            <View style={styles.rowTop}>
              <View style={{ flex: 1 }}>
                <Field label="Nuevo PIN" value={newPin} onChangeText={setNewPin} keyboardType="number-pad" secureTextEntry maxLength={6} />
              </View>
              <Button label="Guardar" onPress={() => resetPin(u)} disabled={newPin.length < 4} />
            </View>
          )}
        </View>
      ))}
      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Nuevo usuario</Text>
      <Field label="Nombre" value={name} onChangeText={setName} placeholder="Ej. Carmen Rojas" />
      <Field label="Usuario" value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="Ej. carmen" />
      <Field label="PIN (4 a 6 números) o contraseña" value={secret} onChangeText={setSecret} secureTextEntry />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
        {ROLES.map((r) => (
          <Chip key={r} label={ROLE_LABELS[r]} selected={role === r} onPress={() => setRole(r)} />
        ))}
      </View>
      {message && <Banner tone={message.tone} text={message.text} />}
      <Button label="Crear usuario" icon="person-add" onPress={create} disabled={!name || !username || secret.length < 4} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { ...shared.card, gap: spacing.sm, marginBottom: spacing.sm, padding: spacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted },
});
