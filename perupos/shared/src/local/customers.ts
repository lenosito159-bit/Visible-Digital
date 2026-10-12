import type { Cents, CreditMovement, Customer, CustomerReputation, CustomerTreatment, PaymentMethod } from '../types.js';
import { normalizePeruMobile } from '../validators.js';
import { getBusiness } from './access.js';
import { LocalError, requirePermission, type Actor, type LocalCrypto, type LocalDb } from './db.js';

/** Clientes y su cuaderno de fiados, en el celular. */
interface CustomerRow {
  id: string;
  name: string;
  trato: CustomerTreatment;
  reputation: CustomerReputation;
  phone: string | null;
  photo_url: string | null;
  doc_type: Customer['docType'];
  doc_number: string | null;
  credit_limit_cents: number;
  balance_cents: number;
  oldest_debt_at: string | null;
  last_payment_at: string | null;
  active: number;
  updated_at: string;
}

const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  trato: r.trato ?? null,
  reputation: r.reputation ?? null,
  phone: r.phone,
  photoUrl: r.photo_url,
  docType: r.doc_type,
  docNumber: r.doc_number,
  creditLimitCents: r.credit_limit_cents,
  balanceCents: r.balance_cents,
  oldestDebtAt: r.oldest_debt_at,
  lastPaymentAt: r.last_payment_at,
  active: !!r.active,
  updatedAt: r.updated_at,
});

function cleanCustomerName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) throw new LocalError('NOMBRE_INVALIDO', 'Escribe el nombre del cliente.');
  if (clean.length > 80) throw new LocalError('NOMBRE_INVALIDO', 'El nombre es muy largo (máximo 80 letras).');
  return clean;
}

function cleanPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const n = normalizePeruMobile(phone);
  if (!n) throw new LocalError('CELULAR_INVALIDO', 'El celular debe tener 9 números y empezar con 9.');
  return n.slice(2);
}

function checkLimit(cents: number): number {
  if (!Number.isInteger(cents) || cents < 0) throw new LocalError('VALOR_INVALIDO', 'El límite de fiado no es válido.');
  return cents;
}

export async function getCustomer(db: LocalDb, id: string): Promise<Customer | null> {
  const row = await db.get<CustomerRow>('SELECT * FROM customers WHERE id = ?', id);
  return row ? toCustomer(row) : null;
}

export async function listCustomers(
  db: LocalDb,
  filter: { search?: string; withDebt?: boolean } = {},
): Promise<Customer[]> {
  const where = ['active = 1'];
  const params: string[] = [];
  if (filter.search?.trim()) {
    where.push('(name LIKE ? OR phone LIKE ?)');
    params.push(`%${filter.search.trim()}%`, `%${filter.search.trim()}%`);
  }
  if (filter.withDebt) where.push('balance_cents > 0');
  const rows = await db.all<CustomerRow>(
    `SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`,
    ...params,
  );
  return rows.map(toCustomer);
}

export interface CustomerInput {
  /** Opcional: repetir el mismo id no crea dos clientes. */
  id?: string;
  name: string;
  phone?: string | null;
  trato?: CustomerTreatment;
  /** Si no se pone, el "fiado máximo para un cliente nuevo" del negocio. */
  creditLimitCents?: Cents;
}

export async function createCustomer(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  input: CustomerInput,
  now: Date = new Date(),
): Promise<Customer> {
  requirePermission(actor, 'customers.create', 'No puedes crear clientes.');
  if (input.id) {
    const existing = await getCustomer(db, input.id);
    if (existing) return existing;
  }
  const name = cleanCustomerName(input.name);
  const phone = cleanPhone(input.phone);
  const business = await getBusiness(db);
  // Un vendedor usa el límite del negocio; el dueño puede poner otro.
  const limit =
    input.creditLimitCents !== undefined && actor.role === 'ADMIN'
      ? checkLimit(input.creditLimitCents)
      : (business?.defaultCreditLimitCents ?? 5000);
  const id = input.id ?? c.randomUUID();
  await db.run(
    `INSERT INTO customers (id, name, phone, photo_url, doc_type, doc_number, credit_limit_cents, balance_cents,
       pending_cents, oldest_debt_at, last_payment_at, active, updated_at, trato, reputation)
     VALUES (?, ?, ?, NULL, 'NONE', NULL, ?, 0, 0, NULL, NULL, 1, ?, ?, NULL)`,
    id, name, phone, limit, now.toISOString(), input.trato ?? null,
  );
  return (await getCustomer(db, id))!;
}

