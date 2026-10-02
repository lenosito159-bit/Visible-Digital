import { TZ, many, one, type Db } from '../db/pool.js';
import { currentCash } from './cash.js';

export const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/** Fecha de hoy en Lima (YYYY-MM-DD). */
export function limaToday(now = new Date()): string {
  return new Date(now.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

export interface DaySummary {
  date: string;
  salesCount: number;
  salesCents: number;
  averageTicketCents: number;
  cashCents: number;
  digitalCents: number;
  byMethod: Record<string, number>;
  fiadoCents: number;
  abonosCents: number;
  cashInDrawerCents: number | null;
}

export async function daySummary(db: Db, date: string, sellerId?: string): Promise<DaySummary> {
  const range = [date, TZ];
  const sellerFilter = sellerId ? 'AND s.seller_id = $3' : '';
  const params = sellerId ? [...range, sellerId] : range;
  const inDay = `s.created_at >= ($1::date::timestamp AT TIME ZONE $2) AND s.created_at < (($1::date + 1)::timestamp AT TIME ZONE $2)`;
  const sales = await one<{ n: number; total: number }>(
    db,
    `SELECT count(*) AS n, COALESCE(SUM(total_cents), 0) AS total FROM sales s
      WHERE s.status = 'COMPLETED' AND ${inDay} ${sellerFilter}`,
    params,
  );
  const methods = await many<{ method: string; total: number }>(
    db,
    `SELECT p.method, SUM(p.amount_cents) AS total FROM payments p JOIN sales s ON s.id = p.sale_id
      WHERE s.status = 'COMPLETED' AND ${inDay} ${sellerFilter} GROUP BY p.method`,
    params,
  );
  const inDayMov = inDay.replaceAll('s.created_at', 'm.created_at');
  const credit = await one<{ fiado: number; abonos: number }>(
    db,
    `SELECT COALESCE(SUM(m.amount_cents) FILTER (WHERE m.kind = 'FIADO'), 0) AS fiado,
            COALESCE(SUM(m.amount_cents) FILTER (WHERE m.kind = 'ABONO' AND m.method IS NOT NULL), 0) AS abonos
       FROM credit_movements m LEFT JOIN sales s ON s.id = m.sale_id
      WHERE ${inDayMov} AND (s.id IS NULL OR s.status = 'COMPLETED')
        ${sellerId ? 'AND m.user_id = $3' : ''}`,
    params,
  );
  const byMethod = Object.fromEntries(methods.map((m) => [m.method, m.total]));
  const digital = ['YAPE', 'PLIN', 'TRANSFER', 'CARD'].reduce((a, k) => a + (byMethod[k] ?? 0), 0);
  const cash = sellerId ? null : await currentCash(db);
  const n = sales?.n ?? 0;
  return {
    date,
    salesCount: n,
    salesCents: sales?.total ?? 0,
    averageTicketCents: n ? Math.round((sales?.total ?? 0) / n) : 0,
    cashCents: byMethod.CASH ?? 0,
    digitalCents: digital,
    byMethod,
    fiadoCents: credit?.fiado ?? 0,
    abonosCents: credit?.abonos ?? 0,
    cashInDrawerCents: cash?.expectedCents ?? null,
  };
}

export type Period = 'day' | 'week' | 'month';

export interface CashflowBucket {
  start: string;
  salesCents: number;
  /** Dinero que realmente entró: efectivo + digital de ventas + abonos. */
  receivedCents: number;
  cashCents: number;
  digitalCents: number;
  fiadoCents: number;
  abonosCents: number;
  outCents: number;
  netCents: number;
}

export async function cashflow(db: Db, period: Period, buckets: number): Promise<CashflowBucket[]> {
  const rows = await many(
    db,
    `WITH series AS (
       SELECT generate_series(
         date_trunc($1, now() AT TIME ZONE $2) - ('1 ' || $1)::interval * ($3::int - 1),
         date_trunc($1, now() AT TIME ZONE $2),
         ('1 ' || $1)::interval) AS start
     ),
     pay AS (
       SELECT date_trunc($1, s.created_at AT TIME ZONE $2) AS start, p.method, SUM(p.amount_cents) AS total
         FROM payments p JOIN sales s ON s.id = p.sale_id
        WHERE s.status = 'COMPLETED'
        GROUP BY 1, 2
     ),
     sal AS (
       SELECT date_trunc($1, created_at AT TIME ZONE $2) AS start, SUM(total_cents) AS total
         FROM sales WHERE status = 'COMPLETED' GROUP BY 1
     ),
     abo AS (
       SELECT date_trunc($1, created_at AT TIME ZONE $2) AS start, SUM(amount_cents) AS total
         FROM credit_movements WHERE kind = 'ABONO' AND method IS NOT NULL GROUP BY 1
     ),
     outs AS (
       SELECT date_trunc($1, created_at AT TIME ZONE $2) AS start, SUM(amount_cents) AS total
         FROM cash_movements WHERE kind = 'OUT' GROUP BY 1
     )
     SELECT se.start,
            COALESCE(sal.total, 0) AS sales,
            COALESCE((SELECT SUM(total) FROM pay WHERE pay.start = se.start AND method = 'CASH'), 0) AS cash,
            COALESCE((SELECT SUM(total) FROM pay WHERE pay.start = se.start AND method IN ('YAPE','PLIN','TRANSFER','CARD')), 0) AS digital,
            COALESCE((SELECT SUM(total) FROM pay WHERE pay.start = se.start AND method = 'FIADO'), 0) AS fiado,
            COALESCE(abo.total, 0) AS abonos,
            COALESCE(outs.total, 0) AS outs
       FROM series se
       LEFT JOIN sal ON sal.start = se.start
       LEFT JOIN abo ON abo.start = se.start
       LEFT JOIN outs ON outs.start = se.start
      ORDER BY se.start`,
    [period, TZ, buckets],
  );
  return rows.map((r) => {
    const received = r.cash + r.digital + r.abonos;
    return {
      start: (r.start as Date).toISOString().slice(0, 10),
      salesCents: r.sales,
      receivedCents: received,
      cashCents: r.cash,
      digitalCents: r.digital,
      fiadoCents: r.fiado,
      abonosCents: r.abonos,
      outCents: r.outs,
      netCents: received - r.outs,
    };
  });
}

export interface Projection {
  /** Promedio semanal de las últimas 4 semanas completas. */
  weeklyAverageCents: number;
  /** Proyección para los próximos 7 días, día por día. */
  nextDays: { date: string; dayName: string; projectedCents: number }[];
  projectedWeekCents: number;
  lastWeekCents: number;
  /** Variación de la última semana contra el promedio (0.1 = +10 %). */
  trend: number;
}

/** Proyección simple: promedio de cada día de la semana en las últimas 4 semanas. */
export async function projection(db: Db, today = limaToday()): Promise<Projection> {
  const rows = await many<{ day: Date; total: number }>(
    db,
    `SELECT d::date AS day, COALESCE(SUM(s.total_cents), 0) AS total
       FROM generate_series($1::date - 28, $1::date - 1, '1 day') d
       LEFT JOIN sales s ON s.status = 'COMPLETED'
        AND s.created_at >= (d::timestamp AT TIME ZONE $2) AND s.created_at < ((d + interval '1 day')::timestamp AT TIME ZONE $2)
      GROUP BY d ORDER BY d`,
    [today, TZ],
  );
  const byDow = Array.from({ length: 7 }, () => [] as number[]);
  for (const r of rows) byDow[isoDow(r.day)]!.push(r.total);
  const avg = byDow.map((v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0));
  const total28 = rows.reduce((a, r) => a + r.total, 0);
  const lastWeek = rows.slice(-7).reduce((a, r) => a + r.total, 0);
  const weeklyAverage = Math.round(total28 / 4);
  const nextDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const dow = isoDow(d);
    return { date: d.toISOString().slice(0, 10), dayName: DAY_NAMES[dow]!, projectedCents: Math.round(avg[dow]!) };
  });
  return {
    weeklyAverageCents: weeklyAverage,
    nextDays,
    projectedWeekCents: nextDays.reduce((a, d) => a + d.projectedCents, 0),
    lastWeekCents: lastWeek,
    trend: weeklyAverage ? (lastWeek - weeklyAverage) / weeklyAverage : 0,
  };
}

