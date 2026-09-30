import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatSoles, type Customer } from '@perupos/shared';
import { CustomerPicker, CustomerRow } from '@/components/CustomerPicker';
import { Button, Empty, Field, Screen, StatCard } from '@/components/ui';
import * as db from '@/lib/db';
import { onDataChanged } from '@/lib/sync';
import { colors, spacing } from '@/theme';

/** El cuaderno de fiados, digital: clientes con su deuda. */
export default function Customers() {
  const [search, setSearch] = useState('');
  const [list, setList] = useState<Customer[]>([]);
  const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => onDataChanged(() => setVersion((v) => v + 1)), []);
  useFocusEffect(
    useCallback(() => {
      void db.listCustomers({ search }).then(setList);
    }, [search, version]),
  );

  const totalDebt = list.reduce((s, c) => s + Math.max(0, c.balanceCents), 0);
  const withDebt = list.filter((c) => c.balanceCents > 0).length;

  return (
    <Screen>
      <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md }}>
        <StatCard label="Te deben en total" value={formatSoles(totalDebt)} tone={colors.danger} icon="book" />
        <StatCard label="Clientes con deuda" value={String(withDebt)} icon="people" />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Button label="Por cobrar" icon="alarm" variant="accent" onPress={() => router.push('/debts')} style={{ flex: 1 }} />
        <Button label="Registrar abono" icon="cash" variant="secondary" onPress={() => router.push('/abono')} style={{ flex: 1 }} />
      </View>
      <Button label="Nuevo cliente" icon="person-add" variant="ghost" onPress={() => setCreating(true)} style={{ marginBottom: spacing.md }} />
      <Field label="Buscar cliente" value={search} onChangeText={setSearch} placeholder="Nombre o celular" />
      <View style={{ gap: spacing.sm }}>
        {list.map((c) => (
          <CustomerRow key={c.id} customer={c} onPress={() => router.push(`/customers/${c.id}`)} />
        ))}
        {list.length === 0 && <Empty icon="people" text="Aún no hay clientes. Crea uno para anotar sus fiados." />}
      </View>
      <CustomerPicker
        visible={creating}
        onClose={() => setCreating(false)}
        onSelect={(c) => {
          setCreating(false);
          router.push(`/customers/${c.id}`);
        }}
      />
    </Screen>
  );
}
