import { formatSoles } from './money.js';
import type { Cents, PaymentInput, PaymentMethod } from './types.js';
import { PAYMENT_METHOD_LABELS, QR_METHODS } from './types.js';

export interface PaymentCheck {
  ok: boolean;
  errors: string[];
  /** Suma de lo asignado a cada método. */
  assignedCents: Cents;
  /** Lo que falta asignar (negativo si se asignó de más). */
  remainingCents: Cents;
  /** Vuelto a entregar: lo que el cliente dio en efectivo por encima de su parte. */
  changeCents: Cents;
  /** Parte que se cobra con QR (Yape/Plin) y aún necesita confirmación. */
  qrPendingCents: Cents;
}

export interface PaymentRules {
  hasCustomer: boolean;
  /** Si se valida para registrar (true) o solo para mostrar el estado en pantalla. */
  final: boolean;
}

/**
 * Valida un pago mixto. Ejemplo real: total S/ 50, el cliente da un billete
 * de S/ 50 para cubrir S/ 30 en efectivo y paga S/ 20 por Yape:
 *   [{CASH, amount 3000, tendered 5000}, {YAPE, amount 2000}] => vuelto S/ 20.
 */
export function checkPayments(
  totalCents: Cents,
  payments: PaymentInput[],
  rules: PaymentRules = { hasCustomer: false, final: true },
): PaymentCheck {
  const errors: string[] = [];
  let assigned = 0;
  let change = 0;
  let qrPending = 0;
  const seen = new Set<PaymentMethod>();

  if (payments.length === 0) errors.push('Elige cómo paga el cliente.');

  for (const p of payments) {
    const label = PAYMENT_METHOD_LABELS[p.method];
    if (seen.has(p.method)) errors.push(`${label} aparece dos veces. Junta los montos en uno.`);
    seen.add(p.method);

    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
      errors.push(`Ingresa el monto de ${label}.`);
      continue;
    }
    assigned += p.amountCents;

    if (p.method === 'CASH') {
      const tendered = p.tenderedCents ?? p.amountCents;
      if (tendered < p.amountCents) {
        errors.push(`El efectivo recibido (${formatSoles(tendered)}) no alcanza para ${formatSoles(p.amountCents)}.`);
      } else {
        change += tendered - p.amountCents;
      }
    } else if (p.tenderedCents !== undefined && p.tenderedCents !== p.amountCents) {
      errors.push(`Solo el efectivo puede dar vuelto.`);
    }

    if (p.method === 'FIADO' && !rules.hasCustomer) {
      errors.push('Para fiar, elige al cliente.');
    }

    if (QR_METHODS.includes(p.method)) {
      const confirmed = p.confirmation === 'MANUAL' || (p.confirmation === 'QR' && !!p.chargeId);
      if (!confirmed) {
        qrPending += p.amountCents;
        if (rules.final) errors.push(`Falta confirmar el pago por ${label}.`);
      }
    }
  }

  const remaining = totalCents - assigned;
  if (remaining > 0) errors.push(`Faltan ${formatSoles(remaining)} por cobrar.`);
  if (remaining < 0) {
    errors.push(
      `Se asignó ${formatSoles(-remaining)} de más. Si el cliente dio más efectivo, ponlo en "Recibido".`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    assignedCents: assigned,
    remainingCents: remaining,
    changeCents: change,
    qrPendingCents: qrPending,
  };
}

/**
 * Cuando el vendedor agrega un segundo método, se le propone el saldo que
 * falta para que no tenga que calcularlo.
 */
export function suggestNextAmount(totalCents: Cents, payments: PaymentInput[]): Cents {
  const assigned = payments.reduce((sum, p) => sum + (p.amountCents > 0 ? p.amountCents : 0), 0);
  return Math.max(0, totalCents - assigned);
}

/** Billetes y monedas frecuentes para los botones de "Recibido" rápido. */
export function quickCashOptions(amountCents: Cents): Cents[] {
  const denominations = [1000, 2000, 5000, 10000, 20000];
  const options = new Set<Cents>([amountCents]);
  const nextSol = Math.ceil(amountCents / 100) * 100;
  if (nextSol > amountCents) options.add(nextSol);
  const nextFive = Math.ceil(amountCents / 500) * 500;
  if (nextFive > amountCents) options.add(nextFive);
  for (const d of denominations) {
    if (d > amountCents) options.add(d);
  }
  return [...options].sort((a, b) => a - b).slice(0, 5);
}

/** "Efectivo: S/ 30.00 / Yape: S/ 20.00". */
export function describePayments(payments: { method: PaymentMethod; amountCents: Cents }[]): string {
  return payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method]}: ${formatSoles(p.amountCents)}`).join(' / ');
}
