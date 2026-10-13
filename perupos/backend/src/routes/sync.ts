import { Router } from 'express';
import { z } from 'zod';
import { can, permissionsFor } from '@perupos/shared';
import { many, one, pool } from '../db/pool.js';
import { currentUser, requireAuth, type AuthUser } from '../http/auth.js';
import { HttpError, parse } from '../http/errors.js';
import { abonoInputSchema, customerInputSchema, productQuickSchema, saleInputSchema } from '../http/schemas.js';
import { createAbono, listCustomers } from '../services/credit.js';
import { toCategory, toProduct } from '../services/mappers.js';
import { createSale } from '../services/sales.js';
import { getSettings } from '../services/settings.js';
import { createCustomer } from './customers.js';
import { afterSale } from './sales.js';

export const syncRouter = Router();
syncRouter.use(requireAuth);

/**
 * Descarga lo que cambió desde la última sincronización: catálogo, clientes
 * con su deuda y configuración. Con esto el teléfono puede vender sin internet.
 */
syncRouter.get('/sync/pull', async (req, res) => {
  const { since } = parse(z.object({ since: z.string().datetime({ offset: true }).optional() }), req.query);
  const user = currentUser(req);
  const serverTime = (await one<{ now: Date }>(pool, 'SELECT now() AS now'))!.now;
  const params = since ? [since] : [];
  const changed = since ? 'WHERE updated_at > $1' : '';
  const [settings, categories, products, customers] = await Promise.all([
    getSettings(pool),
    many(pool, 'SELECT * FROM categories ORDER BY sort_order, name'),
    many(pool, `SELECT * FROM products ${changed} ORDER BY name`, params),
    can(user.role, 'customers.read') ? listCustomers(pool, { since }) : Promise.resolve([]),
  ]);
  // Los clientes desactivados también se envían para que el teléfono los quite.
  const inactive = since
    ? await many<{ id: string }>(pool, 'SELECT id FROM customers WHERE NOT active AND updated_at > $1', [since])
    : [];
  res.json({
    serverTime: serverTime.toISOString(),
    full: !since,
    settings,
    permissions: permissionsFor(user.role),
    categories: categories.map(toCategory),
    products: products.map(toProduct),
    customers,
    removedCustomerIds: inactive.map((c) => c.id),
  });
});

const pushSchema = z.object({
  customers: z.array(z.unknown()).max(200).default([]),
  products: z.array(z.unknown()).max(200).default([]),
  sales: z.array(z.unknown()).max(200).default([]),
  abonos: z.array(z.unknown()).max(200).default([]),
});

interface PushResult {
  kind: 'customer' | 'product' | 'sale' | 'abono';
  id: string | null;
  ok: boolean;
  /** permanent = no tiene sentido reintentar (datos inválidos o reglas de negocio). */
  permanent?: boolean;
  error?: string;
  code?: string;
  data?: unknown;
}

async function attempt(kind: PushResult['kind'], raw: unknown, fn: () => Promise<unknown>): Promise<PushResult> {
  const id = typeof raw === 'object' && raw && 'id' in raw ? String((raw as { id: unknown }).id) : null;
  try {
    return { kind, id, ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof HttpError) {
      return { kind, id, ok: false, permanent: err.status < 500, error: err.message, code: err.code };
    }
    console.error(err);
    return { kind, id, ok: false, permanent: false, error: 'Error del servidor, se reintentará.' };
  }
}

async function createProductFromSync(user: AuthUser, raw: unknown) {
  const body = parse(productQuickSchema, raw);
  if (!can(user.role, 'products.quickCreate')) throw new HttpError(403, 'Sin permiso para crear productos.', 'SIN_PERMISO');
  if (body.id) {
    const existing = await one(pool, 'SELECT * FROM products WHERE id = $1', [body.id]);
    if (existing) return toProduct(existing);
  }
  const row = await one(
    pool,
    `INSERT INTO products (id, barcode, name, category_id, price_cents, unit, created_by)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7) RETURNING *`,
    [body.id ?? null, body.barcode ?? null, body.name, body.categoryId ?? null, body.priceCents, body.unit, user.id],
  );
  await pool.query('INSERT INTO price_history (product_id, price_cents, changed_by) VALUES ($1, $2, $3)', [
    row!.id,
    body.priceCents,
    user.id,
  ]);
  return toProduct(row!);
}

/**
 * Sube lo registrado sin internet. Se procesa en orden (clientes y productos
 * antes que las ventas que los usan) y cada elemento por separado: si uno
 * falla, los demás igual se guardan. Todo es idempotente por id.
 */
syncRouter.post('/sync/push', async (req, res) => {
  const user = currentUser(req);
  const body = parse(pushSchema, req.body);
  const results: PushResult[] = [];

  for (const raw of body.customers) {
    results.push(await attempt('customer', raw, () => createCustomer(user, parse(customerInputSchema, raw))));
  }
  for (const raw of body.products) {
    results.push(await attempt('product', raw, () => createProductFromSync(user, raw)));
  }
  let createdSales = 0;
  for (const raw of body.sales) {
    results.push(
      await attempt('sale', raw, async () => {
        if (!can(user.role, 'sales.create')) throw new HttpError(403, 'Sin permiso para vender.', 'SIN_PERMISO');
        const { sale, created } = await createSale(user, parse(saleInputSchema, raw));
        if (created) createdSales++;
        return sale;
      }),
    );
  }
  for (const raw of body.abonos) {
    results.push(
      await attempt('abono', raw, () => {
        if (!can(user.role, 'credit.abono')) throw new HttpError(403, 'Sin permiso para abonos.', 'SIN_PERMISO');
        return createAbono(user, parse(abonoInputSchema, raw));
      }),
    );
  }
  if (createdSales > 0 || body.abonos.length > 0) afterSale();
  res.json({ results });
});
