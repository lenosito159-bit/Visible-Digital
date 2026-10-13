import { formatSoles } from '../money.js';
import { QR_METHODS, type AbonoInput, type AbonoReceipt, type PaymentMethod } from '../types.js';
import { refreshCustomerDebt } from './customers.js';
import { LocalError, requirePermission, type Actor, type LocalCrypto, type LocalDb } from './db.js';
import { claimOperationRef, requireManualConfirmation } from './sales.js';

/** Constancia de un abono, con el saldo que quedó. */
export async function getAbonoReceipt(db: LocalDb, id: string): Promise<(AbonoReceipt & { confirmation: 'MANUAL' | null; reference: string | null }) | null> {
  const row = await db.get<{
    id: string; customer_id: string; customer_name: string; amount_cents: number; method: PaymentMethod;
    balance_after_cents: number; user_name: string; created_at: string; confirmation: 'MANUAL' | null; reference: string | null;
  }>(
    `SELECT m.*, c.name AS customer_name FROM credit_movements m JOIN customers c ON c.id = m.customer_id
      WHERE m.id = ? AND m.kind = 'ABONO'`,
    id,
  );
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amountCents: row.amount_cents,
    method: row.method,
    previousBalanceCents: row.balance_after_cents + row.amount_cents,
    balanceCents: row.balance_after_cents,
    userName: row.user_name,
    createdAt: row.created_at,
    confirmation: row.confirmation,
    reference: row.reference,
  };
}

/**
 * "Te abono 20 de los 45": resta de la deuda. Todo o nada, y reintentar con
 * el mismo id devuelve la misma constancia sin volver a descontar.
 */
export async function recordAbono(
  db: LocalDb,
  c: LocalCrypto,
  input: AbonoInput,
  actor: Actor,
  now: Date = new Date(),
): Promise<AbonoReceipt & { confirmation: 'MANUAL' | null; reference: string | null }> {
  requirePermission(actor, 'credit.abono', 'Tu usuario no puede registrar abonos.');
  const previous = await getAbonoReceipt(db, input.id);
  if (previous) return previous;
  if ((input.method as PaymentMethod) === 'FIADO') throw new LocalError('PAGO_INVALIDO', 'Un abono no se paga con fiado.');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new LocalError('MONTO_INVALIDO', 'Ingresa cuánto abona.');
  }
  requireManualConfirmation(input.method, input.confirmation, input.chargeId);
  const ts = now.toISOString();

  await db.transaction(async () => {
    if (await db.get('SELECT 1 FROM credit_movements WHERE id = ?', input.id)) return;
    const customer = await db.get<{ name: string; balance_cents: number; active: number }>(
      'SELECT name, balance_cents, active FROM customers WHERE id = ?',
      input.customerId,
    );
    if (!customer) throw new LocalError('CLIENTE_NO_EXISTE', 'No se encontró al cliente.');
    if (customer.balance_cents <= 0) throw new LocalError('SIN_DEUDA', `${customer.name} no tiene deuda.`);
    if (input.amountCents > customer.balance_cents) {
      throw new LocalError(
        'ABONO_MAYOR',
        `El abono (${formatSoles(input.amountCents)}) es mayor que la deuda (${formatSoles(customer.balance_cents)}).`,
      );
    }
    const isQr = QR_METHODS.includes(input.method);
    const reference =
      isQr && input.reference?.trim() ? await claimOperationRef(db, input.method, input.reference, { movementId: input.id }) : null;
    await db.run(
      `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, sale_id, method, confirmation, reference, note,
         balance_after_cents, user_id, user_name, created_at)
       VALUES (?, ?, 'ABONO', ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      input.id, input.customerId, input.amountCents, input.method, isQr ? 'MANUAL' : null, reference,
      customer.balance_cents - input.amountCents, actor.id, actor.name, ts,
    );
    await refreshCustomerDebt(db, input.customerId, ts);
  });
  return (await getAbonoReceipt(db, input.id))!;
}
