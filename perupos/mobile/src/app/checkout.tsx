import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DOC_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  QR_METHODS,
  SELLER_MAX_DISCOUNT_PERCENT,
  allowedDocTypes,
  checkCredit,
  checkPayments,
  computeTaxes,
  defaultDocType,
  discountNeedsAdmin,
  formatSoles,
  lineTotal,
  parseSoles,
  qrAmount,
  quickCashOptions,
  rebalanceAmounts,
  validateBuyer,
  type Customer,
  type DocType,
  type IdentityDocType,
  type PaymentInput,
  type PaymentMethod,
  type SaleInput,
} from '@perupos/shared';
import { AuthorizeModal } from '@/components/AuthorizeModal';
import { CustomerPicker } from '@/components/CustomerPicker';
import { QrPaymentModal } from '@/components/QrPaymentModal';
import { Banner, Button, Chip, Field, Screen, type IconName } from '@/components/ui';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cart, useCart } from '@/lib/cart';
import { buildLocalSale } from '@/lib/sale';
import { registerSale, useSyncState } from '@/lib/sync';
import { colors, font, shared, spacing } from '@/theme';

interface Line {
  key: string;
  method: PaymentMethod;
  amount: string;
  tendered: string;
  /** Solo Yape/Plin: el cliente pagó más y se le da vuelto en efectivo. */
  overpay?: boolean;
  confirmation?: 'QR' | 'MANUAL';
  chargeId?: string;
  reference?: string;
}

const METHOD_ICONS: Record<PaymentMethod, IconName> = {
  CASH: 'cash',
  YAPE: 'phone-portrait',
  PLIN: 'phone-portrait',
  TRANSFER: 'swap-horizontal',
  CARD: 'card',
  FIADO: 'book',
};
const METHOD_COLORS: Record<PaymentMethod, string> = {
  CASH: colors.primaryDark,
  YAPE: colors.yape,
  PLIN: '#007C88',
  TRANSFER: colors.secondary,
  CARD: '#374151',
  FIADO: '#92400E',
};

const toText = (cents: number) => (cents / 100).toFixed(2);
const cents = (text: string) => parseSoles(text) ?? 0;

function toPayments(lines: Line[]): PaymentInput[] {
  return lines.map((l) => {
    const tendered =
      l.tendered && (l.method === 'CASH' || (QR_METHODS.includes(l.method) && l.overpay)) ? cents(l.tendered) : undefined;
    return {
      method: l.method,
      amountCents: cents(l.amount),
      tenderedCents: tendered,
      confirmation: l.confirmation,
      chargeId: l.chargeId,
      reference: l.reference,
    };
  });
}

