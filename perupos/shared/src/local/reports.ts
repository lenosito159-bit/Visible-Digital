import type { Cents, PaymentMethod } from '../types.js';
import { limaDayStart, type LocalDb } from './db.js';

/**
 * Informes del negocio calculados en el celular. Las fechas son de Lima
 * (UTC−5). Las ventas anuladas no cuentan, pero se informa cuántas hubo.
 */
export type ReportPeriod = 'HOY' | 'AYER' | 'SEMANA' | 'MES' | 'MES_ANTERIOR';

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  HOY: 'Hoy',
  AYER: 'Ayer',
  SEMANA: 'Últimos 7 días',
  MES: 'Este mes',
  MES_ANTERIOR: 'Mes pasado',
};

const DAY = 86_400_000;
const LIMA = 5 * 3_600_000;

/** [desde, hasta) en ISO para un periodo, según la fecha de Lima de `now`. */
export function periodRange(period: ReportPeriod, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(limaDayStart(now)).getTime();
  const lima = new Date(today - LIMA); // medianoche de Lima expresada en UTC "corrido"
  const monthStart = (y: number, m: number) => Date.UTC(y, m, 1) + LIMA;
  switch (period) {
    case 'HOY':
      return { from: iso(today), to: iso(today + DAY) };
    case 'AYER':
      return { from: iso(today - DAY), to: iso(today) };
    case 'SEMANA':
      return { from: iso(today - 6 * DAY), to: iso(today + DAY) };
    case 'MES':
      return { from: iso(monthStart(lima.getUTCFullYear(), lima.getUTCMonth())), to: iso(today + DAY) };
    case 'MES_ANTERIOR':
      return {
        from: iso(monthStart(lima.getUTCFullYear(), lima.getUTCMonth() - 1)),
        to: iso(monthStart(lima.getUTCFullYear(), lima.getUTCMonth())),
      };
  }
}
const iso = (ms: number) => new Date(ms).toISOString();

export interface ProductReportRow {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  totalCents: Cents;
}

export interface PeriodReport {
  from: string;
  to: string;
  salesCount: number;
  salesCents: Cents;
  averageTicketCents: Cents;
  discountCents: Cents;
  voidedCount: number;
  /** Lo vendido por cada forma de pago (Yape y Plin: confirmados por el comerciante). */
  byMethod: Partial<Record<PaymentMethod, Cents>>;
  /** Fiado dado en el periodo y abonos cobrados en el periodo. */
  fiadoCents: Cents;
  abonosCents: Cents;
  abonosByMethod: Partial<Record<PaymentMethod, Cents>>;
  /** Ganancia aproximada: solo de productos con costo anotado. */
  margin: { cents: Cents; coveredSalesCents: Cents; uncoveredSalesCents: Cents };
  topProducts: ProductReportRow[];
  /** Ventas por día (fecha de Lima "AAAA-MM-DD"), del más antiguo al más reciente. */
  byDay: { day: string; salesCents: Cents; salesCount: number }[];
  /** Total que deben todos los clientes hoy (no depende del periodo). */
  totalDebtCents: Cents;
}

export async function periodReport(db: LocalDb, from: string, to: string, topLimit = 10): Promise<PeriodReport> {
  const completed = "s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?";
  const totals = await db.get<{ n: number; total: number | null; discount: number | null }>(
    `SELECT COUNT(*) AS n, SUM(total_cents) AS total, SUM(discount_cents) AS discount FROM sales s WHERE ${completed}`,
    from, to,
  );
  const voided = await db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sales WHERE status = 'VOIDED' AND created_at >= ? AND created_at < ?",
    from, to,
  );
  const methods = await db.all<{ method: PaymentMethod; total: number }>(
    `SELECT p.method, SUM(p.amount_cents) AS total FROM sale_payments p JOIN sales s ON s.id = p.sale_id
      WHERE ${completed} GROUP BY p.method`,
    from, to,
  );
  const abonos = await db.all<{ method: PaymentMethod; total: number }>(
    `SELECT method, SUM(amount_cents) AS total FROM credit_movements
      WHERE kind = 'ABONO' AND method IS NOT NULL AND created_at >= ? AND created_at < ? GROUP BY method`,
    from, to,
  );
  // Ganancia: (precio − costo) × cantidad, prorrateando el descuento de la venta.
  const lines = await db.all<{ total: number; quantity: number; cost: number | null; subtotal: number; discount: number }>(
    `SELECT i.total_cents AS total, i.quantity, p.cost_cents AS cost, s.subtotal_cents AS subtotal, s.discount_cents AS discount
       FROM sale_items i JOIN sales s ON s.id = i.sale_id LEFT JOIN products p ON p.id = i.product_id
      WHERE ${completed}`,
    from, to,
  );
  let margin = 0;
  let covered = 0;
  let uncovered = 0;
  for (const l of lines) {
    const net = l.subtotal > 0 ? l.total - Math.round((l.discount * l.total) / l.subtotal) : l.total;
    if (l.cost == null) {
      uncovered += net;
      continue;
    }
    covered += net;
    margin += net - Math.round(l.cost * l.quantity);
  }
  const top = await db.all<{ product_id: string; name: string; quantity: number; unit: string; total: number }>(
    `SELECT i.product_id, i.name, SUM(i.quantity) AS quantity, i.unit, SUM(i.total_cents) AS total
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
      WHERE ${completed} GROUP BY i.product_id ORDER BY total DESC LIMIT ?`,
    from, to, topLimit,
  );
  const sales = await db.all<{ created_at: string; total_cents: number }>(
    `SELECT created_at, total_cents FROM sales s WHERE ${completed}`,
    from, to,
  );
  const days = new Map<string, { salesCents: number; salesCount: number }>();
  for (let t = new Date(from).getTime(); t < new Date(to).getTime(); t += DAY) days.set(limaDay(iso(t)), { salesCents: 0, salesCount: 0 });
  for (const s of sales) {
    const d = days.get(limaDay(s.created_at)) ?? { salesCents: 0, salesCount: 0 };
    d.salesCents += s.total_cents;
    d.salesCount += 1;
    days.set(limaDay(s.created_at), d);
  }
  const debt = await db.get<{ t: number | null }>('SELECT SUM(balance_cents) AS t FROM customers WHERE active = 1 AND balance_cents > 0');
  const byMethod = Object.fromEntries(methods.map((m) => [m.method, m.total])) as Partial<Record<PaymentMethod, Cents>>;
  const count = totals?.n ?? 0;
  const salesCents = totals?.total ?? 0;
  return {
    from,
    to,
    salesCount: count,
    salesCents,
    averageTicketCents: count ? Math.round(salesCents / count) : 0,
    discountCents: totals?.discount ?? 0,
    voidedCount: voided?.n ?? 0,
    byMethod,
    fiadoCents: byMethod.FIADO ?? 0,
    abonosCents: abonos.reduce((a, x) => a + x.total, 0),
    abonosByMethod: Object.fromEntries(abonos.map((a) => [a.method, a.total])),
    margin: { cents: margin, coveredSalesCents: covered, uncoveredSalesCents: uncovered },
    topProducts: top.map((t) => ({ productId: t.product_id, name: t.name, quantity: t.quantity, unit: t.unit, totalCents: t.total })),
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v })),
    totalDebtCents: debt?.t ?? 0,
  };
}

/** "2026-10-12" en fecha de Lima. */
export function limaDay(isoDate: string): string {
  return new Date(new Date(isoDate).getTime() - LIMA).toISOString().slice(0, 10);
}
