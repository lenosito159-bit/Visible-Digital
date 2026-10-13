import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import type { Role } from '@perupos/shared';
import { Banner, Button, Chip, Field, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { shared, spacing } from '@/theme';

const TEMPLATES = [
  'Reponer arroz: quedan pocas unidades y es el producto más vendido.',
  'Hay clientes con deudas de más de 30 días. Envíales un recordatorio.',
  'Consigue sencillo: queda poco efectivo para dar vuelto.',
];

/** Notificación push del Agente Financiero al Administrador y/o al Vendedor. */
export default function SendRecommendation() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [roles, setRoles] = useState<Role[]>(['ADMIN', 'VENDEDOR']);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = (r: Role) => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]);

  const send = async () => {
    setLoading(true);
    try {
      await api.post('/notifications', { title, body, targetRoles: roles });
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen footer={<Button label="Enviar notificación" icon="send" big onPress={send} loading={loading} disabled={title.length < 3 || body.length < 3 || roles.length === 0} />}>
      <Text style={shared.label}>Para</Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Chip label="Administrador" selected={roles.includes('ADMIN')} onPress={() => toggle('ADMIN')} />
        <Chip label="Vendedor" selected={roles.includes('VENDEDOR')} onPress={() => toggle('VENDEDOR')} />
      </View>
      <Field label="Título" value={title} onChangeText={setTitle} placeholder="Ej. Reponer arroz" maxLength={80} />
      <Field label="Mensaje" value={body} onChangeText={setBody} multiline style={{ minHeight: 110, textAlignVertical: 'top' }} maxLength={400} />
      <Text style={shared.label}>Mensajes rápidos</Text>
      {TEMPLATES.map((t) => (
        <Button key={t} label={t} variant="ghost" onPress={() => setBody(t)} style={{ marginBottom: spacing.sm }} />
      ))}
      {error && <Banner tone="danger" text={error} />}
    </Screen>
  );
}
