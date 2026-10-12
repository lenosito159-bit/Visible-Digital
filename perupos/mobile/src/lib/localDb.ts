import * as Crypto from 'expo-crypto';
import type { LocalCrypto, LocalDb, SqlParam } from '@perupos/shared';
import { database } from './db';

/**
 * La lógica local de @perupos/shared sobre el SQLite del celular. Usa la
 * misma base (perupos.db) que abre initDb().
 */
let depth = 0;

export const localDb: LocalDb = {
  async exec(sql) {
    await database().execAsync(sql);
  },
  async run(sql, ...params: SqlParam[]) {
    const r = await database().runAsync(sql, params);
    return { changes: r.changes };
  },
  get: <T>(sql: string, ...params: SqlParam[]) => database().getFirstAsync<T>(sql, params),
  all: <T>(sql: string, ...params: SqlParam[]) => database().getAllAsync<T>(sql, params),
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Una transacción dentro de otra se une a la de afuera.
    if (depth > 0) return fn();
    depth++;
    try {
      let out!: T;
      await database().withTransactionAsync(async () => {
        out = await fn();
      });
      return out;
    } finally {
      depth--;
    }
  },
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const localCrypto: LocalCrypto = {
  sha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
  randomUUID: () => Crypto.randomUUID(),
  randomHex: (bytes) => toHex(Crypto.getRandomBytes(bytes)),
};
