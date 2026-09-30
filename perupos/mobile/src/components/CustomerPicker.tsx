import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatSoles, normalizePeruMobile, type Customer } from '@perupos/shared';
import { useAuth } from '@/lib/auth';
import * as db from '@/lib/db';
import { registerCustomer } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';
import { Banner, Button, Field } from './ui';

export function CustomerRow({ customer, onPress, right }: { customer: Customer; onPress?: () => void; right?: React.ReactNode }) {
  const usage = customer.creditLimitCents > 0 ? customer.balanceCents / customer.creditLimitCents : 0;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.secondarySoft }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{customer.name.trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>{customer.name}</Text>
        <Text style={styles.meta}>
          Debe {formatSoles(customer.balanceCents)} · límite {formatSoles(customer.creditLimitCents)}
        </Text>
        <View style={styles.bar}>
          <View
            style={[
              styles.barFill,
              { width: `${Math.min(100, usage * 100)}%`, backgroundColor: usage >= 1 ? colors.danger : usage >= 0.9 ? colors.accent : colors.primary },
            ]}
          />
        </View>
      </View>
      {right}
    </Pressable>
  );
}

/** Elegir cliente para un fiado o abono, o crearlo en el momento (funciona sin internet). */
export function CustomerPicker({
  visible,
  onClose,
  onSelect,
  onlyWithDebt,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect: (c: Customer) => void;
  onlyWithDebt?: boolean;
}) {
  const { settings } = useAuth();
  const [search, setSearch] = useState('');
  const [list, setList] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    void db.listCustomers({ search, withDebt: onlyWithDebt }).then(setList);
  }, [visible, search, onlyWithDebt]);

  const create = async () => {
    if (name.trim().length < 2) return setError('Escribe el nombre.');
    if (phone && !normalizePeruMobile(phone)) return setError('El celular tiene 9 dígitos y empieza con 9.');
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const customer: Customer = {
      id,
      name: name.trim(),
      phone: phone || null,
      photoUrl: null,
      docType: 'NONE',
      docNumber: null,
      creditLimitCents: settings?.defaultCreditLimitCents ?? 5000,
      balanceCents: 0,
      oldestDebtAt: null,
      lastPaymentAt: null,
      active: true,
      updatedAt: now,
    };
    await registerCustomer({ id, name: customer.name, phone: customer.phone, docType: 'NONE' }, customer);
    setCreating(false);
    setName('');
    setPhone('');
    onSelect(customer);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={styles.header}>
          <Text style={styles.title}>{creating ? 'Nuevo cliente' : 'Elige al cliente'}</Text>
          <Pressable accessibilityLabel="Cerrar" onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={32} color={colors.secondary} />
          </Pressable>
        </View>
        {creating ? (
          <View style={{ padding: spacing.lg }}>
            <Field label="Nombre" value={name} onChangeText={setName} autoFocus placeholder="Ej. Juan Pérez" />
            <Field label="Celular (opcional, para WhatsApp)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="987 654 321" />
            <Text style={styles.meta}>Límite de crédito: {formatSoles(settings?.defaultCreditLimitCents ?? 5000)} (el Administrador puede cambiarlo).</Text>
            {error && <Banner tone="danger" text={error} />}
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
              <Button label="Volver" variant="ghost" onPress={() => setCreating(false)} style={{ flex: 1 }} />
              <Button label="Guardar" icon="checkmark" onPress={create} style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <>
            <View style={{ paddingHorizontal: spacing.lg }}>
              <Field label="Buscar" value={search} onChangeText={setSearch} placeholder="Nombre o celular" />
              {!onlyWithDebt && <Button label="Nuevo cliente" icon="person-add" variant="accent" onPress={() => setCreating(true)} />}
            </View>
            <FlatList
              data={list}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
              renderItem={({ item }) => <CustomerRow customer={item} onPress={() => onSelect(item)} />}
              ListEmptyComponent={<Text style={[styles.meta, { textAlign: 'center' }]}>No hay clientes con ese nombre.</Text>}
            />
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg },
  title: { flex: 1, fontSize: font.title, fontWeight: '900', color: colors.secondary },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { ...shared.card, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: font.large, fontWeight: '900' },
  name: { fontSize: font.body, fontWeight: '800', color: colors.text },
  meta: { fontSize: font.small, color: colors.textMuted, marginTop: 2 },
  bar: { height: 6, backgroundColor: colors.secondarySoft, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
});
