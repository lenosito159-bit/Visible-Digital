import { Router } from 'express';
import { z } from 'zod';
import { ROLES, can, paydayInfo, type Role } from '@perupos/shared';
import { many, one, pool } from '../db/pool.js';
import { currentUser, requireAuth, requirePermission } from '../http/auth.js';
import { notFound, parse } from '../http/errors.js';
import { cents } from '../http/schemas.js';
import { evaluateAlerts } from '../services/alerts.js';
import { addCashMovement, closeCash, currentCash, openCash, recentClosures } from '../services/cash.js';
import { listCustomers } from '../services/credit.js';
import { iso, toAlert } from '../services/mappers.js';
import { pushToRoles } from '../services/push.js';
import { buildRecommendations } from '../services/recommendations.js';
import { cashflow, daySummary, heatmap, limaToday, projection, slowProducts, topProducts } from '../services/reports.js';
import { getSettings } from '../services/settings.js';
import { exportSire } from '../services/sire.js';

export const financeRouter = Router();
financeRouter.use(requireAuth);

// ---- Caja ----

financeRouter.get('/cash/current', requirePermission('cash.operate', 'reports.financial'), async (_req, res) => {
  res.json(await currentCash(pool));
});

financeRouter.post('/cash/open', requirePermission('cash.operate'), async (req, res) => {
  const { openingCents } = parse(z.object({ openingCents: cents }), req.body);
  res.status(201).json(await openCash(currentUser(req), openingCents));
});

financeRouter.post('/cash/movements', requirePermission('cash.operate'), async (req, res) => {
  const body = parse(
    z.object({
      kind: z.enum(['IN', 'OUT']),
      amountCents: z.number().int().positive(),
      reason: z.string().trim().min(3, 'Escribe el motivo').max(120),
    }),
    req.body,
  );
  res.status(201).json(await addCashMovement(currentUser(req), body.kind, body.amountCents, body.reason));
});

financeRouter.post('/cash/close', requirePermission('cash.operate'), async (req, res) => {
  const body = parse(
    z.object({ countedCents: cents, transferredCents: cents.default(0), notes: z.string().max(200).nullable().optional() }),
    req.body,
  );
  res.json(await closeCash(currentUser(req), body.countedCents, body.transferredCents, body.notes ?? null));
});

financeRouter.get('/cash/closures', requirePermission('reports.financial'), async (_req, res) => {
  res.json(await recentClosures(pool));
});

// ---- Reportes ----

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Resumen del día. El vendedor solo ve el suyo. */
financeRouter.get('/reports/summary', requirePermission('sales.read.own', 'reports.financial'), async (req, res) => {
  const user = currentUser(req);
  const { date } = parse(z.object({ date: dateParam.optional() }), req.query);
  const sellerId = can(user.role, 'reports.financial') ? undefined : user.id;
  res.json(await daySummary(pool, date ?? limaToday(), sellerId));
});

financeRouter.get('/reports/cashflow', requirePermission('reports.financial'), async (req, res) => {
  const q = parse(
    z.object({ period: z.enum(['day', 'week', 'month']).default('day'), buckets: z.coerce.number().int().min(1).max(60).default(14) }),
    req.query,
  );
  res.json(await cashflow(pool, q.period, q.buckets));
});

financeRouter.get('/reports/projection', requirePermission('reports.financial'), async (_req, res) => {
  res.json(await projection(pool));
});

financeRouter.get('/reports/products', requirePermission('reports.financial'), async (_req, res) => {
  res.json({ top: await topProducts(pool), slow: await slowProducts(pool) });
});

financeRouter.get('/reports/heatmap', requirePermission('reports.financial'), async (_req, res) => {
  res.json(await heatmap(pool));
});

