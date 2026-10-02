import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { isValidRuc } from '@perupos/shared';
import { audit, many, one, pool } from '../db/pool.js';
import { currentUser, requireAuth, requirePermission } from '../http/auth.js';
import { badRequest, notFound, parse } from '../http/errors.js';
import { settingsSchema, userCreateSchema, userUpdateSchema } from '../http/schemas.js';
import { toUser } from '../services/mappers.js';
import { qrProvider } from '../services/payments/provider.js';
import { pseProvider } from '../services/pse/provider.js';
import { getSettings } from '../services/settings.js';
import { checkRuc } from '../services/ruc.js';
import { config } from '../config.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

// ---- Usuarios ----

adminRouter.get('/users', requirePermission('users.manage'), async (_req, res) => {
  const rows = await many(pool, 'SELECT * FROM users ORDER BY active DESC, role, name');
  res.json(rows.map(toUser));
});

adminRouter.post('/users', requirePermission('users.manage'), async (req, res) => {
  const body = parse(userCreateSchema, req.body);
  if (body.role !== 'ADMIN' && !/^\d{4,6}$/.test(body.secret) && body.secret.length < 8) {
    throw badRequest('Usa un PIN de 4 a 6 números o una contraseña de 8 caracteres o más.');
  }
  const row = await one(
    pool,
    'INSERT INTO users (name, username, role, secret_hash) VALUES ($1, $2, $3, $4) RETURNING *',
    [body.name, body.username, body.role, await bcrypt.hash(body.secret, 10)],
  );
  await audit(pool, currentUser(req).id, 'CREA_USUARIO', 'user', row!.id, { role: body.role });
  res.status(201).json(toUser(row!));
});

adminRouter.patch('/users/:id', requirePermission('users.manage'), async (req, res) => {
  const body = parse(userUpdateSchema, req.body);
  const target = await one(pool, 'SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!target) throw notFound('No se encontró el usuario.');
  const demotingAdmin = target.role === 'ADMIN' && (body.active === false || (body.role && body.role !== 'ADMIN'));
  if (demotingAdmin) {
    const admins = await one<{ n: number }>(pool, "SELECT count(*) AS n FROM users WHERE role = 'ADMIN' AND active");
    if ((admins?.n ?? 0) <= 1) throw badRequest('Debe quedar al menos un Administrador activo.');
  }
  const row = await one(
    pool,
    `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role), active = COALESCE($4, active),
            secret_hash = COALESCE($5, secret_hash), failed_attempts = 0, locked_until = NULL
      WHERE id = $1 RETURNING *`,
    [req.params.id, body.name, body.role, body.active, body.secret ? await bcrypt.hash(body.secret, 10) : null],
  );
  if (body.active === false) {
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.params.id]);
  }
  await audit(pool, currentUser(req).id, 'EDITA_USUARIO', 'user', req.params.id as string, { ...body, secret: body.secret ? '***' : undefined });
  res.json(toUser(row!));
});

// ---- Configuración del negocio ----

adminRouter.get('/settings', requirePermission('settings.read'), async (_req, res) => {
  res.json(await getSettings(pool));
});

adminRouter.put('/settings', requirePermission('settings.edit'), async (req, res) => {
  const s = parse(settingsSchema, req.body);
  if (!isValidRuc(s.ruc)) throw badRequest('El RUC no es válido (revisa el último dígito).', 'RUC_INVALIDO');
  await pool.query(
    `INSERT INTO business_settings (id, ruc, razon_social, nombre_comercial, direccion, ubigeo, phone, tax_regime,
       cash_low_threshold_cents, default_credit_limit_cents, overdue_days, stale_product_days, credit_alert_ratio,
       yape_plin_enabled, receipt_footer)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO UPDATE SET ruc = $1, razon_social = $2, nombre_comercial = $3, direccion = $4, ubigeo = $5,
       phone = $6, tax_regime = $7, cash_low_threshold_cents = $8, default_credit_limit_cents = $9, overdue_days = $10,
       stale_product_days = $11, credit_alert_ratio = $12, yape_plin_enabled = $13, receipt_footer = $14`,
    [
      s.ruc, s.razonSocial, s.nombreComercial, s.direccion, s.ubigeo ?? null, s.phone ?? null, s.taxRegime,
      s.cashLowThresholdCents, s.defaultCreditLimitCents, s.overdueDays, s.staleProductDays, s.creditAlertRatio,
      s.yapePlinEnabled, s.receiptFooter ?? null,
    ],
  );
  await audit(pool, currentUser(req).id, 'EDITA_CONFIGURACION', 'settings', '1', s);
  res.json(await getSettings(pool));
});

