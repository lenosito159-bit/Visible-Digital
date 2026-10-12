import type { CashSummary, Cents, PaymentMethod } from '../types.js';
import { LocalError, limaDayStart, requirePermission, type Actor, type LocalCrypto, type LocalDb } from './db.js';

/**
 * Caja del turno en el celular: apertura, ingresos y retiros, y cierre con
 * lo contado. "Esperado" = apertura + efectivo de ventas − vuelto de yapeos
 * + abonos en efectivo + ingresos − retiros.
 */
interface SessionRow {
  id: string;
  opened_at: string;
  opened_by: string;
  opened_by_name: string;
  opening_cents: number;
  closed_at: string | null;
  expected_cents: number | null;
  counted_cents: number | null;
  transferred_cents: number;
  notes: string | null;
}

/** Totales de ventas y abonos en un rango de tiempo [from, to]. */
async function moneyBetween(db: LocalDb, from: string, to: string | null) {
  const until = to ?? '9999-12-31T23:59:59.999Z';
  const methods = await db.all<{ method: PaymentMethod; total: number; change: number }>(
    `SELECT p.method, SUM(p.amount_cents) AS total, SUM(p.change_cents) AS change
       FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at <= ?
      GROUP BY p.method`,
    from, until,
  );
  const count = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at <= ?",
    from, until,
  );
  const total = await db.get<{ t: number | null }>(
    "SELECT SUM(total_cents) AS t FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND created_at <= ?",
    from, until,
  );
  const abonos = await db.all<{ method: PaymentMethod; total: number }>(
    `SELECT method, SUM(amount_cents) AS total FROM credit_movements
      WHERE kind = 'ABONO' AND method IS NOT NULL AND created_at >= ? AND created_at <= ?
      GROUP BY method`,
    from, until,
  );
  const byMethod: Partial<Record<PaymentMethod, Cents>> = Object.fromEntries(methods.map((m) => [m.method, m.total]));
  const abonosByMethod: Partial<Record<PaymentMethod, Cents>> = Object.fromEntries(abonos.map((a) => [a.method, a.total]));
  // Si el cliente yapeó de más, el vuelto salió del cajón.
  const digitalChange = methods.filter((m) => m.method !== 'CASH').reduce((a, m) => a + m.change, 0);
  return { byMethod, abonosByMethod, digitalChange, salesCount: count?.n ?? 0, salesCents: total?.t ?? 0 };
}

async function summaryFor(db: LocalDb, s: SessionRow): Promise<CashSummary> {
  const money = await moneyBetween(db, s.opened_at, s.closed_at);
  const movements = await db.all<{ id: string; kind: 'IN' | 'OUT'; amount_cents: number; reason: string; created_at: string }>(
    'SELECT * FROM cash_movements WHERE session_id = ? ORDER BY created_at, rowid',
    s.id,
  );
  const inCents = movements.filter((m) => m.kind === 'IN').reduce((a, m) => a + m.amount_cents, 0);
  const outCents = movements.filter((m) => m.kind === 'OUT').reduce((a, m) => a + m.amount_cents, 0);
  const cashSales = money.byMethod.CASH ?? 0;
  const cashAbonos = money.abonosByMethod.CASH ?? 0;
  const expected = s.expected_cents ?? s.opening_cents + cashSales - money.digitalChange + cashAbonos + inCents - outCents;
  return {
    sessionId: s.id,
    openedAt: s.opened_at,
    openedBy: s.opened_by_name,
    openingCents: s.opening_cents,
    salesCount: money.salesCount,
    byMethod: money.byMethod,
    abonosByMethod: money.abonosByMethod,
    cashSalesCents: cashSales,
    digitalChangeCents: money.digitalChange,
    cashAbonosCents: cashAbonos,
    inCents,
    outCents,
    expectedCents: expected,
    closedAt: s.closed_at,
    countedCents: s.counted_cents,
    transferredCents: s.transferred_cents,
    differenceCents: s.counted_cents == null ? null : s.counted_cents + s.transferred_cents - expected,
    movements: movements.map((m) => ({ id: m.id, kind: m.kind, amountCents: m.amount_cents, reason: m.reason, createdAt: m.created_at })),
  };
}

const openSession = (db: LocalDb) => db.get<SessionRow>('SELECT * FROM cash_sessions WHERE closed_at IS NULL');

function checkAmount(cents: number, what: string, allowZero = true): number {
  if (!Number.isInteger(cents) || cents < 0 || (!allowZero && cents === 0)) {
    throw new LocalError('MONTO_INVALIDO', `${what} no es válido.`);
  }
  return cents;
}

export async function currentCash(db: LocalDb): Promise<CashSummary | null> {
  const s = await openSession(db);
  return s ? summaryFor(db, s) : null;
}