/** 0 = lunes ... 6 = domingo. */
function isoDow(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

export interface ProductStat {
  productId: string;
  name: string;
  unitsSold: number;
  revenueCents: number;
  stock: number;
  minStock: number;
  unit: string;
  avgDailyUnits: number;
  daysSinceLastSale: number | null;
  stockValueCents: number;
}

async function productStats(db: Db, days: number): Promise<ProductStat[]> {
  const rows = await many(
    db,
    `SELECT p.id, p.name, p.stock, p.min_stock, p.unit, p.price_cents, COALESCE(p.cost_cents, p.price_cents) AS unit_value,
            COALESCE(SUM(i.quantity) FILTER (WHERE s.created_at >= now() - make_interval(days => $1)), 0) AS units,
            COALESCE(SUM(i.total_cents - i.discount_cents) FILTER (WHERE s.created_at >= now() - make_interval(days => $1)), 0) AS revenue,
            EXTRACT(DAY FROM now() - MAX(s.created_at))::int AS days_since,
            p.created_at
       FROM products p
       LEFT JOIN sale_items i ON i.product_id = p.id
       LEFT JOIN sales s ON s.id = i.sale_id AND s.status = 'COMPLETED'
      WHERE p.active
      GROUP BY p.id`,
    [days],
  );
  return rows.map((r) => ({
    productId: r.id,
    name: r.name,
    unitsSold: Number(r.units),
    revenueCents: Number(r.revenue),
    stock: Number(r.stock),
    minStock: Number(r.min_stock),
    unit: r.unit,
    avgDailyUnits: Number(r.units) / days,
    daysSinceLastSale: r.days_since ?? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000),
    stockValueCents: Math.round(Math.max(0, Number(r.stock)) * r.unit_value),
  }));
}

