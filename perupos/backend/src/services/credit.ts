import {
  QR_METHODS,
  formatSoles,
  type AbonoInput,
  type AbonoReceipt,
  type CreditMovement,
  type Customer,
} from '@perupos/shared';
import { audit, many, one, pool, tx, type Db } from '../db/pool.js';
import type { AuthUser } from '../http/auth.js';
import { badRequest, notFound } from '../http/errors.js';
import { iso, toCustomer } from './mappers.js';
import { consumeCharge } from './payments/charges.js';
import { claimOperationRef, normalizeReference } from './payments/operationRefs.js';

const CUSTOMER_SELECT = `
  SELECT c.*, d.balance_cents, d.last_payment_at, d.oldest_unpaid_at
    FROM customers c JOIN customer_debt d ON d.customer_id = c.id`;

export async function getCustomer(db: Db, id: string): Promise<Customer | null> {
  const row = await one(db, `${CUSTOMER_SELECT} WHERE c.id = $1`, [id]);
  return row ? toCustomer(row) : null;
}

export interface CustomerFilters {
  search?: string;
  withDebt?: boolean;
  overdueDays?: number;
  sort?: 'name' | 'amount' | 'age';
  since?: string;
}

export async function listCustomers(db: Db, f: CustomerFilters): Promise<Customer[]> {
  const params: unknown[] = [];
  const where = ['c.active'];
  if (f.search) {
    const i = params.push(`%${f.search.toLowerCase()}%`);
    where.push(`(lower(c.name) LIKE $${i} OR c.phone LIKE $${i} OR c.doc_number LIKE $${i})`);
  }
  if (f.withDebt) where.push('d.balance_cents > 0');
  if (f.overdueDays !== undefined) {
    // "Vencido": tiene deuda y pasaron N días sin abonar desde su fiado pendiente más antiguo.
    where.push(
      `d.balance_cents > 0 AND GREATEST(d.last_payment_at, d.oldest_unpaid_at) < now() - make_interval(days => $${params.push(f.overdueDays)})`,
    );
  }
  if (f.since) where.push(`c.updated_at > $${params.push(f.since)}`);
  const order =
    f.sort === 'amount'
      ? 'd.balance_cents DESC, c.name'
      : f.sort === 'age'
        ? 'd.oldest_unpaid_at ASC NULLS LAST, c.name'
        : 'c.name';
  const rows = await many(db, `${CUSTOMER_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params);
  return rows.map(toCustomer);
}

export async function getLedger(db: Db, customerId: string): Promise<CreditMovement[]> {
  const rows = await many(
    db,
    `SELECT m.*, u.name AS user_name FROM credit_movements m JOIN users u ON u.id = m.user_id
      WHERE m.customer_id = $1 ORDER BY m.created_at DESC, m.received_at DESC`,
    [customerId],
  );
  return rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    kind: r.kind,
    amountCents: r.amount_cents,
    saleId: r.sale_id,
    method: r.method,
    userName: r.user_name,
    note: r.note,
    createdAt: iso(r.created_at),
  }));
}

/**
 * Registra un abono: resta de la deuda y devuelve la constancia con el saldo.
 * Es idempotente por id (el teléfono puede reenviarlo sin duplicar).
 */
export async function createAbono(user: AuthUser, input: AbonoInput): Promise<AbonoReceipt> {
  const previous = await abonoReceipt(pool, input.id);
  if (previous) return previous;

  return tx(async (db) => {
    const customer = await one(
      db,
      `SELECT c.*, d.balance_cents FROM customers c JOIN customer_debt d ON d.customer_id = c.id
        WHERE c.id = $1 FOR UPDATE OF c`,
      [input.customerId],
    );
    if (!customer) throw notFound('No se encontró al cliente.');
    if (customer.balance_cents <= 0) throw badRequest(`${customer.name} no tiene deuda.`, 'SIN_DEUDA');
    if (input.amountCents > customer.balance_cents) {
      throw badRequest(
        `El abono (${formatSoles(input.amountCents)}) es mayor que la deuda (${formatSoles(customer.balance_cents)}).`,
        'ABONO_MAYOR',
      );
    }
    let method = input.method;
    const isQr = QR_METHODS.includes(input.method);
    if (isQr && input.confirmation === 'QR') {
      if (!input.chargeId) throw badRequest('Falta el pago por QR.');
      const { wallet } = await consumeCharge(db, input.chargeId, input.amountCents);
      if (wallet?.toUpperCase().includes('PLIN')) method = 'PLIN';
      else if (wallet?.toUpperCase().includes('YAPE')) method = 'YAPE';
    } else if (isQr && input.confirmation !== 'MANUAL') {
      throw badRequest('Falta confirmar el pago por Yape/Plin.', 'PAGO_INVALIDO');
    }
    const manualRef = isQr && input.confirmation === 'MANUAL' && input.reference?.trim() ? input.reference.trim() : null;
    await db.query(
      `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, method, confirmation, charge_id, reference, user_id, created_at)
       VALUES ($1, $2, 'ABONO', $3, $4, $5, $6, $7, $8, LEAST($9::timestamptz, now()))`,
      [
        input.id,
        input.customerId,
        input.amountCents,
        method,
        isQr ? (input.confirmation ?? null) : null,
        isQr && input.confirmation === 'QR' ? input.chargeId : null,
        manualRef ? normalizeReference(manualRef) : null,
        user.id,
        input.createdAt,
      ],
    );
    if (manualRef) await claimOperationRef(db, input.method, manualRef, { movementId: input.id });
    if (isQr && input.confirmation === 'MANUAL') {
      await audit(db, user.id, 'PAGO_DIGITAL_MANUAL', 'abono', input.id, { method, amountCents: input.amountCents, reference: manualRef });
    }
    return (await abonoReceipt(db, input.id))!;
  });
}

async function abonoReceipt(db: Db, id: string): Promise<AbonoReceipt | null> {
  const row = await one(
    db,
    `SELECT m.*, c.name AS customer_name, u.name AS user_name,
            (SELECT COALESCE(SUM(CASE WHEN x.kind = 'FIADO' THEN x.amount_cents ELSE -x.amount_cents END), 0)
               FROM credit_movements x
              WHERE x.customer_id = m.customer_id AND x.received_at <= m.received_at) AS balance_after
       FROM credit_movements m
       JOIN customers c ON c.id = m.customer_id
       JOIN users u ON u.id = m.user_id
      WHERE m.id = $1 AND m.kind = 'ABONO'`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amountCents: row.amount_cents,
    method: row.method,
    previousBalanceCents: row.balance_after + row.amount_cents,
    balanceCents: row.balance_after,
    userName: row.user_name,
    createdAt: iso(row.created_at),
  };
}
