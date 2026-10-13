import { getBusiness, type LocalBusiness } from './access.js';
import { refreshCustomerDebt } from './customers.js';
import { LocalError, type LocalCrypto, type LocalDb, type SqlParam } from './db.js';
import { BUSINESS_TABLES } from './demo.js';
import { LOCAL_SCHEMA_VERSION } from './schema.js';

/**
 * Copia de seguridad en un archivo: todo el negocio (y las fotos de los
 * productos) para recuperarlo en otro celular o después de reinstalar.
 *
 * - La copia la hace y la guarda el comerciante (WhatsApp a sí mismo, Drive,
 *   memoria USB…). La app no la sube a ningún lado.
 * - Lleva una huella (SHA-256) del contenido: un archivo dañado o incompleto
 *   no se restaura.
 * - Restaurar reemplaza TODO en una sola transacción: o queda la copia entera,
 *   o no cambia nada.
 * - El archivo no va cifrado: tiene los datos del negocio y de los clientes.
 */
export const BACKUP_APP = 'perupos';
export const BACKUP_FORMAT = 1;

/** Tablas en el orden en que se insertan al restaurar (primero de las que dependen otras). */
export const BACKUP_TABLES = [
  'business', 'local_users', 'categories', 'products', 'customers', 'stock_movements', 'sales', 'sale_items',
  'sale_payments', 'credit_movements', 'operation_refs', 'cash_sessions', 'cash_movements',
] as const;
type BackupTable = (typeof BACKUP_TABLES)[number];

type Row = Record<string, SqlParam>;

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: number;
  schemaVersion: number;
  createdAt: string;
  business: { name: string; isDemo: boolean };
  counts: Partial<Record<BackupTable, number>>;
  /** SHA-256 de JSON.stringify({ tables, photos }). */
  checksum: string;
  tables: Record<BackupTable, Row[]>;
  /** Fotos de productos: nombre del archivo → contenido en base64. */
  photos: Record<string, string>;
}

const contentOf = (f: Pick<BackupFile, 'tables' | 'photos'>) => JSON.stringify({ tables: f.tables, photos: f.photos });

export async function createBackup(
  db: LocalDb,
  c: LocalCrypto,
  photos: Record<string, string> = {},
  now: Date = new Date(),
): Promise<BackupFile> {
  const business = await getBusiness(db);
  if (!business) throw new LocalError('SIN_NEGOCIO', 'No hay nada que copiar todavía.');
  const tables = {} as Record<BackupTable, Row[]>;
  // Leer todo dentro de una transacción: la copia es una foto de un mismo momento.
  await db.transaction(async () => {
    for (const t of BACKUP_TABLES) tables[t] = await db.all<Row>(`SELECT * FROM ${t} ORDER BY rowid`);
  });
  const counts = Object.fromEntries(BACKUP_TABLES.map((t) => [t, tables[t].length])) as BackupFile['counts'];
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    schemaVersion: LOCAL_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    business: { name: business.name, isDemo: business.isDemo },
    counts,
    checksum: await c.sha256(contentOf({ tables, photos })),
    tables,
    photos,
  };
}

const damaged = () =>
  new LocalError('COPIA_DANADA', 'El archivo está dañado o incompleto. Prueba con otra copia (por ejemplo, una más antigua).');

