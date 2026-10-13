import type { Cents, Product, TaxAffectation, Unit } from '../types.js';
import { LocalError, requirePermission, type Actor, type LocalCrypto, type LocalDb } from './db.js';

/**
 * Productos e inventario en el celular. El negocio empieza con el catálogo
 * vacío; cada producto se crea con su precio y su stock inicial.
 */
export interface ProductRow {
  id: string;
  barcode: string | null;
  name: string;
  category_id: string | null;
  price_cents: number;
  cost_cents: number | null;
  stock: number;
  min_stock: number;
  unit: Unit;
  tax_affectation: TaxAffectation;
  image_url: string | null;
  active: number;
  updated_at: string;
}

export const toProduct = (r: ProductRow): Product => ({
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

export interface ProductInput {
  /** Opcional: si se repite el mismo id (doble toque), no se crea dos veces. */
  id?: string;
  name: string;
  priceCents: Cents;
  stock?: number;
  minStock?: number;
  unit?: Unit;
  barcode?: string | null;
  costCents?: Cents | null;
  categoryId?: string | null;
  imageUrl?: string | null;
}

export type StockMovementKind = 'INICIAL' | 'INGRESO' | 'AJUSTE' | 'VENTA' | 'ANULACION';

export interface StockMovement {
  id: string;
  productId: string;
  kind: StockMovementKind;
  quantity: number;
  stockAfter: number;
  saleId: string | null;
  note: string | null;
  createdAt: string;
}

/** Kilos con hasta 3 decimales (gramos); unidades enteras. */
export function roundQuantity(quantity: number, unit: Unit): number {
  return unit === 'KG' ? Math.round(quantity * 1000) / 1000 : quantity;
}

function checkQuantity(value: number, unit: Unit, what: string, allowZero = true): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new LocalError('CANTIDAD_INVALIDA', `${what} no es válido.`);
  }
  if (unit === 'UND' && !Number.isInteger(value)) {
    throw new LocalError('CANTIDAD_INVALIDA', `${what}: este producto se cuenta por unidades, sin decimales.`);
  }
  return roundQuantity(value, unit);
}

function cleanProductName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length < 2) throw new LocalError('NOMBRE_INVALIDO', 'Escribe el nombre del producto.');
  if (clean.length > 80) throw new LocalError('NOMBRE_INVALIDO', 'El nombre es muy largo (máximo 80 letras).');
  return clean;
}

function checkPrice(priceCents: number): number {
  if (!Number.isInteger(priceCents) || priceCents <= 0) {
    throw new LocalError('PRECIO_INVALIDO', 'Pon el precio de venta (mayor a S/ 0.00).');
  }
  return priceCents;
}

async function checkBarcode(db: LocalDb, barcode: string | null | undefined, exceptId?: string): Promise<string | null> {
  const code = barcode?.trim() || null;
  if (!code) return null;
  const other = await db.get<{ id: string; name: string }>(
    'SELECT id, name FROM products WHERE barcode = ? AND active = 1 AND id != ?',
    code,
    exceptId ?? '',
  );
  if (other) throw new LocalError('CODIGO_REPETIDO', `Ese código de barras ya es de "${other.name}".`);
  return code;
}

export async function getProduct(db: LocalDb, id: string): Promise<Product | null> {
  const row = await db.get<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  return row ? toProduct(row) : null;
}

export async function listProducts(
  db: LocalDb,
  filter: { search?: string; includeInactive?: boolean } = {},
): Promise<Product[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (!filter.includeInactive) where.push('active = 1');
  if (filter.search?.trim()) {
    where.push('(name LIKE ? OR barcode = ?)');
    params.push(`%${filter.search.trim()}%`, filter.search.trim());
  }
  const rows = await db.all<ProductRow>(
    `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name COLLATE NOCASE`,
    ...params,
  );
  return rows.map(toProduct);
}

