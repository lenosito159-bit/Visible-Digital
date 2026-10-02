import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { TAX_REGIME_LABELS, TAX_REGIMES, isValidRuc, parseSoles, type BusinessSettings, type TaxRegime } from '@perupos/shared';
import { Banner, Button, Chip, Field, Loading, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { syncNow } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

interface BankAccount {
  id: string;
  bank: string;
  accountType: 'AHORROS' | 'CORRIENTE';
  accountNumber: string;
  cci: string | null;
  holder: string;
  active: boolean;
}

interface Integrations {
  payments: { provider: string; environment: string; webhookConfigured: boolean };
  pse: { provider: string };
  push: { enabled: boolean };
}

const soles = (c: number) => (c / 100).toFixed(2);

/** Datos del negocio, régimen tributario, Yape/Plin y cuentas bancarias (solo Admin). */
export default function Settings() {
  const [s, setS] = useState<BusinessSettings | null>(null);
  const [text, setText] = useState({ cashLow: '', creditLimit: '' });
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [rucCheck, setRucCheck] = useState<{ ok: boolean; source: string; message: string } | null>(null);
  const [bank, setBank] = useState({ bank: '', accountNumber: '', cci: '', holder: '' });
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    api.get<BusinessSettings>('/settings').then((data) => {
      setS(data);
      setText({ cashLow: soles(data.cashLowThresholdCents), creditLimit: soles(data.defaultCreditLimitCents) });
    }).catch((e) => setMessage({ tone: 'danger', text: errorMessage(e) }));
    api.get<BankAccount[]>('/bank-accounts').then(setBanks).catch(() => {});
    api.get<Integrations>('/settings/integrations').then(setIntegrations).catch(() => {});
  }, []);

  const ruc = s?.ruc;
  useEffect(() => {
    if (!ruc || ruc.length !== 11) return setRucCheck(null);
    api.get<{ ok: boolean; source: string; message: string }>(`/ruc/${ruc}`).then(setRucCheck).catch(() => setRucCheck(null));
  }, [ruc]);

  if (!s) return message ? <Screen><Banner tone="danger" text={message.text} /></Screen> : <Loading />;
  const set = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    setMessage(null);
    if (!isValidRuc(s.ruc)) return setMessage({ tone: 'danger', text: 'El RUC no es válido. Revisa los 11 dígitos.' });
    try {
      const saved = await api.put<BusinessSettings>('/settings', {
        ...s,
        cashLowThresholdCents: parseSoles(text.cashLow) ?? s.cashLowThresholdCents,
        defaultCreditLimitCents: parseSoles(text.creditLimit) ?? s.defaultCreditLimitCents,
      });
      setS(saved);
      await syncNow();
      setMessage({ tone: 'success', text: 'Datos guardados.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  const addBank = async () => {
    try {
      const created = await api.post<BankAccount>('/bank-accounts', { ...bank, cci: bank.cci || null, accountType: 'AHORROS' });
      setBanks([...banks, created]);
      setBank({ bank: '', accountNumber: '', cci: '', holder: '' });
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err) });
    }
  };

  return (
    <Screen footer={<Button label="Guardar" icon="save" big onPress={save} />}>
      <Text style={shared.sectionTitle}>Datos para SUNAT</Text>
      <Field label="RUC" value={s.ruc} onChangeText={(v) => set('ruc', v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={11} error={s.ruc.length === 11 && !isValidRuc(s.ruc) ? 'RUC inválido' : null} />
      {rucCheck && <Banner tone={rucCheck.source === 'NO_VERIFICADO' ? 'info' : rucCheck.ok ? 'success' : 'warning'} text={rucCheck.message} />}
      <Field label="Razón social" value={s.razonSocial} onChangeText={(v) => set('razonSocial', v)} />
      <Field label="Nombre comercial (el que ve el cliente)" value={s.nombreComercial} onChangeText={(v) => set('nombreComercial', v)} />
      <Field label="Dirección" value={s.direccion} onChangeText={(v) => set('direccion', v)} />
      <Field label="Teléfono" value={s.phone ?? ''} onChangeText={(v) => set('phone', v || null)} keyboardType="phone-pad" />
      <Text style={shared.label}>Régimen tributario</Text>
      <View style={styles.chips}>
        {TAX_REGIMES.map((r) => (
          <Chip key={r} label={TAX_REGIME_LABELS[r]} selected={s.taxRegime === r} onPress={() => set('taxRegime', r as TaxRegime)} />
        ))}
      </View>
      <Banner
        text={
          s.taxRegime === 'NRUS'
            ? 'Nuevo RUS: emites tickets POS o notas de venta, sin IGV separado. No puedes emitir facturas.'
            : 'Emites boletas y facturas electrónicas con IGV 18% a través de tu PSE.'
        }
      />
      <Field label="Mensaje al pie del ticket" value={s.receiptFooter ?? ''} onChangeText={(v) => set('receiptFooter', v || null)} placeholder="Ej. No se aceptan devoluciones de productos refrigerados" />

      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Yape y Plin (QR interoperable)</Text>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Cobrar con QR de Yape/Plin</Text>
        <Switch value={s.yapePlinEnabled} onValueChange={(v) => set('yapePlinEnabled', v)} trackColor={{ true: colors.primary }} />
      </View>
      {integrations && (
        <Banner
          tone={integrations.payments.provider === 'taypi' ? 'success' : 'warning'}
          text={
            integrations.payments.provider === 'taypi'
              ? `Conectado a TAYPI (${integrations.payments.environment}).${integrations.payments.webhookConfigured ? '' : ' Falta configurar el webhook.'}`
              : 'Modo de prueba: los QR no cobran de verdad. Configura las llaves de TAYPI en el servidor.'
          }
        />
      )}
      {integrations && <Text style={styles.meta}>Comprobantes electrónicos: {integrations.pse.provider === 'mock' ? 'modo de prueba' : integrations.pse.provider}</Text>}

      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Alertas y fiado</Text>
      <Field label="Avisar si en caja hay menos de (S/)" value={text.cashLow} onChangeText={(v) => setText({ ...text, cashLow: v })} keyboardType="decimal-pad" />
      <Field label="Límite de fiado para clientes nuevos (S/)" value={text.creditLimit} onChangeText={(v) => setText({ ...text, creditLimit: v })} keyboardType="decimal-pad" />
      <Field label="Deuda vencida después de (días)" value={String(s.overdueDays)} onChangeText={(v) => set('overdueDays', Number(v) || 0)} keyboardType="number-pad" />
      <Field label="Producto sin movimiento después de (días)" value={String(s.staleProductDays)} onChangeText={(v) => set('staleProductDays', Number(v) || 0)} keyboardType="number-pad" />

      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Cuentas bancarias</Text>
      {banks.map((b) => (
        <View key={b.id} style={[shared.card, { marginBottom: spacing.sm }]}>
          <Text style={styles.bankName}>{b.bank} · {b.accountNumber}</Text>
          <Text style={styles.meta}>{b.holder}{b.cci ? ` · CCI ${b.cci}` : ''}</Text>
        </View>
      ))}
      <Field label="Banco" value={bank.bank} onChangeText={(v) => setBank({ ...bank, bank: v })} placeholder="BCP, Interbank, BBVA..." />
      <Field label="Número de cuenta" value={bank.accountNumber} onChangeText={(v) => setBank({ ...bank, accountNumber: v })} keyboardType="number-pad" />
      <Field label="CCI (20 dígitos)" value={bank.cci} onChangeText={(v) => setBank({ ...bank, cci: v.replace(/\D/g, '') })} keyboardType="number-pad" maxLength={20} />
      <Field label="Titular" value={bank.holder} onChangeText={(v) => setBank({ ...bank, holder: v })} />
      <Button label="Agregar cuenta" variant="ghost" icon="add" onPress={addBank} disabled={!bank.bank || !bank.accountNumber || !bank.holder} />
      {message && <View style={{ marginTop: spacing.md }}><Banner tone={message.tone} text={message.text} /></View>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, marginBottom: spacing.sm },
  switchLabel: { fontSize: font.body, fontWeight: '700', color: colors.text, flex: 1 },
  meta: { fontSize: font.small, color: colors.textMuted },
  bankName: { fontSize: font.body, fontWeight: '800', color: colors.text },
});
