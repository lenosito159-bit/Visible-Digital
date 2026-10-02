import pg from 'pg';
import { config } from '../config.js';

// SUM() y COUNT() devuelven bigint; nuestros montos caben de sobra en un number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));

export const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 });

export type Db = pg.Pool | pg.PoolClient;

/** Zona horaria para reportes: todo se agrupa por día y hora de Lima. */
export const TZ = 'America/Lima';

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export async function one<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const res = await db.query(sql, params);
  return (res.rows[0] as T | undefined) ?? null;
}

export async function many<T = Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows as T[];
}

export async function audit(
  db: Db,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  details?: unknown,
): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, entity, entityId, details === undefined ? null : JSON.stringify(details)],
  );
}
