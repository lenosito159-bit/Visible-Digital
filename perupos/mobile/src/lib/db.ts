import * as SQLite from 'expo-sqlite';
import type { Category, Customer, Product } from '@perupos/shared';

/**
 * Base de datos del celular (SQLite, archivo perupos.db). Las tablas y su
 * lógica viven en @perupos/shared (src/local); aquí solo se abre la base y
 * están las consultas rápidas que usan las listas (catálogo, clientes).
 */
let db: SQLite.SQLiteDatabase | null = null;

export function database(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('La base local no está lista');
  return db;
}

export async function initDb(): Promise<void> {
  db = await SQLite.openDatabaseAsync('perupos.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');
}

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

export async function listCategories(): Promise<Category[]> {
  const rows = await database().getAllAsync<{ id: string; name: string; icon: string; sort_order: number }>(
    'SELECT * FROM categories ORDER BY sort_order, name',
  );
  return rows.map((r) => ({ id: r.id, name: r.name, icon: r.icon, sortOrder: r.sort_order }));
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
  oldest_debt_at: string | null;
  last_payment_at: string | null;
  active: number;
  updated_at: string;
}

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
  balanceCents: r.balance_cents,
  oldestDebtAt: r.oldest_debt_at,
  lastPaymentAt: r.last_payment_at,
  active: !!r.active,
  updatedAt: r.updated_at,
});

export async function listCustomers(filter: { search?: string; withDebt?: boolean } = {}): Promise<Customer[]> {
  const where = ['active = 1'];
  const params: string[] = [];
  if (filter.search?.trim()) {
    where.push('(name LIKE ? OR phone LIKE ?)');
    params.push(`%${filter.search.trim()}%`, `%${filter.search.trim()}%`);
  }
  if (filter.withDebt) where.push('balance_cents > 0');
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
