import { can, type Permission } from '../permissions.js';
import type { Role } from '../types.js';

/**
 * Acceso a la base SQLite del celular. La app la implementa con expo-sqlite y
 * los tests con el SQLite de Node: así la misma lógica se prueba sin el teléfono.
 */
export type SqlParam = string | number | null;

export interface LocalDb {
  exec(sql: string): Promise<void>;
  run(sql: string, ...params: SqlParam[]): Promise<{ changes: number }>;
  get<T>(sql: string, ...params: SqlParam[]): Promise<T | null>;
  all<T>(sql: string, ...params: SqlParam[]): Promise<T[]>;
  /** Todo o nada: si algo falla dentro, no queda nada a medias. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

/** Lo que cambia entre el celular (expo-crypto) y Node (node:crypto). */
export interface LocalCrypto {
  sha256(text: string): Promise<string>;
  randomUUID(): string;
  /** Hexadecimal aleatorio con `bytes` bytes de entropía. */
  randomHex(bytes: number): string;
}

/** Error con un mensaje listo para mostrar al tendero. */
export class LocalError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Quién hace la operación (el usuario que entró con su PIN). */
export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export function requirePermission(actor: Actor, permission: Permission, message: string): void {
  if (!can(actor.role, permission)) throw new LocalError('SIN_PERMISO', message);
}

/** Inicio del día de hoy en Lima (UTC−5, sin horario de verano), en ISO. */
export function limaDayStart(now: Date = new Date()): string {
  const offset = 5 * 3_600_000;
  const day = 86_400_000;
  return new Date(Math.floor((now.getTime() - offset) / day) * day + offset).toISOString();
}
