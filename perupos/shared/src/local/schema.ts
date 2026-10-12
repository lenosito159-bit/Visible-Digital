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