/** Lee y revisa un archivo de copia. No toca la base. */
export async function readBackup(c: LocalCrypto, text: string): Promise<BackupFile> {
  let data: BackupFile;
  try {
    data = JSON.parse(text) as BackupFile;
  } catch {
    throw new LocalError('NO_ES_COPIA', 'Ese archivo no es una copia de PeruPOS (o está incompleto).');
  }
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP || typeof data.tables !== 'object' || data.tables === null) {
    throw new LocalError('NO_ES_COPIA', 'Ese archivo no es una copia de PeruPOS.');
  }
  if (data.format > BACKUP_FORMAT || data.schemaVersion > LOCAL_SCHEMA_VERSION) {
    throw new LocalError('COPIA_MAS_NUEVA', 'La copia es de una versión más nueva de la app. Actualiza la app y vuelve a intentar.');
  }
  data.photos ??= {};
  if ((await c.sha256(contentOf(data))) !== data.checksum) throw damaged();
  for (const t of BACKUP_TABLES) {
    if (!Array.isArray(data.tables[t])) throw damaged();
  }
  const owners = data.tables.local_users.filter((u) => u.role === 'ADMIN' && u.active === 1);
  if (data.tables.business.length !== 1 || owners.length === 0) throw damaged();
  return data;
}

export interface BackupSummary {
  businessName: string;
  isDemo: boolean;
  createdAt: string;
  sales: number;
  products: number;
  customers: number;
  photos: number;
}

export function backupSummary(f: BackupFile): BackupSummary {
  return {
    businessName: f.business.name,
    isDemo: f.business.isDemo,
    createdAt: f.createdAt,
    sales: f.tables.sales.length,
    products: f.tables.products.filter((p) => p.active === 1).length,
    customers: f.tables.customers.filter((cu) => cu.active === 1).length,
    photos: Object.keys(f.photos).length,
  };
}

/**
 * Reemplaza todo lo del celular por la copia (ya revisada con readBackup).
 * Una sola transacción: si algo falla, el celular queda como estaba.
 */
export async function restoreBackup(db: LocalDb, f: BackupFile, now: Date = new Date()): Promise<LocalBusiness> {
  // Columnas que existen en esta versión de la app (una copia más antigua puede tener menos).
  const columns = {} as Record<BackupTable, Set<string>>;
  for (const t of BACKUP_TABLES) {
    columns[t] = new Set((await db.all<{ name: string }>(`PRAGMA table_info(${t})`)).map((r) => r.name));
  }
  const ts = now.toISOString();
  await db.transaction(async () => {
    for (const t of BUSINESS_TABLES) await db.run(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES) {
      for (const row of f.tables[t]) {
        const cols = Object.keys(row).filter((k) => columns[t].has(k));
        await db.run(
          `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          ...cols.map((k) => row[k] ?? null),
        );
      }
    }
    // La deuda de cada cliente se vuelve a calcular desde su cuaderno.
    // (Se conserva la fecha de modificación de la copia: los datos quedan idénticos.)
    for (const cu of f.tables.customers) await refreshCustomerDebt(db, String(cu.id), String(cu.updated_at ?? ts));
    // La copia que se acaba de restaurar cuenta como la última copia.
    await db.run('UPDATE business SET last_backup_at = ?', f.createdAt);
  });
  return (await getBusiness(db))!;
}

/** Anotar que se hizo una copia (para el recordatorio). */
export async function markBackupDone(db: LocalDb, at: Date = new Date()): Promise<void> {
  await db.run('UPDATE business SET last_backup_at = ?', at.toISOString());
}

export const BACKUP_REMINDER_DAYS = 7;

/** Recordatorio para la pantalla de inicio, o null si la copia está al día. */
export async function backupReminder(db: LocalDb, now: Date = new Date()): Promise<string | null> {
  const row = await db.get<{ last_backup_at: string | null; is_demo: number }>('SELECT last_backup_at, is_demo FROM business LIMIT 1');
  if (!row || row.is_demo) return null;
  const sales = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales');
  const products = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM products');
  if (!sales?.n && !products?.n) return null;
  if (!row.last_backup_at) return 'Todavía no tienes una copia de seguridad. Si se pierde o se malogra el celular, pierdes todo.';
  const days = Math.floor((now.getTime() - new Date(row.last_backup_at).getTime()) / 86_400_000);
  if (days < BACKUP_REMINDER_DAYS) return null;
  return `Tu última copia de seguridad fue hace ${days} días. Haz una nueva y guárdala fuera del celular.`;
}
