import * as SQLite from 'expo-sqlite';
import type { BusinessSettings, Category, Customer, Product, Sale } from '@perupos/shared';

/**
 * Base de datos local (SQLite). Guarda el catálogo, los clientes y todo lo
 * que se registra sin internet ("outbox") hasta que se pueda enviar.
 */
let db: SQLite.SQLiteDatabase | null = null;

export function database(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('La base local no está lista');
  return db;
}

export async function initDb(): Promise<void> {
  db = await SQLite.openDatabaseAsync('perupos.db');
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, icon TEXT NOT NULL, sort_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL, barcode TEXT, name TEXT NOT NULL, category_id TEXT,
      price_cents INTEGER NOT NULL, cost_cents INTEGER, stock REAL NOT NULL, min_stock REAL NOT NULL,
      unit TEXT NOT NULL, tax_affectation TEXT NOT NULL, image_url TEXT, active INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS products_barcode ON products (barcode);
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, phone TEXT, photo_url TEXT, doc_type TEXT NOT NULL,
      doc_number TEXT, credit_limit_cents INTEGER NOT NULL, balance_cents INTEGER NOT NULL,
      pending_cents INTEGER NOT NULL DEFAULT 0, oldest_debt_at TEXT, last_payment_at TEXT,
      active INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS products_category ON products (category_id, name);
    CREATE TABLE IF NOT EXISTS local_sales (
      id TEXT PRIMARY KEY NOT NULL, seller_id TEXT NOT NULL, data TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, failed INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Columnas agregadas después de la primera versión (celulares que ya tenían la app).
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(customers)');
  if (!cols.some((c) => c.name === 'trato')) await db.execAsync('ALTER TABLE customers ADD COLUMN trato TEXT');
  if (!cols.some((c) => c.name === 'reputation')) await db.execAsync('ALTER TABLE customers ADD COLUMN reputation TEXT');
}

// ---------- clave-valor ----------

export async function getKv<T>(key: string): Promise<T | null> {
  const row = await database().getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await database().runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, JSON.stringify(value));
}

export const getSettings = () => getKv<BusinessSettings>('settings');

// ---------- catálogo ----------

interface ProductRow {
  id: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  price_cents: number;
  cost_cents: number | null;
  stock: number;
  min_stock: number;
  unit: Product['unit'];
  tax_affectation: Product['taxAffectation'];
  image_url: string | null;
  active: number;
  updated_at: string;
}

const toProduct = (r: ProductRow): Product => ({
  id: r.id,
  barcode: r.barcode,
  name: r.name,
  categoryId: r.category_id,
  priceCents: r.price_cents,
  costCents: r.cost_cents,
  stock: r.stock,
  minStock: r.min_stock,
  unit: r.unit,
  taxAffectation: r.tax_affectation,
  imageUrl: r.image_url,
  active: !!r.active,
  updatedAt: r.updated_at,
});

export async function saveCategories(categories: Category[]): Promise<void> {
  const d = database();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM categories');
    for (const c of categories) {
      await d.runAsync('INSERT INTO categories (id, name, icon, sort_order) VALUES (?, ?, ?, ?)', c.id, c.name, c.icon, c.sortOrder);
    }
  });
}

export async function listCategories(): Promise<Category[]> {
  const rows = await database().getAllAsync<{ id: string; name: string; icon: string; sort_order: number }>(
    'SELECT * FROM categories ORDER BY sort_order, name',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon, sortOrder: r.sort_order }));
}

/**
 * Guarda el catálogo con una sola sentencia preparada dentro de una transacción:
 * en un celular de gama baja, 1,000 productos se guardan en segundos y no en minutos.
 */