async function insertStockMovement(
  db: LocalDb,
  c: LocalCrypto,
  m: { productId: string; kind: StockMovementKind; quantity: number; stockAfter: number; saleId?: string | null; note?: string | null },
  actor: Actor,
  ts: string,
): Promise<void> {
  await db.run(
    `INSERT INTO stock_movements (id, product_id, kind, quantity, stock_after, sale_id, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    c.randomUUID(), m.productId, m.kind, m.quantity, m.stockAfter, m.saleId ?? null, m.note ?? null, actor.id, ts,
  );
}

/** Cambia el stock dentro de una transacción que ya está abierta y deja el registro. */
export async function moveStock(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  productId: string,
  delta: number,
  kind: StockMovementKind,
  ts: string,
  extra: { saleId?: string | null; note?: string | null } = {},
): Promise<number> {
  const row = await db.get<{ stock: number; unit: Unit }>('SELECT stock, unit FROM products WHERE id = ?', productId);
  if (!row) throw new LocalError('PRODUCTO_NO_EXISTE', 'Ese producto ya no existe.');
  const after = roundQuantity(row.stock + delta, row.unit);
  await db.run('UPDATE products SET stock = ?, updated_at = ? WHERE id = ?', after, ts, productId);
  await insertStockMovement(db, c, { productId, kind, quantity: delta, stockAfter: after, ...extra }, actor, ts);
  return after;
}

/** Crea un producto con su precio y su stock inicial. */
export async function createProduct(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  input: ProductInput,
  now: Date = new Date(),
): Promise<Product> {
  requirePermission(actor, 'products.quickCreate', 'No puedes crear productos.');
  if (input.id) {
    const existing = await getProduct(db, input.id);
    if (existing) return existing;
  }
  const id = input.id ?? c.randomUUID();
  await db.transaction(() => insertProduct(db, c, actor, { ...input, id }, now.toISOString()));
  return (await getProduct(db, id))!;
}

/** Valida y guarda un producto nuevo. Debe llamarse dentro de una transacción. */
export async function insertProduct(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  input: ProductInput & { id: string },
  ts: string,
): Promise<void> {
  const unit: Unit = input.unit ?? 'UND';
  const name = cleanProductName(input.name);
  const price = checkPrice(input.priceCents);
  const stock = checkQuantity(input.stock ?? 0, unit, 'El stock');
  const minStock = checkQuantity(input.minStock ?? 0, unit, 'El stock mínimo');
  if (input.costCents != null && (!Number.isInteger(input.costCents) || input.costCents < 0)) {
    throw new LocalError('PRECIO_INVALIDO', 'El costo no es válido.');
  }
  const barcode = await checkBarcode(db, input.barcode);
  await db.run(
    `INSERT INTO products (id, barcode, name, category_id, price_cents, cost_cents, stock, min_stock, unit,
       tax_affectation, image_url, active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'GRAVADO', ?, 1, ?)`,
    input.id, barcode, name, input.categoryId ?? null, price, input.costCents ?? null, stock, minStock, unit,
    input.imageUrl ?? null, ts,
  );
  if (stock !== 0) {
    await insertStockMovement(db, c, { productId: input.id, kind: 'INICIAL', quantity: stock, stockAfter: stock }, actor, ts);
  }
}

export interface ProductPatch {
  name?: string;
  priceCents?: Cents;
  minStock?: number;
  barcode?: string | null;
  costCents?: Cents | null;
  categoryId?: string | null;
  imageUrl?: string | null;
  active?: boolean;
}

/** Editar datos del producto (no el stock: para eso está adjustStock). Solo el dueño. */
export async function updateProduct(
  db: LocalDb,
  actor: Actor,
  id: string,
  patch: ProductPatch,
  now: Date = new Date(),
): Promise<Product> {
  requirePermission(actor, 'products.edit', 'Solo el dueño puede cambiar precios y datos de productos.');
  const current = await getProduct(db, id);
  if (!current) throw new LocalError('PRODUCTO_NO_EXISTE', 'Ese producto ya no existe.');
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (patch.name !== undefined) set('name', cleanProductName(patch.name));
  if (patch.priceCents !== undefined) set('price_cents', checkPrice(patch.priceCents));
  if (patch.minStock !== undefined) set('min_stock', checkQuantity(patch.minStock, current.unit, 'El stock mínimo'));
  if (patch.barcode !== undefined) set('barcode', await checkBarcode(db, patch.barcode, id));
  if (patch.costCents !== undefined) set('cost_cents', patch.costCents);
  if (patch.categoryId !== undefined) set('category_id', patch.categoryId);
  if (patch.imageUrl !== undefined) set('image_url', patch.imageUrl);
  if (patch.active !== undefined) set('active', patch.active ? 1 : 0);
  if (sets.length) {
    set('updated_at', now.toISOString());
    await db.run(`UPDATE products SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  }
  return (await getProduct(db, id))!;
}

/**
 * Inventario: "INGRESO" suma lo que llegó del proveedor; "AJUSTE" pone el
 * stock que se contó en el anaquel. Solo el dueño.
 */
export async function adjustStock(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  productId: string,
  change: { kind: 'INGRESO'; quantity: number } | { kind: 'AJUSTE'; countedStock: number },
  note: string | null = null,
  now: Date = new Date(),
): Promise<Product> {
  requirePermission(actor, 'inventory.edit', 'Solo el dueño puede cambiar el stock.');
  const product = await getProduct(db, productId);
  if (!product) throw new LocalError('PRODUCTO_NO_EXISTE', 'Ese producto ya no existe.');
  const ts = now.toISOString();
  await db.transaction(async () => {
    if (change.kind === 'INGRESO') {
      const qty = checkQuantity(change.quantity, product.unit, 'Lo que llegó', false);
      await moveStock(db, c, actor, productId, qty, 'INGRESO', ts, { note });
    } else {
      const counted = checkQuantity(change.countedStock, product.unit, 'El stock contado');
      const current = (await db.get<{ stock: number }>('SELECT stock FROM products WHERE id = ?', productId))!.stock;
      const delta = roundQuantity(counted - current, product.unit);
      if (delta !== 0) await moveStock(db, c, actor, productId, delta, 'AJUSTE', ts, { note });
    }
  });
  return (await getProduct(db, productId))!;
}

export async function stockHistory(db: LocalDb, productId: string, limit = 50): Promise<StockMovement[]> {
  const rows = await db.all<{
    id: string; product_id: string; kind: StockMovementKind; quantity: number; stock_after: number;
    sale_id: string | null; note: string | null; created_at: string;
  }>('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?', productId, limit);
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    kind: r.kind,
    quantity: r.quantity,
    stockAfter: r.stock_after,
    saleId: r.sale_id,
    note: r.note,
    createdAt: r.created_at,
  }));
}