export interface CustomerPatch {
  name?: string;
  phone?: string | null;
  trato?: CustomerTreatment;
  reputation?: CustomerReputation;
  creditLimitCents?: Cents;
}

export async function updateCustomer(
  db: LocalDb,
  actor: Actor,
  id: string,
  patch: CustomerPatch,
  now: Date = new Date(),
): Promise<Customer> {
  requirePermission(actor, 'customers.create', 'No puedes editar clientes.');
  const current = await getCustomer(db, id);
  if (!current) throw new LocalError('CLIENTE_NO_EXISTE', 'No se encontró al cliente.');
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (patch.name !== undefined) set('name', cleanCustomerName(patch.name));
  if (patch.phone !== undefined) set('phone', cleanPhone(patch.phone));
  if (patch.trato !== undefined) set('trato', patch.trato);
  if (patch.reputation !== undefined) set('reputation', patch.reputation);
  if (patch.creditLimitCents !== undefined) {
    requirePermission(actor, 'customers.editCreditLimit', 'Solo el dueño cambia el límite de fiado.');
    set('credit_limit_cents', checkLimit(patch.creditLimitCents));
  }
  if (sets.length) {
    set('updated_at', now.toISOString());
    await db.run(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  }
  return (await getCustomer(db, id))!;
}

interface MovementRow {
  id: string;
  customer_id: string;
  kind: 'FIADO' | 'ABONO';
  amount_cents: number;
  sale_id: string | null;
  method: PaymentMethod | null;
  confirmation: 'MANUAL' | null;
  reference: string | null;
  note: string | null;
  balance_after_cents: number;
  user_name: string;
  created_at: string;
}

export interface LedgerEntry extends CreditMovement {
  /** Yape/Plin: "MANUAL" = el comerciante confirmó en su app que le llegó. */
  confirmation: 'MANUAL' | null;
  reference: string | null;
  balanceAfterCents: Cents;
}

/** Cuaderno del cliente: fiados y abonos, del más reciente al más antiguo. */
export async function getLedger(db: LocalDb, customerId: string): Promise<LedgerEntry[]> {
  const rows = await db.all<MovementRow>(
    'SELECT * FROM credit_movements WHERE customer_id = ? ORDER BY created_at DESC, rowid DESC',
    customerId,
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
    createdAt: r.created_at,
    confirmation: r.confirmation,
    reference: r.reference,
    balanceAfterCents: r.balance_after_cents,
  }));
}

/** Deuda actual según el cuaderno (suma de fiados menos abonos). */
export async function debtOf(db: LocalDb, customerId: string): Promise<Cents> {
  const row = await db.get<{ balance: number | null }>(
    "SELECT SUM(CASE WHEN kind = 'FIADO' THEN amount_cents ELSE -amount_cents END) AS balance FROM credit_movements WHERE customer_id = ?",
    customerId,
  );
  return row?.balance ?? 0;
}

/**
 * Recalcula la deuda guardada en el cliente desde su cuaderno. Los abonos
 * pagan primero los fiados más antiguos: así se sabe desde cuándo debe.
 */
export async function refreshCustomerDebt(db: LocalDb, customerId: string, ts: string): Promise<Cents> {
  const rows = await db.all<{ kind: 'FIADO' | 'ABONO'; amount_cents: number; created_at: string }>(
    'SELECT kind, amount_cents, created_at FROM credit_movements WHERE customer_id = ? ORDER BY created_at, rowid',
    customerId,
  );
  const open: { amount: number; at: string }[] = [];
  let lastPayment: string | null = null;
  for (const r of rows) {
    if (r.kind === 'FIADO') {
      open.push({ amount: r.amount_cents, at: r.created_at });
      continue;
    }
    lastPayment = r.created_at;
    let left = r.amount_cents;
    while (left > 0 && open.length) {
      const first = open[0]!;
      const used = Math.min(first.amount, left);
      first.amount -= used;
      left -= used;
      if (first.amount === 0) open.shift();
    }
  }
  const balance = open.reduce((s, o) => s + o.amount, 0);
  await db.run(
    'UPDATE customers SET balance_cents = ?, pending_cents = 0, oldest_debt_at = ?, last_payment_at = ?, updated_at = ? WHERE id = ?',
    balance, open[0]?.at ?? null, lastPayment, ts, customerId,
  );
  return balance;
}