export async function saveProducts(products: Product[]): Promise<void> {
  if (products.length === 0) return;
  const d = database();
  await d.withTransactionAsync(async () => {
    const stmt = await d.prepareAsync(
      `INSERT OR REPLACE INTO products (id, barcode, name, category_id, price_cents, cost_cents, stock, min_stock, unit,
         tax_affectation, image_url, active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const p of products) {
        await stmt.executeAsync(
          p.id, p.barcode, p.name, p.categoryId, p.priceCents, p.costCents, p.stock, p.minStock, p.unit,
          p.taxAffectation, p.imageUrl, p.active ? 1 : 0, p.updatedAt,
        );
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

/** Tamaño de página del catálogo: lo que entra en 2–3 pantallas. */
export const PAGE_SIZE = 60;

export async function listProducts(
  filter: { search?: string; categoryId?: string | null; limit?: number; offset?: number } = {},
): Promise<Product[]> {
  const where = ['active = 1'];
  const params: string[] = [];
  if (filter.search?.trim()) {
    where.push('(name LIKE ? OR barcode LIKE ?)');
    const q = `%${filter.search.trim()}%`;
    params.push(q, q);
  }
  if (filter.categoryId) {
    where.push('category_id = ?');
    params.push(filter.categoryId);
  }
  const page = filter.limit ? ` LIMIT ${Math.floor(filter.limit)} OFFSET ${Math.floor(filter.offset ?? 0)}` : '';
  const rows = await database().getAllAsync<ProductRow>(
    `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE${page}`,
    params,
  );
  return rows.map(toProduct);
}

export async function productByBarcode(code: string): Promise<Product | null> {
  const row = await database().getFirstAsync<ProductRow>('SELECT * FROM products WHERE barcode = ? AND active = 1', code);
  return row ? toProduct(row) : null;
}

export async function getProduct(id: string): Promise<Product | null> {
  const row = await database().getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  return row ? toProduct(row) : null;
}

export async function adjustLocalStock(items: { productId: string; quantity: number }[]): Promise<void> {
  for (const i of items) {
    await database().runAsync('UPDATE products SET stock = stock - ? WHERE id = ?', i.quantity, i.productId);
  }
}

// ---------- clientes ----------

interface CustomerRow {
  id: string;
  name: string;
  trato: Customer['trato'];
  reputation: Customer['reputation'];
  phone: string | null;
  photo_url: string | null;
  doc_type: Customer['docType'];
  doc_number: string | null;
  credit_limit_cents: number;
  balance_cents: number;
  pending_cents: number;
  oldest_debt_at: string | null;
  last_payment_at: string | null;
  active: number;
  updated_at: string;
}

/** El saldo mostrado incluye lo registrado en el teléfono que aún no se envía. */
const toCustomer = (r: CustomerRow): Customer => ({
  id: r.id,
  name: r.name,
  trato: r.trato ?? null,
  reputation: r.reputation ?? null,
  phone: r.phone,
  photoUrl: r.photo_url,
  docType: r.doc_type,
  docNumber: r.doc_number,
  creditLimitCents: r.credit_limit_cents,
  balanceCents: r.balance_cents + r.pending_cents,
  oldestDebtAt: r.oldest_debt_at,
  lastPaymentAt: r.last_payment_at,
  active: !!r.active,
  updatedAt: r.updated_at,
});

export async function saveCustomers(customers: Customer[]): Promise<void> {
  if (customers.length === 0) return;
  const d = database();
  await d.withTransactionAsync(async () => {
    const stmt = await d.prepareAsync(
      `INSERT INTO customers (id, name, phone, photo_url, doc_type, doc_number, credit_limit_cents, balance_cents,
         oldest_debt_at, last_payment_at, active, updated_at, trato, reputation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, photo_url = excluded.photo_url,
         trato = excluded.trato, reputation = excluded.reputation,
         doc_type = excluded.doc_type, doc_number = excluded.doc_number, credit_limit_cents = excluded.credit_limit_cents,
         balance_cents = excluded.balance_cents, oldest_debt_at = excluded.oldest_debt_at,
         last_payment_at = excluded.last_payment_at, active = excluded.active, updated_at = excluded.updated_at`,
    );
    try {
      for (const c of customers) {
        await stmt.executeAsync(
          c.id, c.name, c.phone, c.photoUrl, c.docType, c.docNumber, c.creditLimitCents, c.balanceCents,
          c.oldestDebtAt, c.lastPaymentAt, c.active ? 1 : 0, c.updatedAt, c.trato, c.reputation,
        );
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
}

export async function removeCustomers(ids: string[]): Promise<void> {
  for (const id of ids) await database().runAsync('DELETE FROM customers WHERE id = ?', id);
}

export async function listCustomers(filter: { search?: string; withDebt?: boolean } = {}): Promise<Customer[]> {
  const where = ['active = 1'];
  const params: string[] = [];
  if (filter.search?.trim()) {
    where.push('(name LIKE ? OR phone LIKE ?)');
    params.push(`%${filter.search.trim()}%`, `%${filter.search.trim()}%`);
  }
  if (filter.withDebt) where.push('balance_cents + pending_cents > 0');
  const rows = await database().getAllAsync<CustomerRow>(
    `SELECT * FROM customers WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE`,
    params,
  );
  return rows.map(toCustomer);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const row = await database().getFirstAsync<CustomerRow>('SELECT * FROM customers WHERE id = ?', id);
  return row ? toCustomer(row) : null;
}

/** Cliente creado sin internet: se guarda local y se sube luego. */
export async function insertLocalCustomer(c: Customer): Promise<void> {
  await saveCustomers([c]);
}

/** Recalcula la deuda "por enviar" de cada cliente a partir del outbox. */
export async function recomputePendingBalances(): Promise<void> {
  const d = database();
  const pending = await d.getAllAsync<{ kind: string; payload: string }>(
    "SELECT kind, payload FROM outbox WHERE kind IN ('sale', 'abono') AND failed = 0",
  );
  const delta = new Map<string, number>();
  for (const row of pending) {
    const p = JSON.parse(row.payload);
    if (row.kind === 'sale' && p.customerId) {
      const fiado = (p.payments as { method: string; amountCents: number }[]).find((x) => x.method === 'FIADO');
      if (fiado) delta.set(p.customerId, (delta.get(p.customerId) ?? 0) + fiado.amountCents);
    }
    if (row.kind === 'abono') delta.set(p.customerId, (delta.get(p.customerId) ?? 0) - p.amountCents);
  }
  await d.withTransactionAsync(async () => {
    await d.runAsync('UPDATE customers SET pending_cents = 0');
    for (const [id, cents] of delta) await d.runAsync('UPDATE customers SET pending_cents = ? WHERE id = ?', cents, id);
  });
}

// ---------- ventas del teléfono ----------

export type LocalSaleStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export interface LocalSale {
  sale: Sale;
  status: LocalSaleStatus;
  error: string | null;
}

export async function saveLocalSale(sale: Sale, status: LocalSaleStatus, error: string | null = null): Promise<void> {
  await database().runAsync(
    'INSERT OR REPLACE INTO local_sales (id, seller_id, data, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    sale.id, sale.sellerId, JSON.stringify(sale), status, error, sale.createdAt,
  );
}

export async function getLocalSale(id: string): Promise<LocalSale | null> {
  const row = await database().getFirstAsync<{ data: string; status: LocalSaleStatus; error: string | null }>(
    'SELECT data, status, error FROM local_sales WHERE id = ?',
    id,
  );
  return row ? { sale: JSON.parse(row.data), status: row.status, error: row.error } : null;
}

export async function listLocalSales(sellerId: string, limit = 100): Promise<LocalSale[]> {
  const rows = await database().getAllAsync<{ data: string; status: LocalSaleStatus; error: string | null }>(
    'SELECT data, status, error FROM local_sales WHERE seller_id = ? ORDER BY created_at DESC LIMIT ?',
    sellerId,
    limit,
  );
  return rows.map((r) => ({ sale: JSON.parse(r.data), status: r.status, error: r.error }));
}

// ---------- outbox ----------

export type OutboxKind = 'customer' | 'product' | 'productImage' | 'sale' | 'abono';

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  payload: unknown;
  attempts: number;
  lastError: string | null;
  failed: boolean;
}

export async function enqueue(kind: OutboxKind, id: string, payload: unknown): Promise<void> {
  await database().runAsync(
    'INSERT OR REPLACE INTO outbox (id, kind, payload, created_at) VALUES (?, ?, ?, ?)',
    `${kind}:${id}`, kind, JSON.stringify(payload), new Date().toISOString(),
  );
}

export async function listOutbox(includeFailed = false): Promise<OutboxItem[]> {
  const rows = await database().getAllAsync<{
    id: string; kind: OutboxKind; payload: string; attempts: number; last_error: string | null; failed: number;
  }>(`SELECT * FROM outbox ${includeFailed ? '' : 'WHERE failed = 0'} ORDER BY created_at`);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    payload: JSON.parse(r.payload),
    attempts: r.attempts,
    lastError: r.last_error,
    failed: !!r.failed,
  }));
}

export async function removeOutbox(id: string): Promise<void> {
  await database().runAsync('DELETE FROM outbox WHERE id = ?', id);
}

export async function markOutboxError(id: string, error: string, permanent: boolean): Promise<void> {
  await database().runAsync(
    'UPDATE outbox SET attempts = attempts + 1, last_error = ?, failed = ? WHERE id = ?',
    error, permanent ? 1 : 0, id,
  );
}

export async function countOutbox(): Promise<{ pending: number; failed: number }> {
  const row = await database().getFirstAsync<{ pending: number; failed: number }>(
    'SELECT SUM(CASE WHEN failed = 0 THEN 1 ELSE 0 END) AS pending, SUM(failed) AS failed FROM outbox',
  );
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}
