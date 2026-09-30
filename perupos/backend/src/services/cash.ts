import { audit, many, one, tx, type Db } from '../db/pool.js';
import type { AuthUser } from '../http/auth.js';
import { badRequest, conflict } from '../http/errors.js';
import { iso, isoOrNull } from './mappers.js';

export interface CashStatus {
  sessionId: string;
  openedAt: string;
  openedBy: string;
  openingCents: number;
  cashSalesCents: number;
  cashAbonosCents: number;
  inCents: number;
  outCents: number;
  /** Lo que debería haber en el cajón ahora. */
  expectedCents: number;
  closedAt: string | null;
  countedCents: number | null;
  differenceCents: number | null;
  movements: { id: string; kind: 'IN' | 'OUT'; amountCents: number; reason: string; createdAt: string }[];
}

async function statusFor(db: Db, session: Record<string, any>): Promise<CashStatus> {
  const until = session.closed_at ?? new Date();
  const params = [session.opened_at, until];
  // Efectivo de ventas = lo que se quedó en caja (lo recibido menos el vuelto).
  const sales = await one<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS total
       FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE p.method = 'CASH' AND s.status = 'COMPLETED' AND s.created_at >= $1 AND s.created_at <= $2`,
    params,
  );
  const abonos = await one<{ total: number }>(
    db,
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM credit_movements
      WHERE kind = 'ABONO' AND method = 'CASH' AND created_at >= $1 AND created_at <= $2`,
    params,
  );
  const movements = await many(db, 'SELECT * FROM cash_movements WHERE session_id = $1 ORDER BY created_at', [session.id]);
  const inCents = movements.filter((m) => m.kind === 'IN').reduce((a, m) => a + m.amount_cents, 0);
  const outCents = movements.filter((m) => m.kind === 'OUT').reduce((a, m) => a + m.amount_cents, 0);
  const expected = session.opening_cents + (sales?.total ?? 0) + (abonos?.total ?? 0) + inCents - outCents;
  const opener = await one<{ name: string }>(db, 'SELECT name FROM users WHERE id = $1', [session.opened_by]);
  return {
    sessionId: session.id,
    openedAt: iso(session.opened_at),
    openedBy: opener?.name ?? '',
    openingCents: session.opening_cents,
    cashSalesCents: sales?.total ?? 0,
    cashAbonosCents: abonos?.total ?? 0,
    inCents,
    outCents,
    expectedCents: session.closed_at ? session.expected_cents : expected,
    closedAt: isoOrNull(session.closed_at),
    countedCents: session.counted_cents,
    differenceCents: session.counted_cents == null ? null : session.counted_cents - session.expected_cents,
    movements: movements.map((m) => ({
      id: m.id,
      kind: m.kind,
      amountCents: m.amount_cents,
      reason: m.reason,
      createdAt: iso(m.created_at),
    })),
  };
}

export async function currentCash(db: Db): Promise<CashStatus | null> {
  const session = await one(db, 'SELECT * FROM cash_sessions WHERE closed_at IS NULL');
  return session ? statusFor(db, session) : null;
}

export async function openCash(user: AuthUser, openingCents: number): Promise<CashStatus> {
  return tx(async (db) => {
    const open = await one(db, 'SELECT id FROM cash_sessions WHERE closed_at IS NULL FOR UPDATE');
    if (open) throw conflict('La caja ya está abierta.', 'CAJA_ABIERTA');
    const session = await one(
      db,
      'INSERT INTO cash_sessions (opened_by, opening_cents) VALUES ($1, $2) RETURNING *',
      [user.id, openingCents],
    );
    await audit(db, user.id, 'ABRE_CAJA', 'cash', session!.id, { openingCents });
    return statusFor(db, session!);
  });
}

export async function addCashMovement(
  user: AuthUser,
  kind: 'IN' | 'OUT',
  amountCents: number,
  reason: string,
): Promise<CashStatus> {
  return tx(async (db) => {
    const session = await one(db, 'SELECT * FROM cash_sessions WHERE closed_at IS NULL FOR UPDATE');
    if (!session) throw badRequest('Primero abre la caja.', 'CAJA_CERRADA');
    await db.query(
      'INSERT INTO cash_movements (session_id, kind, amount_cents, reason, user_id) VALUES ($1, $2, $3, $4, $5)',
      [session.id, kind, amountCents, reason, user.id],
    );
    return statusFor(db, session);
  });
}

export async function closeCash(user: AuthUser, countedCents: number, notes: string | null): Promise<CashStatus> {
  return tx(async (db) => {
    const session = await one(db, 'SELECT * FROM cash_sessions WHERE closed_at IS NULL FOR UPDATE');
    if (!session) throw badRequest('No hay una caja abierta.', 'CAJA_CERRADA');
    const status = await statusFor(db, session);
    const closed = await one(
      db,
      `UPDATE cash_sessions SET closed_at = now(), closed_by = $2, expected_cents = $3, counted_cents = $4, notes = $5
        WHERE id = $1 RETURNING *`,
      [session.id, user.id, status.expectedCents, countedCents, notes],
    );
    await audit(db, user.id, 'CIERRA_CAJA', 'cash', session.id, {
      expectedCents: status.expectedCents,
      countedCents,
      differenceCents: countedCents - status.expectedCents,
    });
    return statusFor(db, closed!);
  });
}