/** Consulta un RUC en la copia local del padrón de SUNAT (para facturas y para el RUC del negocio). */
adminRouter.get('/ruc/:ruc', requirePermission('settings.read'), async (req, res) => {
  const ruc = String(req.params.ruc).replace(/\D/g, '');
  res.json(await checkRuc(pool, ruc));
});

/** Estado de las integraciones (sin exponer llaves). */
adminRouter.get('/settings/integrations', requirePermission('settings.edit'), async (_req, res) => {
  res.json({
    payments: {
      provider: qrProvider().name,
      environment: config.PAYMENTS_PROVIDER === 'taypi' ? config.TAYPI_BASE_URL : 'prueba',
      webhookConfigured: !!config.TAYPI_WEBHOOK_SECRET,
    },
    pse: { provider: pseProvider()?.name ?? 'ninguno' },
    push: { enabled: config.PUSH_ENABLED },
  });
});

adminRouter.get('/doc-series', requirePermission('settings.edit'), async (_req, res) => {
  res.json(await many(pool, 'SELECT serie, doc_type AS "docType", last_number AS "lastNumber", active FROM doc_series ORDER BY serie'));
});

adminRouter.post('/doc-series', requirePermission('settings.edit'), async (req, res) => {
  const body = parse(
    z.object({ serie: z.string().regex(/^[A-Z0-9]{4}$/, 'La serie tiene 4 caracteres (ej. B001)'), docType: z.enum(['TICKET_POS', 'BOLETA', 'FACTURA']) }),
    req.body,
  );
  if (body.docType === 'BOLETA' && !body.serie.startsWith('B')) throw badRequest('La serie de boletas empieza con B.');
  if (body.docType === 'FACTURA' && !body.serie.startsWith('F')) throw badRequest('La serie de facturas empieza con F.');
  await pool.query('INSERT INTO doc_series (serie, doc_type) VALUES ($1, $2)', [body.serie, body.docType]);
  res.status(201).json({ ok: true });
});

// ---- Cuentas bancarias (solo Admin) ----

const bankSchema = z.object({
  bank: z.string().trim().min(2).max(60),
  accountType: z.enum(['AHORROS', 'CORRIENTE']).default('AHORROS'),
  accountNumber: z.string().trim().regex(/^[0-9-]{6,30}$/, 'Número de cuenta inválido'),
  cci: z.string().regex(/^\d{20}$/, 'El CCI tiene 20 dígitos').nullable().optional(),
  holder: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
});

const toBank = (r: Record<string, any>) => ({
  id: r.id,
  bank: r.bank,
  accountType: r.account_type,
  accountNumber: r.account_number,
  cci: r.cci,
  holder: r.holder,
  active: r.active,
});

adminRouter.get('/bank-accounts', requirePermission('banking.edit'), async (_req, res) => {
  res.json((await many(pool, 'SELECT * FROM bank_accounts ORDER BY active DESC, created_at')).map(toBank));
});

adminRouter.post('/bank-accounts', requirePermission('banking.edit'), async (req, res) => {
  const b = parse(bankSchema, req.body);
  const row = await one(
    pool,
    'INSERT INTO bank_accounts (bank, account_type, account_number, cci, holder, active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [b.bank, b.accountType, b.accountNumber, b.cci ?? null, b.holder, b.active],
  );
  await audit(pool, currentUser(req).id, 'CREA_CUENTA_BANCARIA', 'bank_account', row!.id, { bank: b.bank });
  res.status(201).json(toBank(row!));
});

adminRouter.put('/bank-accounts/:id', requirePermission('banking.edit'), async (req, res) => {
  const b = parse(bankSchema, req.body);
  const row = await one(
    pool,
    `UPDATE bank_accounts SET bank = $2, account_type = $3, account_number = $4, cci = $5, holder = $6, active = $7
      WHERE id = $1 RETURNING *`,
    [req.params.id, b.bank, b.accountType, b.accountNumber, b.cci ?? null, b.holder, b.active],
  );
  if (!row) throw notFound();
  await audit(pool, currentUser(req).id, 'EDITA_CUENTA_BANCARIA', 'bank_account', row.id, { bank: b.bank });
  res.json(toBank(row));
});

adminRouter.get('/audit', requirePermission('users.manage'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  res.json(
    await many(
      pool,
      `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.details, a.created_at AS "createdAt", u.name AS "userName"
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT $1`,
      [limit],
    ),
  );
});