/** Libro de ventas para el SIRE (RVIE). */
financeRouter.get('/reports/sire', requirePermission('reports.sire'), async (req, res) => {
  const { period } = parse(z.object({ period: z.string().regex(/^\d{6}$/, 'Periodo AAAAMM') }), req.query);
  const file = await exportSire(pool, period);
  res
    .type('text/plain; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
    .setHeader('X-Sire-Rows', String(file.rows))
    .send(file.content);
});

// ---- Agente financiero ----

async function recommendations() {
  const settings = await getSettings(pool);
  const [top, slow, overdueCustomers, debtors, map, cash] = await Promise.all([
    topProducts(pool),
    slowProducts(pool),
    listCustomers(pool, { overdueDays: settings.overdueDays, sort: 'amount' }),
    listCustomers(pool, { withDebt: true }),
    heatmap(pool),
    currentCash(pool),
  ]);
  const overdue = overdueCustomers.map((c) => {
    const ref = [c.lastPaymentAt, c.oldestDebtAt].filter(Boolean).map((d) => new Date(d!).getTime());
    return {
      id: c.id,
      name: c.name,
      balanceCents: c.balanceCents,
      days: ref.length ? Math.floor((Date.now() - Math.max(...ref)) / 86_400_000) : 0,
    };
  });
  return {
    top,
    slow,
    heatmap: map,
    recommendations: buildRecommendations({
      top,
      slow,
      overdue,
      heatmap: map,
      cashInDrawerCents: cash?.expectedCents ?? null,
      cashLowThresholdCents: settings.cashLowThresholdCents,
      staleDays: settings.staleProductDays,
      payday: paydayInfo(),
      debtors: { count: debtors.length, totalCents: debtors.reduce((a, c) => a + c.balanceCents, 0) },
    }),
  };
}

/** Todo el tablero del agente en una sola llamada (menos datos móviles). */
financeRouter.get('/agent/dashboard', requirePermission('reports.financial'), async (req, res) => {
  const user = currentUser(req);
  const [summary, proj, weekly, monthly, daily, rec, alerts] = await Promise.all([
    daySummary(pool, limaToday()),
    projection(pool),
    cashflow(pool, 'week', 8),
    cashflow(pool, 'month', 6),
    cashflow(pool, 'day', 14),
    recommendations(),
    openAlerts(user.role, user.id),
  ]);
  res.json({
    summary,
    projection: proj,
    cashflow: { day: daily, week: weekly, month: monthly },
    topProducts: rec.top,
    slowProducts: rec.slow,
    heatmap: rec.heatmap,
    recommendations: rec.recommendations,
    alerts,
  });
});

financeRouter.get('/agent/recommendations', requirePermission('reports.financial'), async (_req, res) => {
  res.json((await recommendations()).recommendations);
});

// ---- Alertas ----

async function openAlerts(role: Role, userId: string) {
  const rows = await many(
    pool,
    `SELECT a.*, r.read_at FROM alerts a
       LEFT JOIN alert_reads r ON r.alert_id = a.id AND r.user_id = $2
      WHERE a.resolved_at IS NULL AND ($1 = ANY(a.target_roles) OR $1 IN ('ADMIN', 'AGENTE'))
      ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.created_at DESC`,
    [role, userId],
  );
  return rows.map((r) => ({ ...toAlert(r), read: !!r.read_at }));
}

financeRouter.get('/alerts', requirePermission('alerts.read'), async (req, res) => {
  const user = currentUser(req);
  res.json(await openAlerts(user.role, user.id));
});

financeRouter.post('/alerts/:id/read', requirePermission('alerts.read'), async (req, res) => {
  await pool.query('INSERT INTO alert_reads (alert_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    req.params.id,
    currentUser(req).id,
  ]);
  res.status(204).end();
});

financeRouter.post('/alerts/evaluate', requirePermission('alerts.manage'), async (_req, res) => {
  res.json(await evaluateAlerts());
});

// ---- Notificaciones del agente al Admin y al Vendedor ----

financeRouter.post('/notifications', requirePermission('notifications.send'), async (req, res) => {
  const body = parse(
    z.object({
      title: z.string().trim().min(3).max(80),
      body: z.string().trim().min(3).max(400),
      targetRoles: z.array(z.enum(ROLES)).min(1),
    }),
    req.body,
  );
  const user = currentUser(req);
  const row = await one(
    pool,
    'INSERT INTO notifications (from_user_id, title, body, target_roles) VALUES ($1, $2, $3, $4) RETURNING *',
    [user.id, body.title, body.body, body.targetRoles],
  );
  const pushed = await pushToRoles(body.targetRoles, { title: body.title, body: body.body, data: { notificationId: row!.id } });
  res.status(201).json({ id: row!.id, pushed });
});

financeRouter.get('/notifications', requirePermission('alerts.read'), async (req, res) => {
  const user = currentUser(req);
  const rows = await many(
    pool,
    `SELECT n.*, u.name AS from_name, r.read_at FROM notifications n
       JOIN users u ON u.id = n.from_user_id
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $2
      WHERE $1 = ANY(n.target_roles) OR n.from_user_id = $2
      ORDER BY n.created_at DESC LIMIT 50`,
    [user.role, user.id],
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      fromName: r.from_name,
      title: r.title,
      body: r.body,
      targetRoles: r.target_roles,
      createdAt: iso(r.created_at),
      readAt: r.read_at ? iso(r.read_at) : null,
    })),
  );
});

financeRouter.post('/notifications/:id/read', requirePermission('alerts.read'), async (req, res) => {
  const exists = await one(pool, 'SELECT id FROM notifications WHERE id = $1', [req.params.id]);
  if (!exists) throw notFound();
  await pool.query('INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    req.params.id,
    currentUser(req).id,
  ]);
  res.status(204).end();
});
