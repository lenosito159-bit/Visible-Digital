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
  /** Vuelto total a entregar en efectivo. */
  changeCents: Cents;
  /** Parte del vuelto que sale de un Yape/Plin pagado de más ("te yapeo 40, dame el vuelto"). */
  digitalChangeCents: Cents;
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
  let digitalChange = 0;
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
    } else if (QR_METHODS.includes(p.method) && p.tenderedCents !== undefined && p.tenderedCents !== p.amountCents) {
      // El cliente yapeó más de lo que le tocaba: el vuelto se le da en efectivo.
      if (p.tenderedCents < p.amountCents) {
        errors.push(`Lo que te ${label === 'Yape' ? 'yapeó' : 'pagó por Plin'} (${formatSoles(p.tenderedCents)}) no alcanza para ${formatSoles(p.amountCents)}.`);
      } else {
        digitalChange += p.tenderedCents - p.amountCents;
      }
    } else if (p.tenderedCents !== undefined && p.tenderedCents !== p.amountCents) {
      errors.push(`${label} no da vuelto: pon el monto exacto.`);
    }

    if (p.method === 'FIADO' && !rules.hasCustomer) {
      errors.push('Para fiar, elige al cliente.');
    }

    if (QR_METHODS.includes(p.method)) {
      const confirmed = p.confirmation === 'MANUAL' || (p.confirmation === 'QR' && !!p.chargeId);
      if (!confirmed) {
        qrPending += qrAmount(p);
        if (rules.final) errors.push(`Falta confirmar el pago por ${label}.`);
      }
    }
  }

  const remaining = totalCents - assigned;
  if (remaining > 0) errors.push(`Faltan ${formatSoles(remaining)} por cobrar.`);
  if (remaining < 0) {
    errors.push(`Te sobran ${formatSoles(-remaining)}: revisa los montos. Si te dieron más plata, ponlo en "¿Con cuánto paga?".`);
  }

  return {
    ok: errors.length === 0,
    errors,
    assignedCents: assigned,
    remainingCents: remaining,
    changeCents: change + digitalChange,
    digitalChangeCents: digitalChange,
    qrPendingCents: qrPending,
  };
}

/** Monto que se cobra por QR en una línea de Yape/Plin (incluye lo pagado de más). */
export function qrAmount(p: Pick<PaymentInput, 'amountCents' | 'tenderedCents'>): Cents {
  return p.tenderedCents !== undefined && p.tenderedCents > p.amountCents ? p.tenderedCents : p.amountCents;
}

/**
 * Reparte el "resto" cuando el vendedor cambia un monto:
 * - Con 2 métodos, el otro se ajusta ("20 en efectivo y el resto yapéame").
 * - Con 3 o más, se ajusta el último agregado ("5 con Yape y el resto apúntamelo").
 * Nunca deja montos negativos.
 */
export function rebalanceAmounts(totalCents: Cents, amounts: Cents[], editedIndex: number): Cents[] {
  const next = [...amounts];
  if (next.length < 2) return next;
  const target = next.length === 2 ? 1 - editedIndex : next.length - 1;
  if (target === editedIndex) return next;
  const others = next.reduce((sum, a, i) => (i === target ? sum : sum + Math.max(0, a)), 0);
  next[target] = Math.max(0, totalCents - others);
  return next;
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
