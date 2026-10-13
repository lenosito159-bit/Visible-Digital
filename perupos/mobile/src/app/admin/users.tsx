import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ROLE_LABELS, ROLES, type LocalUser, type Role, type User } from '@perupos/shared';
import { Banner, Button, Chip, Field, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { SERVER_ENABLED } from '@/lib/mode';
import { store } from '@/lib/store';
import { colors, font, shared, spacing } from '@/theme';

export default function Users() {
  return SERVER_ENABLED ? <ServerUsers /> : <LocalHelpers />;
}

/** Módulo de servidor: crear, editar y desactivar usuarios. */
function ServerUsers() {
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

/**
 * Ayudantes en el mismo celular: cada uno entra con su propio PIN y puede
 * vender, fiar, cobrar abonos y usar la caja. No cambia precios, no ve los
 * informes ni anula ventas.
 */
function LocalHelpers() {
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
