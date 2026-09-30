import { PUSH_CHANNELS, formatSoles, type AlertSeverity, type AlertType, type Role } from '@perupos/shared';
import { many, pool, type Db } from '../db/pool.js';
import { currentCash } from './cash.js';
import { pushToRoles } from './push.js';
import { getSettings } from './settings.js';

interface Candidate {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  targetRoles: Role[];
  entityId: string | null;
  dedupeKey: string;
}

const qty = (n: number, unit: string) =>
  unit === 'KG' ? `${Number.isInteger(n) ? n : n.toFixed(1)} kg` : `${n} ${n === 1 ? 'unidad' : 'unidades'}`;

/** Calcula qué alertas deberían estar abiertas ahora mismo según los datos. */
export async function alertCandidates(db: Db): Promise<Candidate[]> {
  const settings = await getSettings(db);
  const out: Candidate[] = [];

  // Stock bajo → Admin + Vendedor.
  const lowStock = await many(
    db,
    'SELECT id, name, stock, min_stock, unit FROM products WHERE active AND min_stock > 0 AND stock <= min_stock ORDER BY stock',
  );
  for (const p of lowStock) {
    const empty = Number(p.stock) <= 0;
    out.push({
      type: 'STOCK_BAJO',
      severity: empty ? 'CRITICAL' : 'WARNING',
      title: empty ? `Se acabó: ${p.name}` : `Stock bajo: ${p.name}`,
      message: empty
        ? `${p.name} está agotado. Repón para no perder ventas.`
        : `Quedan ${qty(Number(p.stock), p.unit)} de ${p.name} (mínimo ${qty(Number(p.min_stock), p.unit)}).`,
      targetRoles: ['ADMIN', 'VENDEDOR'],
      entityId: p.id,
      dedupeKey: `STOCK_BAJO:${p.id}`,
    });
  }

  // Cliente cerca de su límite de fiado → Admin.
  const nearLimit = await many(
    db,
    `SELECT c.id, c.name, c.credit_limit_cents, d.balance_cents FROM customers c JOIN customer_debt d ON d.customer_id = c.id
      WHERE c.active AND c.credit_limit_cents > 0 AND d.balance_cents >= c.credit_limit_cents * $1::numeric`,
    [settings.creditAlertRatio],
  );
  for (const c of nearLimit) {
    const over = c.balance_cents > c.credit_limit_cents;
    out.push({
      type: 'LIMITE_CREDITO',
      severity: over ? 'CRITICAL' : 'WARNING',
      title: over ? `${c.name} superó su límite` : `${c.name} está cerca de su límite`,
      message: `Debe ${formatSoles(c.balance_cents)} de un límite de ${formatSoles(c.credit_limit_cents)}.`,
      targetRoles: ['ADMIN'],
      entityId: c.id,
      dedupeKey: `LIMITE_CREDITO:${c.id}`,
    });
  }

  // Caja baja → Admin + Agente.
  const cash = await currentCash(db);
  if (cash && cash.expectedCents < settings.cashLowThresholdCents) {
    out.push({
      type: 'CAJA_BAJA',
      severity: 'WARNING',
      title: 'Poco efectivo en caja',
      message: `Hay ${formatSoles(cash.expectedCents)} en caja (mínimo ${formatSoles(settings.cashLowThresholdCents)}). Consigue sencillo para dar vuelto.`,
      targetRoles: ['ADMIN', 'AGENTE'],
      entityId: cash.sessionId,
      dedupeKey: `CAJA_BAJA:${cash.sessionId}`,
    });
  }

  // Deuda vencida → Admin + Vendedor.
  const overdue = await many(
    db,
    `SELECT c.id, c.name, d.balance_cents,
            EXTRACT(DAY FROM now() - GREATEST(d.last_payment_at, d.oldest_unpaid_at))::int AS days
       FROM customers c JOIN customer_debt d ON d.customer_id = c.id
      WHERE c.active AND d.balance_cents > 0
        AND GREATEST(d.last_payment_at, d.oldest_unpaid_at) < now() - make_interval(days => $1)`,
    [settings.overdueDays],
  );
  for (const c of overdue) {
    out.push({
      type: 'DEUDA_VENCIDA',
      severity: 'WARNING',
      title: `Deuda vencida: ${c.name}`,
      message: `${c.name} debe ${formatSoles(c.balance_cents)} y lleva ${c.days} días sin abonar.`,
      targetRoles: ['ADMIN', 'VENDEDOR'],
      entityId: c.id,
      dedupeKey: `DEUDA_VENCIDA:${c.id}`,
    });
  }

  // Producto sin movimiento → Admin.
  const stale = await many(
    db,
    `SELECT p.id, p.name, p.stock, p.unit
       FROM products p
      WHERE p.active AND p.stock > 0 AND p.created_at < now() - make_interval(days => $1)
        AND NOT EXISTS (
          SELECT 1 FROM sale_items i JOIN sales s ON s.id = i.sale_id
           WHERE i.product_id = p.id AND s.status = 'COMPLETED' AND s.created_at >= now() - make_interval(days => $1))`,
    [settings.staleProductDays],
  );
  for (const p of stale) {
    out.push({
      type: 'SIN_MOVIMIENTO',
      severity: 'INFO',
      title: `Sin ventas: ${p.name}`,
      message: `${p.name} no se vende hace más de ${settings.staleProductDays} días y tienes ${qty(Number(p.stock), p.unit)} guardadas.`,
      targetRoles: ['ADMIN'],
      entityId: p.id,
      dedupeKey: `SIN_MOVIMIENTO:${p.id}`,
    });
  }

  return out;
}

/**
 * Abre las alertas nuevas, cierra las que ya no aplican (por ejemplo, se
 * repuso el stock) y avisa por push solo de las nuevas.
 */
export async function evaluateAlerts(): Promise<{ opened: number; resolved: number }> {
  const candidates = await alertCandidates(pool);
  const keys = candidates.map((c) => c.dedupeKey);
  const resolved = await pool.query(
    'UPDATE alerts SET resolved_at = now() WHERE resolved_at IS NULL AND NOT (dedupe_key = ANY($1::text[]))',
    [keys],
  );
  const opened: Candidate[] = [];
  for (const c of candidates) {
    const res = await pool.query(
      `INSERT INTO alerts (type, severity, title, message, target_roles, entity_id, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedupe_key) WHERE resolved_at IS NULL
       DO UPDATE SET message = EXCLUDED.message, severity = EXCLUDED.severity, title = EXCLUDED.title
       RETURNING (xmax = 0) AS inserted, id`,
      [c.type, c.severity, c.title, c.message, c.targetRoles, c.entityId, c.dedupeKey],
    );
    if (res.rows[0]?.inserted) opened.push(c);
  }
  for (const c of opened) {
    await pushToRoles(c.targetRoles, {
      title: c.title,
      body: c.message,
      data: { type: c.type, entityId: c.entityId },
      channelId: PUSH_CHANNELS[c.type].id,
    });
  }
  if (opened.length) {
    await pool.query('UPDATE alerts SET pushed_at = now() WHERE pushed_at IS NULL AND resolved_at IS NULL');
  }
  return { opened: opened.length, resolved: resolved.rowCount ?? 0 };
}
