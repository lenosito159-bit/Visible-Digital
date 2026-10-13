import * as Crypto from 'expo-crypto';
import type { LocalCrypto, LocalDb, SqlParam } from '@perupos/shared';
import { database } from './db';

/**
 * La lógica local de @perupos/shared sobre el SQLite del celular. Usa la
 * misma base (perupos.db) que abre initDb().
 */
// Las transacciones van en fila: expo-sqlite usa una sola conexión y dos
// transacciones a la vez se mezclarían. La lógica de @perupos/shared nunca
// abre una transacción dentro de otra (los tests lo verifican).
let queue: Promise<unknown> = Promise.resolve();

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
  transaction<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      let out!: T;
      // Si fn falla, expo-sqlite hace ROLLBACK y no queda nada a medias.
      await database().withTransactionAsync(async () => {
        out = await fn();
      });
      return out;
    });
    queue = run.catch(() => undefined);
    return run;
  },
};

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const localCrypto: LocalCrypto = {
  sha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
  randomUUID: () => Crypto.randomUUID(),
  randomHex: (bytes) => toHex(Crypto.getRandomBytes(bytes)),
};
