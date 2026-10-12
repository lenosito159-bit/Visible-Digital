import type { LocalDb } from './db.js';

/**
 * Migraciones de la base del celular. Cada una se aplica una sola vez, en
 * orden, y la versión queda en PRAGMA user_version. Nunca se edita una
 * migración ya publicada: se agrega otra.
 */
export const LOCAL_MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'negocio y acceso',
    sql: `
      CREATE TABLE IF NOT EXISTS business (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT,
        default_credit_limit_cents INTEGER NOT NULL DEFAULT 5000,
        overdue_days INTEGER NOT NULL DEFAULT 30,
        cash_low_threshold_cents INTEGER NOT NULL DEFAULT 2000,
        stale_product_days INTEGER NOT NULL DEFAULT 30,
        credit_alert_ratio REAL NOT NULL DEFAULT 0.8,
        receipt_footer TEXT,
        recovery_hash TEXT NOT NULL,
        recovery_salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS local_users (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('ADMIN', 'VENDEDOR')),
        pin_hash TEXT NOT NULL,
        pin_salt TEXT NOT NULL,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'ventas, inventario, caja, fiados y abonos',
    // products, customers y categories ya existen en celulares que usaron la app con servidor
    // (mobile/src/lib/db.ts los crea con estas mismas columnas): por eso IF NOT EXISTS.
    sql: `
      ALTER TABLE business ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
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
        active INTEGER NOT NULL, updated_at TEXT NOT NULL, trato TEXT, reputation TEXT
      );
      CREATE TABLE stock_movements (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL REFERENCES products (id),
        kind TEXT NOT NULL CHECK (kind IN ('INICIAL', 'INGRESO', 'AJUSTE', 'VENTA', 'ANULACION')),
        quantity REAL NOT NULL,
        stock_after REAL NOT NULL,
        sale_id TEXT,
        note TEXT,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX stock_movements_product ON stock_movements (product_id, created_at);
      CREATE TABLE sales (
        id TEXT PRIMARY KEY NOT NULL,
        number INTEGER NOT NULL UNIQUE,
        seller_id TEXT NOT NULL,
        seller_name TEXT NOT NULL,
        customer_id TEXT REFERENCES customers (id),
        status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'VOIDED')),
        subtotal_cents INTEGER NOT NULL,
        discount_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        change_cents INTEGER NOT NULL,
        authorized_by TEXT,
        created_at TEXT NOT NULL,
        voided_at TEXT,
        voided_by TEXT,
        void_reason TEXT
      );
      CREATE INDEX sales_created ON sales (created_at);
      CREATE TABLE sale_items (
        sale_id TEXT NOT NULL REFERENCES sales (id),
        position INTEGER NOT NULL,
        product_id TEXT NOT NULL,
        name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        tax_affectation TEXT NOT NULL,
        PRIMARY KEY (sale_id, position)
      );
      CREATE TABLE sale_payments (
        sale_id TEXT NOT NULL REFERENCES sales (id),
        position INTEGER NOT NULL,
        method TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        tendered_cents INTEGER,
        change_cents INTEGER NOT NULL,
        confirmation TEXT CHECK (confirmation IS NULL OR confirmation = 'MANUAL'),
        reference TEXT,
        PRIMARY KEY (sale_id, position)
      );
      CREATE TABLE credit_movements (
        id TEXT PRIMARY KEY NOT NULL,
        customer_id TEXT NOT NULL REFERENCES customers (id),
        kind TEXT NOT NULL CHECK (kind IN ('FIADO', 'ABONO')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        sale_id TEXT,
        method TEXT,
        confirmation TEXT CHECK (confirmation IS NULL OR confirmation = 'MANUAL'),
        reference TEXT,
        note TEXT,
        -- Deuda del cliente justo después de este movimiento (para la constancia y el cuaderno).
        balance_after_cents INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX credit_movements_customer ON credit_movements (customer_id, created_at);
      CREATE TABLE operation_refs (
        method TEXT NOT NULL,
        reference TEXT NOT NULL,
        sale_id TEXT,
        movement_id TEXT,
        PRIMARY KEY (method, reference)
      );
      CREATE TABLE cash_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        opened_at TEXT NOT NULL,
        opened_by TEXT NOT NULL,
        opened_by_name TEXT NOT NULL,
        opening_cents INTEGER NOT NULL,
        closed_at TEXT,
        closed_by TEXT,
        expected_cents INTEGER,
        counted_cents INTEGER,
        transferred_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT
      );
      -- Solo una caja abierta a la vez.
      CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions ((closed_at IS NULL)) WHERE closed_at IS NULL;
      CREATE TABLE cash_movements (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES cash_sessions (id),
        kind TEXT NOT NULL CHECK (kind IN ('IN', 'OUT')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        reason TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];

export const LOCAL_SCHEMA_VERSION = LOCAL_MIGRATIONS[LOCAL_MIGRATIONS.length - 1]!.version;

/** Lleva la base a la última versión. Devuelve la versión con la que quedó. */
export async function migrateLocal(db: LocalDb): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  let current = row?.user_version ?? 0;
  if (current > LOCAL_SCHEMA_VERSION) {
    throw new Error(
      `Los datos son de una versión más nueva de la app (${current}). Actualiza la app antes de abrirlos.`,
    );
  }
  for (const m of LOCAL_MIGRATIONS) {
    if (m.version <= current) continue;
    await db.transaction(async () => {
      await db.exec(m.sql);
      await db.exec(`PRAGMA user_version = ${m.version}`);
    });
    current = m.version;
  }
  return current;
}
