import type { CashSummary } from '@perupos/shared';
import { audit, many, one, tx, type Db } from '../db/pool.js';
import type { AuthUser } from '../http/auth.js';
import { badRequest, conflict } from '../http/errors.js';
import { iso, isoOrNull } from './mappers.js';

async function statusFor(db: Db, session: Record<string, any>): Promise<CashSummary> {
  const until = session.closed_at ?? new Date();
  const params = [session.opened_at, until];
  const inTurn = 's.created_at >= $1 AND s.created_at <= $2';

  // Ventas del turno por método (lo asignado a cada método).
  const methods = await many<{ method: string; total: number; change: number }>(
    db,
    `SELECT p.method, SUM(p.amount_cents) AS total, SUM(p.change_cents) AS change
       FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'COMPLETED' AND ${inTurn}
      GROUP BY p.method`,
    params,
  );
  const count = await one<{ n: number }>(db, `SELECT count(*) AS n FROM sales s WHERE s.status = 'COMPLETED' AND ${inTurn}`, params);
  const abonos = await many<{ method: string; total: number }>(
    db,
    `SELECT method, SUM(amount_cents) AS total FROM credit_movements
      WHERE kind = 'ABONO' AND method IS NOT NULL AND created_at >= $1 AND created_at <= $2
      GROUP BY method`,
    params,
  );
  const byMethod = Object.fromEntries(methods.map((m) => [m.method, m.total]));
  const abonosByMethod = Object.fromEntries(abonos.map((a) => [a.method, a.total]));
  // Efectivo de ventas = la parte asignada al efectivo (lo recibido menos el vuelto).
  const cashSales = byMethod.CASH ?? 0;
  // Si el cliente yapeó de más, el vuelto salió del cajón.
  const digitalChange = methods.filter((m) => m.method !== 'CASH').reduce((a, m) => a + m.change, 0);
  const cashAbonos = abonosByMethod.CASH ?? 0;

  const movements = await many(db, 'SELECT * FROM cash_movements WHERE session_id = $1 ORDER BY created_at', [session.id]);
  const inCents = movements.filter((m) => m.kind === 'IN').reduce((a, m) => a + m.amount_cents, 0);
  const outCents = movements.filter((m) => m.kind === 'OUT').reduce((a, m) => a + m.amount_cents, 0);
  const expected = session.opening_cents + cashSales - digitalChange + cashAbonos + inCents - outCents;
  const opener = await one<{ name: string }>(db, 'SELECT name FROM users WHERE id = $1', [session.opened_by]);
  const expectedCents = session.closed_at ? session.expected_cents : expected;
  return {
    sessionId: session.id,
    openedAt: iso(session.opened_at),
    openedBy: opener?.name ?? '',
    openingCents: session.opening_cents,
    salesCount: count?.n ?? 0,
    byMethod,
    abonosByMethod,
    cashSalesCents: cashSales,
    digitalChangeCents: digitalChange,
    cashAbonosCents: cashAbonos,
    inCents,
    outCents,
    expectedCents,
    closedAt: isoOrNull(session.closed_at),
    countedCents: session.counted_cents,
    transferredCents: session.transferred_cents ?? 0,
    // Lo contado + lo que se le yapeó al administrador para cuadrar, contra lo esperado.
    differenceCents: session.counted_cents == null ? null : session.counted_cents + (session.transferred_cents ?? 0) - expectedCents,
    movements: movements.map((m) => ({
      id: m.id,
      kind: m.kind,
      amountCents: m.amount_cents,
      reason: m.reason,
      createdAt: iso(m.created_at),
    })),
  };
}

export async function currentCash(db: Db): Promise<CashSummary | null> {
  const session = await one(db, 'SELECT * FROM cash_sessions WHERE closed_at IS NULL');
  return session ? statusFor(db, session) : null;
}

export async function openCash(user: AuthUser, openingCents: number): Promise<CashSummary> {
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
): Promise<CashSummary> {
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

/**
 * Cierre de caja: el vendedor cuenta el cajón. Si le yapeó al administrador
 * para cuadrar (por ejemplo, porque sacó plata del cajón), lo anota aparte.
 */
export async function closeCash(
  user: AuthUser,
  countedCents: number,
  transferredCents: number,
  notes: string | null,
): Promise<CashSummary> {
  return tx(async (db) => {
    const session = await one(db, 'SELECT * FROM cash_sessions WHERE closed_at IS NULL FOR UPDATE');
    if (!session) throw badRequest('No hay una caja abierta.', 'CAJA_CERRADA');
    const status = await statusFor(db, session);
    const closed = await one(
      db,
      `UPDATE cash_sessions SET closed_at = now(), closed_by = $2, expected_cents = $3, counted_cents = $4,
              transferred_cents = $5, notes = $6
        WHERE id = $1 RETURNING *`,
      [session.id, user.id, status.expectedCents, countedCents, transferredCents, notes],
    );
    await audit(db, user.id, 'CIERRA_CAJA', 'cash', session.id, {
      expectedCents: status.expectedCents,
      countedCents,
      transferredCents,
      differenceCents: countedCents + transferredCents - status.expectedCents,
    });
    return statusFor(db, closed!);
  });
}

/** Últimos cierres (para que el Admin revise faltantes). */
export async function recentClosures(db: Db, limit = 10): Promise<CashSummary[]> {
  const sessions = await many(db, 'SELECT * FROM cash_sessions WHERE closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT $1', [limit]);
  return Promise.all(sessions.map((s) => statusFor(db, s)));
}
