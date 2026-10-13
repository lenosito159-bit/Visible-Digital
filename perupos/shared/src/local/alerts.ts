import { formatSoles } from '../money.js';
import type { AlertSeverity, AlertType } from '../types.js';
import { getBusiness } from './access.js';
import { currentCash } from './cash.js';
import type { LocalDb } from './db.js';

/**
 * Avisos del negocio, calculados en el celular cada vez que se piden (no se
 * guardan): un aviso desaparece solo cuando se resuelve (llegó mercadería,
 * el cliente abonó…). La tabla alert_notified solo recuerda cuáles ya se
 * notificaron, para no repetir la notificación del celular.
 */
export interface LocalAlert {
  /** Identifica el aviso: tipo + producto/cliente. */
  key: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  entityId: string | null;
}

const DAY = 86_400_000;

export async function computeAlerts(db: LocalDb, now: Date = new Date()): Promise<LocalAlert[]> {
  const business = await getBusiness(db);
  if (!business) return [];
  const alerts: LocalAlert[] = [];

  const low = await db.all<{ id: string; name: string; stock: number; min_stock: number; unit: string }>(
    'SELECT id, name, stock, min_stock, unit FROM products WHERE active = 1 AND min_stock > 0 AND stock <= min_stock ORDER BY stock - min_stock',
  );
  for (const p of low) {
    const unit = p.unit === 'KG' ? 'kg' : p.stock === 1 ? 'unidad' : 'unidades';
    alerts.push({
      key: `STOCK_BAJO:${p.id}`,
      type: 'STOCK_BAJO',
      severity: p.stock <= 0 ? 'CRITICAL' : 'WARNING',
      title: p.stock <= 0 ? `Se acabó: ${p.name}` : `Queda poco: ${p.name}`,
      message: `${p.stock <= 0 ? 'No queda' : `Quedan ${p.stock} ${unit}`}. Avisas cuando quedan ${p.min_stock}. Toca reponer.`,
      entityId: p.id,
    });
  }

  const debtors = await db.all<{
    id: string; name: string; balance_cents: number; credit_limit_cents: number; oldest_debt_at: string | null; last_payment_at: string | null;
  }>('SELECT id, name, balance_cents, credit_limit_cents, oldest_debt_at, last_payment_at FROM customers WHERE active = 1 AND balance_cents > 0');
  for (const c of debtors) {
    const ref = [c.last_payment_at, c.oldest_debt_at].filter((x): x is string => !!x).sort().pop();
    const days = ref ? Math.floor((now.getTime() - new Date(ref).getTime()) / DAY) : 0;
    if (days > business.overdueDays) {
      alerts.push({
        key: `DEUDA_VENCIDA:${c.id}`,
        type: 'DEUDA_VENCIDA',
        severity: 'WARNING',
        title: `${c.name} debe hace ${days} días`,
        message: `Debe ${formatSoles(c.balance_cents)} y no abona hace ${days} días. Mándale un recordatorio por WhatsApp.`,
        entityId: c.id,
      });
    }
    if (c.credit_limit_cents > 0 && c.balance_cents >= c.credit_limit_cents * business.creditAlertRatio) {
      const over = c.balance_cents >= c.credit_limit_cents;
      alerts.push({
        key: `LIMITE_CREDITO:${c.id}`,
        type: 'LIMITE_CREDITO',
        severity: over ? 'CRITICAL' : 'WARNING',
        title: over ? `${c.name} llegó a su límite de fiado` : `${c.name} está cerca de su límite`,
        message: `Debe ${formatSoles(c.balance_cents)} de ${formatSoles(c.credit_limit_cents)} que le fías.`,
        entityId: c.id,
      });
    }
  }

  const cash = await currentCash(db);
  if (cash && business.cashLowThresholdCents > 0 && cash.expectedCents < business.cashLowThresholdCents) {
    alerts.push({
      key: 'CAJA_BAJA',
      type: 'CAJA_BAJA',
      severity: 'WARNING',
      title: 'Poco sencillo en la caja',
      message: `Debe haber ${formatSoles(cash.expectedCents)} en el cajón. Cambia billetes para poder dar vuelto.`,
      entityId: null,
    });
  }

  // Sin movimiento: hay stock, pero no se vende hace N días (y el producto no es nuevo).
  const since = new Date(now.getTime() - business.staleProductDays * DAY).toISOString();
  const stale = await db.all<{ id: string; name: string; stock: number }>(
    `SELECT p.id, p.name, p.stock FROM products p
      WHERE p.active = 1 AND p.stock > 0
        AND (SELECT MIN(created_at) FROM stock_movements m WHERE m.product_id = p.id) < ?
        AND NOT EXISTS (SELECT 1 FROM stock_movements m WHERE m.product_id = p.id AND m.kind = 'VENTA' AND m.created_at >= ?)
      ORDER BY p.name`,
    since, since,
  );
  for (const p of stale) {
    alerts.push({
      key: `SIN_MOVIMIENTO:${p.id}`,
      type: 'SIN_MOVIMIENTO',
      severity: 'INFO',
      title: `${p.name} no se vende`,
      message: `Hace más de ${business.staleProductDays} días que no se vende y tienes ${p.stock}. Ponlo más a la vista o haz una oferta.`,
      entityId: p.id,
    });
  }

  const order: Record<AlertSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Avisos que todavía no se notificaron en el celular. Los marca como
 * notificados y olvida los que ya se resolvieron (si vuelven, se notifican
 * otra vez).
 */
export async function takeNewAlerts(db: LocalDb, now: Date = new Date()): Promise<LocalAlert[]> {
  const alerts = await computeAlerts(db, now);
  const fresh: LocalAlert[] = [];
  await db.transaction(async () => {
    const seen = new Set((await db.all<{ key: string }>('SELECT key FROM alert_notified')).map((r) => r.key));
    const current = new Set(alerts.map((a) => a.key));
    for (const key of seen) if (!current.has(key)) await db.run('DELETE FROM alert_notified WHERE key = ?', key);
    for (const a of alerts) {
      if (seen.has(a.key)) continue;
      fresh.push(a);
      await db.run('INSERT INTO alert_notified (key, notified_at) VALUES (?, ?)', a.key, now.toISOString());
    }
  });
  return fresh;
}