export async function topProducts(db: Db, days = 28, limit = 5): Promise<ProductStat[]> {
  const stats = await productStats(db, days);
  return stats
    .filter((s) => s.unitsSold > 0)
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, limit);
}

/** Menor rotación: productos con stock que casi no se venden (los que más plata inmovilizan primero). */
export async function slowProducts(db: Db, days = 28, limit = 5): Promise<ProductStat[]> {
  const stats = await productStats(db, days);
  return stats
    .filter((s) => s.stock > 0)
    .sort((a, b) => a.unitsSold - b.unitsSold || b.stockValueCents - a.stockValueCents)
    .slice(0, limit);
}

export interface Heatmap {
  /** matrix[día 0=lunes][hora 0-23] = venta promedio por semana, en céntimos. */
  matrix: number[][];
  weeks: number;
}

export async function heatmap(db: Db, weeks = 4): Promise<Heatmap> {
  const rows = await many<{ dow: number; hour: number; total: number }>(
    db,
    `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE $1)::int - 1 AS dow,
            EXTRACT(HOUR FROM created_at AT TIME ZONE $1)::int AS hour,
            SUM(total_cents) AS total
       FROM sales
      WHERE status = 'COMPLETED' AND created_at >= now() - make_interval(weeks => $2)
      GROUP BY 1, 2`,
    [TZ, weeks],
  );
  const matrix = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) matrix[r.dow]![r.hour] = Math.round(r.total / weeks);
  return { matrix, weeks };
}