/** Pantalla de cobro con pago mixto: efectivo + Yape/Plin + fiado en una sola venta. */
export default function Checkout() {
  const { user, settings, can } = useAuth();
  const { online } = useSyncState();
  const { lines: cartLines } = useCart();
  const [saleId] = useState(() => Crypto.randomUUID());
  const regime = settings?.taxRegime ?? 'RMT';

  const [docType, setDocType] = useState<DocType>(defaultDocType(regime));
  const [buyerDoc, setBuyerDoc] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [discountText, setDiscountText] = useState('');
  const [discountToken, setDiscountToken] = useState<string | null>(null);
  const [creditToken, setCreditToken] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickCustomer, setPickCustomer] = useState(false);
  const [authorize, setAuthorize] = useState<null | 'DISCOUNT' | 'CREDIT'>(null);
  const [qrLine, setQrLine] = useState<Line | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const subtotalCents = cartLines.reduce((s, l) => s + lineTotal(l.product.priceCents, l.quantity), 0);
  const discountCents = Math.min(cents(discountText), subtotalCents);
  const taxes = useMemo(
    () =>
      computeTaxes(
        cartLines.map((l) => ({ totalCents: lineTotal(l.product.priceCents, l.quantity), taxAffectation: l.product.taxAffectation })),
        discountCents,
        regime,
        settings?.igvRate,
      ),
    [cartLines, discountCents, regime, settings?.igvRate],
  );
  const total = taxes.totalCents;

  const [lines, setLines] = useState<Line[]>([{ key: 'l0', method: 'CASH', amount: toText(total), tendered: '' }]);

  // Con un solo método, su monto sigue al total (por ejemplo, al aplicar un descuento).
  useEffect(() => {
    setLines((ls) => (ls.length === 1 ? [{ ...ls[0]!, amount: toText(total) }] : ls));
  }, [total]);

  const payments = toPayments(lines);
  const check = checkPayments(total, payments, { hasCustomer: !!customer, final: false });
  const fiado = payments.find((p) => p.method === 'FIADO');
  const credit = customer && fiado ? checkCredit(customer.balanceCents, customer.creditLimitCents, fiado.amountCents) : null;
  const needsDiscountAuth = !!user && discountCents > 0 && discountNeedsAdmin(user.role, discountCents, subtotalCents);

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((ls) => {
      const reset = { confirmation: undefined, chargeId: undefined, reference: undefined };
      let next = ls.map((l) => (l.key === key ? { ...l, ...patch, ...(patch.method || patch.amount !== undefined || patch.tendered !== undefined || patch.overpay !== undefined ? reset : {}) } : l));
      // "20 en efectivo y el resto yapéame": el resto va al último método agregado.
      if (patch.amount !== undefined) {
        const index = next.findIndex((l) => l.key === key);
        const amounts = rebalanceAmounts(total, next.map((l) => cents(l.amount)), index);
        // Un Yape/Plin ya cobrado no se toca.
        next = next.map((l, i) =>
          i === index || l.confirmation || amounts[i] === cents(l.amount) ? l : { ...l, amount: toText(amounts[i]!), ...reset },
        );
      }
      return next;
    });
  };

  const addMethod = () => {
    const used = new Set(lines.map((l) => l.method));
    const method = (['YAPE', 'CASH', 'PLIN', 'FIADO', 'CARD', 'TRANSFER'] as PaymentMethod[]).find((m) => !used.has(m)) ?? 'TRANSFER';
    const remaining = Math.max(0, total - payments.reduce((s, p) => s + p.amountCents, 0));
    setLines((ls) => [...ls, { key: `l${Date.now()}`, method, amount: toText(remaining), tendered: '' }]);
  };

  const docTypes = allowedDocTypes(regime);
  const buyerDocType: IdentityDocType = docType === 'FACTURA' ? 'RUC' : buyerDoc.length === 11 ? 'RUC' : buyerDoc.length === 8 ? 'DNI' : buyerDoc ? 'CE' : 'NONE';
  const buyer = buyerDoc ? { docType: buyerDocType, docNumber: buyerDoc, name: buyerName } : undefined;

  const pay = async (current: Line[] = lines) => {
    setError(null);
    const currentPayments = toPayments(current);
    const pre = checkPayments(total, currentPayments, { hasCustomer: !!customer, final: false });
    if (!pre.ok) return setError(pre.errors[0] ?? 'Revisa los montos.');
    const buyerError = validateBuyer(docType, total, buyer);
    if (buyerError) return setError(buyerError);
    if (needsDiscountAuth && !discountToken) return setAuthorize('DISCOUNT');
    if (credit?.exceedsLimit && user?.role !== 'ADMIN' && !creditToken) return setAuthorize('CREDIT');

    // Cobros con QR pendientes: se muestran uno por uno.
    const pendingQr = current.find((l) => QR_METHODS.includes(l.method) && !l.confirmation);
    if (pendingQr) return setQrLine(pendingQr);

    setSaving(true);
    try {
      const input: SaleInput = {
        id: saleId,
        createdAt: new Date().toISOString(),
        items: cartLines.map((l) => ({ productId: l.product.id, quantity: l.quantity, unitPriceCents: l.product.priceCents })),
        payments: currentPayments,
        discountCents,
        customerId: customer?.id ?? null,
        docType,
        buyer,
        authorizationToken: discountToken ?? creditToken ?? undefined,
      };
      const local = buildLocalSale(input, cartLines, settings!, user!, customer?.name ?? null);
      const sale = await registerSale(input, local);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      cart.clear();
      router.dismissTo('/pos');
      router.push(`/receipt/${sale.id}`);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'LIMITE_CREDITO') setCreditToken(null);
    } finally {
      setSaving(false);
    }
  };

  const onQrDone = (patch: Partial<Line>) => {
    if (!qrLine) return;
    const next = lines.map((l) => (l.key === qrLine.key ? { ...l, ...patch } : l));
    setLines(next);
    setQrLine(null);
    void pay(next);
  };

  if (!settings || !user) return null;
  if (cartLines.length === 0) {
    return (
      <Screen>
        <Banner text="El carrito está vacío." />
        <Button label="Volver a la venta" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <View style={{ gap: spacing.sm }}>
          {error && <Banner tone="danger" text={error} />}
          <Button label={`Cobrar ${formatSoles(total)}`} icon="checkmark-circle" big onPress={() => pay()} loading={saving} />
        </View>
      }
    >
      <View style={styles.totalBox}>
        <Text style={styles.totalLabel}>Total a pagar</Text>
        <Text style={styles.total}>{formatSoles(total)}</Text>
        {regime !== 'NRUS' && taxes.igvCents > 0 && <Text style={styles.igv}>Incluye IGV {formatSoles(taxes.igvCents)}</Text>}
        {discountCents > 0 && <Text style={styles.igv}>Descuento {formatSoles(discountCents)} (antes {formatSoles(subtotalCents)})</Text>}
      </View>

      {/* ---- Métodos de pago ---- */}
      <Text style={shared.sectionTitle}>¿Cómo paga?</Text>
      {lines.map((line) => {
        const used = new Set(lines.filter((l) => l.key !== line.key).map((l) => l.method));
        const amount = cents(line.amount);
        const tendered = cents(line.tendered);
        return (
          <View key={line.key} style={[shared.card, { marginBottom: spacing.md, gap: spacing.sm }]}>
            <View style={styles.methodRow}>
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[])
                .filter((m) => !used.has(m))
                .map((m) => (
                  <Chip
                    key={m}
                    label={PAYMENT_METHOD_LABELS[m]}
                    icon={METHOD_ICONS[m]}
                    color={METHOD_COLORS[m]}
                    selected={line.method === m}
                    onPress={() => updateLine(line.key, { method: m, tendered: '' })}
                  />
                ))}
            </View>
            <View style={styles.amountRow}>
              <Text style={styles.amountLabel}>Monto</Text>
              <TextInput
                value={line.amount}
                onChangeText={(t) => updateLine(line.key, { amount: t })}
                keyboardType="decimal-pad"
                selectTextOnFocus
                style={[shared.input, styles.amountInput]}
                accessibilityLabel={`Monto en ${PAYMENT_METHOD_LABELS[line.method]}`}
              />
              {lines.length > 1 && (
                <Pressable accessibilityLabel="Quitar método" onPress={() => setLines((ls) => ls.filter((l) => l.key !== line.key))} style={styles.remove}>
                  <Ionicons name="trash" size={24} color={colors.danger} />
                </Pressable>
              )}
            </View>

            {line.method === 'CASH' && amount > 0 && (
              <>
                <Text style={shared.label}>¿Con cuánto paga?</Text>
                <View style={styles.methodRow}>
                  {quickCashOptions(amount).map((opt) => (
                    <Chip key={opt} label={opt === amount ? 'Exacto' : formatSoles(opt)} selected={(tendered || amount) === opt} onPress={() => updateLine(line.key, { tendered: toText(opt) })} />
                  ))}
                </View>
                <TextInput
                  value={line.tendered}
                  onChangeText={(t) => updateLine(line.key, { tendered: t })}
                  keyboardType="decimal-pad"
                  placeholder="Otro monto recibido"
                  placeholderTextColor={colors.textMuted}
                  style={shared.input}
                />
                {tendered > amount && (
                  <View style={styles.change}>
                    <Text style={styles.changeLabel}>VUELTO</Text>
                    <Text style={styles.changeValue}>{formatSoles(tendered - amount)}</Text>
                  </View>
                )}
              </>
            )}

            {QR_METHODS.includes(line.method) && (
              <View style={{ gap: spacing.sm }}>
                <Chip
                  label={line.method === 'YAPE' ? 'Me yapeó más: dar vuelto' : 'Me plineó más: dar vuelto'}
                  icon="swap-vertical"
                  selected={!!line.overpay}
                  onPress={() => updateLine(line.key, { overpay: !line.overpay, tendered: '' })}
                />
                {line.overpay && (
                  <>
                    <TextInput
                      value={line.tendered}
                      onChangeText={(t) => updateLine(line.key, { tendered: t })}
                      keyboardType="decimal-pad"
                      placeholder={line.method === 'YAPE' ? '¿Cuánto te yapeó?' : '¿Cuánto te plineó?'}
                      placeholderTextColor={colors.textMuted}
                      style={shared.input}
                    />
                    {tendered > amount && (
                      <View style={styles.change}>
                        <Text style={styles.changeLabel}>VUELTO EN EFECTIVO</Text>
                        <Text style={styles.changeValue}>{formatSoles(tendered - amount)}</Text>
                      </View>
                    )}
                  </>
                )}
                <Banner
                  tone={line.confirmation ? 'success' : 'info'}
                  text={
                    line.confirmation === 'QR'
                      ? 'Ya pagó por QR.'
                      : line.confirmation === 'MANUAL'
                        ? `Ya te llegó (confirmado a mano${line.reference ? `, operación ${line.reference}` : ''}).`
                        : online
                          ? `Al cobrar sale un QR por ${formatSoles(line.overpay && tendered > amount ? tendered : amount)} que sirve para Yape y Plin.`
                          : 'No hay señal: que te yapee a tu QR del mostrador y revisa que te llegue.'
                  }
                />
              </View>
            )}

            {line.method === 'FIADO' && (
              <View style={{ gap: spacing.sm }}>
                <Button
                  label={customer ? `Cliente: ${customer.name}` : 'Elegir cliente'}
                  icon="person"
                  variant={customer ? 'ghost' : 'accent'}
                  onPress={() => setPickCustomer(true)}
                />
                {credit && (
                  <Banner
                    tone={credit.exceedsLimit ? 'danger' : credit.nearLimit ? 'warning' : 'info'}
                    text={
                      credit.exceedsLimit
                        ? `Supera su límite (${formatSoles(customer!.creditLimitCents)}). Deberá ${formatSoles(credit.newBalanceCents)}. ${creditToken ? 'Autorizado por el Administrador.' : 'Necesita autorización del Administrador.'}`
                        : `Deberá ${formatSoles(credit.newBalanceCents)} de ${formatSoles(customer!.creditLimitCents)}.`
                    }
                  />
                )}
              </View>
            )}
          </View>
        );
      })}
      {lines.length < 4 && <Button label="+ Agregar otro método" variant="ghost" icon="add-circle" onPress={addMethod} />}

      <View style={styles.summary}>
        {check.remainingCents !== 0 && (
          <Text style={[styles.summaryText, { color: colors.danger }]}>
            {check.remainingCents > 0 ? `Falta asignar ${formatSoles(check.remainingCents)}` : `Sobran ${formatSoles(-check.remainingCents)}`}
          </Text>
        )}
        {check.changeCents > 0 && <Text style={[styles.summaryText, { color: colors.primaryDark }]}>Vuelto total: {formatSoles(check.changeCents)}</Text>}
      </View>

      {/* ---- Descuento ---- */}
      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Descuento</Text>
      <View style={styles.methodRow}>
        <Chip label="Sin descuento" selected={discountCents === 0} onPress={() => setDiscountText('')} />
        {[5, 10].map((pct) => {
          const value = Math.round((subtotalCents * pct) / 100);
          return <Chip key={pct} label={`${pct}%`} selected={discountCents === value && value > 0} onPress={() => { setDiscountText(toText(value)); setDiscountToken(null); }} />;
        })}
      </View>
      <Field label="Otro monto de descuento (S/)" value={discountText} onChangeText={(t) => { setDiscountText(t); setDiscountToken(null); }} keyboardType="decimal-pad" placeholder="0.00" />
      {needsDiscountAuth && (
        <Banner
          tone={discountToken ? 'success' : 'warning'}
          text={discountToken ? 'Descuento autorizado por el Administrador.' : `Más de ${SELLER_MAX_DISCOUNT_PERCENT}% necesita autorización del Administrador.`}
        />
      )}

      {/* ---- Comprobante ---- */}
      <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>Comprobante</Text>
      <View style={styles.methodRow}>
        {docTypes.map((d) => (
          <Chip key={d} label={DOC_TYPE_LABELS[d]} selected={docType === d} onPress={() => setDocType(d)} />
        ))}
      </View>
      {(docType === 'FACTURA' || docType === 'BOLETA') && (
        <View style={{ marginTop: spacing.md }}>
          <Field
            label={docType === 'FACTURA' ? 'RUC del cliente' : 'DNI del cliente (obligatorio si pasa de S/ 700)'}
            value={buyerDoc}
            onChangeText={(t) => setBuyerDoc(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={docType === 'FACTURA' ? 11 : 12}
          />
          {buyerDoc ? <Field label={docType === 'FACTURA' ? 'Razón social' : 'Nombre'} value={buyerName} onChangeText={setBuyerName} /> : null}
        </View>
      )}

      <CustomerPicker
        visible={pickCustomer}
        onClose={() => setPickCustomer(false)}
        onSelect={(c) => {
          setCustomer(c);
          setCreditToken(null);
          setPickCustomer(false);
        }}
      />
      <AuthorizeModal
        visible={authorize !== null}
        purpose={authorize ?? 'DISCOUNT'}
        saleId={saleId}
        reason={
          authorize === 'CREDIT'
            ? `${customer?.name ?? 'El cliente'} superaría su límite de fiado.`
            : `Descuento de ${formatSoles(discountCents)} sobre ${formatSoles(subtotalCents)}.`
        }
        onClose={() => setAuthorize(null)}
        onAuthorized={(token) => {
          if (authorize === 'CREDIT') setCreditToken(token);
          else setDiscountToken(token);
          setAuthorize(null);
        }}
      />
      {qrLine && (
        <QrPaymentModal
          visible
          amountCents={qrAmount(toPayments([qrLine])[0]!)}
          reference={saleId}
          onPaid={(chargeId) => onQrDone({ confirmation: 'QR', chargeId })}
          onManual={(reference) => onQrDone({ confirmation: 'MANUAL', reference })}
          onCancel={() => setQrLine(null)}
        />
      )}
      {!can('sales.create') && <Banner tone="danger" text="Tu rol no puede registrar ventas." />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  totalBox: { backgroundColor: colors.secondary, borderRadius: 18, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  totalLabel: { color: '#FFFFFF', fontSize: font.body, fontWeight: '700' },
  total: { color: '#FFFFFF', fontSize: 48, fontWeight: '900' },
  igv: { color: '#E5E7EB', fontSize: font.small, fontWeight: '600' },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  amountLabel: { fontSize: font.body, fontWeight: '800', color: colors.textMuted },
  amountInput: { flex: 1, fontSize: font.title, fontWeight: '900' },
  remove: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  change: { backgroundColor: colors.primarySoft, borderRadius: 12, padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeLabel: { fontSize: font.large, fontWeight: '900', color: colors.primaryDark },
  changeValue: { fontSize: font.huge, fontWeight: '900', color: colors.primaryDark },
  summary: { marginTop: spacing.md, gap: 4 },
  summaryText: { fontSize: font.large, fontWeight: '800', textAlign: 'center' },
});
