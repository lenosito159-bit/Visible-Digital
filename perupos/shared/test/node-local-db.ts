import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { LocalCrypto, LocalDb, SqlParam } from '../src/local/index.js';

/**
 * Base local para tests: el SQLite que trae Node, el mismo motor que usa
 * expo-sqlite en el celular. `file` permite reabrir la misma base (":memory:" por defecto).
 */
export function nodeLocalDb(file = ':memory:'): LocalDb & { close(): void } {
  const db = new DatabaseSync(file);
  let depth = 0;
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, ...params: SqlParam[]) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async get<T>(sql: string, ...params: SqlParam[]) {
      return ((db.prepare(sql).get(...params) as T | undefined) ?? null) as T | null;
    },
    async all<T>(sql: string, ...params: SqlParam[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async transaction(fn) {
      // Transacciones anidadas: solo la de afuera hace BEGIN/COMMIT.
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN');
      try {
        const out = await fn();
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => db.close(),
  };
}

export const nodeCrypto: LocalCrypto = {
  sha256: async (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
  randomUUID: () => randomUUID(),
  randomHex: (bytes) => randomBytes(bytes).toString('hex'),
};