export async function openCash(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  openingCents: Cents,
  now: Date = new Date(),
): Promise<CashSummary> {
  requirePermission(actor, 'cash.operate', 'Tu usuario no puede abrir la caja.');
  checkAmount(openingCents, 'El monto de apertura');
  const id = c.randomUUID();
  await db.transaction(async () => {
    if (await openSession(db)) throw new LocalError('CAJA_ABIERTA', 'La caja ya está abierta.');
    await db.run(
      'INSERT INTO cash_sessions (id, opened_at, opened_by, opened_by_name, opening_cents) VALUES (?, ?, ?, ?, ?)',
      id, now.toISOString(), actor.id, actor.name, openingCents,
    );
  });
  return (await currentCash(db))!;
}

/** Ingreso ("puse sencillo") o retiro ("pagué al proveedor") de efectivo. */
export async function addCashMovement(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  kind: 'IN' | 'OUT',
  amountCents: Cents,
  reason: string,
  now: Date = new Date(),
): Promise<CashSummary> {
  requirePermission(actor, 'cash.operate', 'Tu usuario no puede mover la caja.');
  checkAmount(amountCents, 'El monto', false);
  const why = reason.trim();
  if (!why) throw new LocalError('MOTIVO', 'Escribe el motivo (por ejemplo: "pago al proveedor de gaseosas").');
  await db.transaction(async () => {
    const s = await openSession(db);
    if (!s) throw new LocalError('CAJA_CERRADA', 'Primero abre la caja.');
    await db.run(
      'INSERT INTO cash_movements (id, session_id, kind, amount_cents, reason, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c.randomUUID(), s.id, kind, amountCents, why, actor.id, now.toISOString(),
    );
  });
  return (await currentCash(db))!;
}

/** Cierre: lo que se contó en el cajón (+ lo que se yapeó al dueño para cuadrar). */
export async function closeCash(
  db: LocalDb,
  actor: Actor,
  countedCents: Cents,
  transferredCents: Cents = 0,
  notes: string | null = null,
  now: Date = new Date(),
): Promise<CashSummary> {
  requirePermission(actor, 'cash.operate', 'Tu usuario no puede cerrar la caja.');
  checkAmount(countedCents, 'Lo contado');
  checkAmount(transferredCents, 'Lo yapeado al dueño');
  let id = '';
  await db.transaction(async () => {
    const s = await openSession(db);
    if (!s) throw new LocalError('CAJA_CERRADA', 'No hay una caja abierta.');
    id = s.id;
    const closedAt = now.toISOString();
    const status = await summaryFor(db, { ...s, closed_at: closedAt });
    await db.run(
      `UPDATE cash_sessions SET closed_at = ?, closed_by = ?, expected_cents = ?, counted_cents = ?, transferred_cents = ?, notes = ?
        WHERE id = ?`,
      closedAt, actor.id, status.expectedCents, countedCents, transferredCents, notes?.trim() || null, s.id,
    );
  });
  const closed = (await db.get<SessionRow>('SELECT * FROM cash_sessions WHERE id = ?', id))!;
  return summaryFor(db, closed);
}

export async function recentClosures(db: LocalDb, limit = 10): Promise<CashSummary[]> {
  const rows = await db.all<SessionRow>(
    'SELECT * FROM cash_sessions WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT ?',
    limit,
  );
  return Promise.all(rows.map((s) => summaryFor(db, s)));
}

export interface DaySummary {
  salesCents: Cents;
  salesCount: number;
  cashCents: Cents;
  /** Yape, Plin, tarjeta y transferencia (confirmados por el comerciante). */
  digitalCents: Cents;
  fiadoCents: Cents;
  abonosCents: Cents;
  /** Lo que debería haber en el cajón si la caja está abierta. */
  cashInDrawerCents: Cents | null;
}

/** "¿Cómo va el día?" para la pantalla de inicio (día de Lima). */
export async function daySummary(db: LocalDb, now: Date = new Date(), sellerId?: string): Promise<DaySummary> {
  const from = limaDayStart(now);
  if (sellerId) {
    const row = await db.get<{ t: number | null; n: number }>(
      "SELECT SUM(total_cents) AS t, COUNT(*) AS n FROM sales WHERE status = 'COMPLETED' AND created_at >= ? AND seller_id = ?",
      from, sellerId,
    );
    return { salesCents: row?.t ?? 0, salesCount: row?.n ?? 0, cashCents: 0, digitalCents: 0, fiadoCents: 0, abonosCents: 0, cashInDrawerCents: null };
  }
  const money = await moneyBetween(db, from, null);
  const sum = (o: Partial<Record<PaymentMethod, Cents>>, keys: PaymentMethod[]) => keys.reduce((a, k) => a + (o[k] ?? 0), 0);
  const cash = await currentCash(db);
  return {
    salesCents: money.salesCents,
    salesCount: money.salesCount,
    cashCents: money.byMethod.CASH ?? 0,
    digitalCents: sum(money.byMethod, ['YAPE', 'PLIN', 'CARD', 'TRANSFER']),
    fiadoCents: money.byMethod.FIADO ?? 0,
    abonosCents: Object.values(money.abonosByMethod).reduce((a, v) => a + (v ?? 0), 0),
    cashInDrawerCents: cash?.expectedCents ?? null,
  };
}
