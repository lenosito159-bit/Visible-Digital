import { Router } from 'express';
import { z } from 'zod';
import { can, isValidDni, isValidRuc, normalizePeruMobile } from '@perupos/shared';
import { audit, one, pool } from '../db/pool.js';
import { currentUser, requireAuth, requirePermission, type AuthUser } from '../http/auth.js';
import { badRequest, forbidden, notFound, parse } from '../http/errors.js';
import { abonoInputSchema, customerInputSchema } from '../http/schemas.js';
import { createAbono, getCustomer, getLedger, listCustomers } from '../services/credit.js';
import { getSettings } from '../services/settings.js';

export const customersRouter = Router();
customersRouter.use(requireAuth);

type CustomerInput = z.infer<typeof customerInputSchema>;

function validateCustomer(body: CustomerInput): void {
  if (body.phone && !normalizePeruMobile(body.phone)) throw badRequest('El celular debe tener 9 dígitos y empezar con 9.');
  if (body.docType === 'DNI' && body.docNumber && !isValidDni(body.docNumber)) throw badRequest('El DNI tiene 8 dígitos.');
  if (body.docType === 'RUC' && body.docNumber && !isValidRuc(body.docNumber)) throw badRequest('El RUC no es válido.');
}

/** Crea un cliente. Idempotente por id para poder crearlo sin internet. */
export async function createCustomer(user: AuthUser, body: CustomerInput) {
  validateCustomer(body);
  if (body.id) {
    const existing = await getCustomer(pool, body.id);
    if (existing) return existing;
  }
  // Solo el Admin fija el límite de crédito; los demás usan el límite por defecto.
  if (body.creditLimitCents !== undefined && !can(user.role, 'customers.editCreditLimit')) {
    body.creditLimitCents = undefined;
  }
  const settings = await getSettings(pool);
  const row = await one(
    pool,
    `INSERT INTO customers (id, name, phone, photo_url, doc_type, doc_number, credit_limit_cents, created_by)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      body.id ?? null,
      body.name,
      body.phone ?? null,
      body.photoUrl ?? null,
      body.docType,
      body.docNumber ?? null,
      body.creditLimitCents ?? settings.defaultCreditLimitCents,
      user.id,
    ],
  );
  return (await getCustomer(pool, row!.id))!;
}

customersRouter.get('/customers', requirePermission('customers.read'), async (req, res) => {
  const q = parse(
    z.object({
      search: z.string().max(60).optional(),
      withDebt: z.enum(['1', '0']).optional(),
      overdue: z.enum(['1', '0']).optional(),
      sort: z.enum(['name', 'amount', 'age']).optional(),
    }),
    req.query,
  );
  const settings = await getSettings(pool);
  res.json(
    await listCustomers(pool, {
      search: q.search,
      withDebt: q.withDebt === '1',
      overdueDays: q.overdue === '1' ? settings.overdueDays : undefined,
      sort: q.sort,
    }),
  );
});

customersRouter.get('/customers/:id', requirePermission('customers.read'), async (req, res) => {
  const customer = await getCustomer(pool, req.params.id as string);
  if (!customer) throw notFound('No se encontró al cliente.');
  res.json({ customer, ledger: await getLedger(pool, customer.id) });
});

customersRouter.post('/customers', requirePermission('customers.create'), async (req, res) => {
  const customer = await createCustomer(currentUser(req), parse(customerInputSchema, req.body));
  res.status(201).json(customer);
});

customersRouter.patch('/customers/:id', requirePermission('customers.create'), async (req, res) => {
  const user = currentUser(req);
  const body = parse(customerInputSchema.partial().extend({ active: z.boolean().optional() }), req.body);
  if (body.creditLimitCents !== undefined && !can(user.role, 'customers.editCreditLimit')) {
    throw forbidden('Solo el Administrador puede cambiar el límite de crédito.');
  }
  if (body.active !== undefined && !can(user.role, 'customers.editCreditLimit')) throw forbidden();
  validateCustomer({ docType: 'NONE', name: 'x', ...body } as CustomerInput);
  const before = await one(pool, 'SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!before) throw notFound('No se encontró al cliente.');
  await pool.query(
    `UPDATE customers SET name = COALESCE($2, name), phone = COALESCE($3, phone), photo_url = COALESCE($4, photo_url),
            doc_type = COALESCE($5, doc_type), doc_number = COALESCE($6, doc_number),
            credit_limit_cents = COALESCE($7, credit_limit_cents), active = COALESCE($8, active)
      WHERE id = $1`,
    [
      req.params.id,
      body.name ?? null,
      body.phone ?? null,
      body.photoUrl ?? null,
      body.docType ?? null,
      body.docNumber ?? null,
      body.creditLimitCents ?? null,
      body.active ?? null,
    ],
  );
  if (body.creditLimitCents !== undefined && body.creditLimitCents !== before.credit_limit_cents) {
    await audit(pool, user.id, 'CAMBIA_LIMITE_CREDITO', 'customer', before.id, {
      from: before.credit_limit_cents,
      to: body.creditLimitCents,
    });
  }
  res.json(await getCustomer(pool, req.params.id as string));
});

customersRouter.post('/abonos', requirePermission('credit.abono'), async (req, res) => {
  const receipt = await createAbono(currentUser(req), parse(abonoInputSchema, req.body));
  res.status(201).json(receipt);
});
