import { DEFAULT_IGV_RATE } from '../money.js';
import type { BusinessSettings, Role, User } from '../types.js';
import { normalizePeruMobile } from '../validators.js';
import { LocalError, type LocalCrypto, type LocalDb } from './db.js';

/**
 * Negocio y acceso en el celular, sin servidor y sin RUC: solo el nombre del
 * negocio, el nombre del dueño y un PIN. El celular de contacto es opcional.
 */
export interface LocalBusiness {
  id: string;
  name: string;
  ownerName: string;
  phone: string | null;
  defaultCreditLimitCents: number;
  overdueDays: number;
  cashLowThresholdCents: number;
  staleProductDays: number;
  creditAlertRatio: number;
  receiptFooter: string | null;
  /** Negocio de demostración (datos de ejemplo). Se puede borrar entero. */
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** En un solo celular: el dueño (ADMIN) y, si quiere, ayudantes (VENDEDOR). */
export type LocalRole = Extract<Role, 'ADMIN' | 'VENDEDOR'>;

export interface LocalUser {
  id: string;
  name: string;
  role: LocalRole;
  active: boolean;
}

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MINUTES = 5;

export type UnlockResult =
  | { ok: true; user: LocalUser }
  | { ok: false; code: 'PIN_INCORRECTO'; message: string; remainingAttempts: number }
  | { ok: false; code: 'BLOQUEADO'; message: string; lockedUntil: string };

interface BusinessRow {
  id: string;
  name: string;
  owner_name: string;
  phone: string | null;
  default_credit_limit_cents: number;
  overdue_days: number;
  cash_low_threshold_cents: number;
  stale_product_days: number;
  credit_alert_ratio: number;
  receipt_footer: string | null;
  recovery_hash: string;
  recovery_salt: string;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  name: string;
  role: LocalRole;
  pin_hash: string;
  pin_salt: string;
  failed_attempts: number;
  locked_until: string | null;
  active: number;
}

const toBusiness = (r: BusinessRow): LocalBusiness => ({
  id: r.id,
  name: r.name,
  ownerName: r.owner_name,
  phone: r.phone,
  defaultCreditLimitCents: r.default_credit_limit_cents,
  overdueDays: r.overdue_days,
  cashLowThresholdCents: r.cash_low_threshold_cents,
  staleProductDays: r.stale_product_days,
  creditAlertRatio: r.credit_alert_ratio,
  receiptFooter: r.receipt_footer,
  isDemo: !!r.is_demo,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toUser = (r: UserRow): LocalUser => ({ id: r.id, name: r.name, role: r.role, active: !!r.active });

// ---------- validaciones ----------

export function validatePin(pin: string): void {
  if (!/^\d{4,6}$/.test(pin)) throw new LocalError('PIN_INVALIDO', 'El PIN debe tener de 4 a 6 números.');
}

function cleanName(value: string, what: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new LocalError('NOMBRE_INVALIDO', `Escribe ${what} (al menos 2 letras).`);
  if (name.length > 60) throw new LocalError('NOMBRE_INVALIDO', `${what[0]!.toUpperCase()}${what.slice(1)} es muy largo (máximo 60 letras).`);
  return name;
}

function cleanPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const normalized = normalizePeruMobile(phone);
  if (!normalized) throw new LocalError('CELULAR_INVALIDO', 'El celular debe tener 9 números y empezar con 9.');
  return normalized.slice(2);
}

// ---------- secretos ----------

const hashSecret = (c: LocalCrypto, salt: string, secret: string) => c.sha256(`perupos:${salt}:${secret}`);

/** Código de recuperación de 10 números, para escribirlo en un papel. */
function newRecoveryCode(c: LocalCrypto): string {
  const n = BigInt(`0x${c.randomHex(8)}`) % 10_000_000_000n;
  return n.toString().padStart(10, '0');
}

/** "12345-67890" para mostrarlo; al escribirlo se aceptan espacios y guiones. */
export const formatRecoveryCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`;
const normalizeRecoveryCode = (code: string) => code.replace(/\D/g, '');

// ---------- negocio ----------

export async function getBusiness(db: LocalDb): Promise<LocalBusiness | null> {
  const row = await db.get<BusinessRow>('SELECT * FROM business LIMIT 1');
  return row ? toBusiness(row) : null;
}

export interface SetupInput {
  businessName: string;
  ownerName: string;
  pin: string;
  phone?: string | null;
}

/**
 * Primera vez que se abre la app. Crea el negocio y al dueño. Devuelve el
 * código de recuperación: se muestra UNA vez y sirve para cambiar el PIN si
 * el dueño lo olvida.
 */
export async function setupBusiness(
  db: LocalDb,
  c: LocalCrypto,
  input: SetupInput,
  now: Date = new Date(),
): Promise<{ business: LocalBusiness; owner: LocalUser; recoveryCode: string }> {
  const prepared = await prepareSetup(c, input, now);
  await db.transaction(() => insertSetup(db, prepared));
  return {
    business: (await getBusiness(db))!,
    owner: { id: prepared.ownerId, name: prepared.ownerName, role: 'ADMIN', active: true },
    recoveryCode: prepared.recoveryCode,
  };
}

/** Valida y calcula todo lo que se guarda (fuera de la transacción: el hash es lento). */
export async function prepareSetup(c: LocalCrypto, input: SetupInput, now: Date) {
  const businessName = cleanName(input.businessName, 'el nombre del negocio');
  const ownerName = cleanName(input.ownerName, 'tu nombre');
  validatePin(input.pin);
  const phone = cleanPhone(input.phone);
  const recoveryCode = newRecoveryCode(c);
  const recoverySalt = c.randomHex(16);
  const pinSalt = c.randomHex(16);
  const [recoveryHash, pinHash] = await Promise.all([
    hashSecret(c, recoverySalt, recoveryCode),
    hashSecret(c, pinSalt, input.pin),
  ]);
  return {
    businessId: c.randomUUID(),
    ownerId: c.randomUUID(),
    businessName,
    ownerName,
    phone,
    recoveryCode,
    recoveryHash,
    recoverySalt,
    pinHash,
    pinSalt,
    ts: now.toISOString(),
  };
}

/** Guarda el negocio y al dueño. Debe llamarse dentro de una transacción. */
export async function insertSetup(db: LocalDb, s: Awaited<ReturnType<typeof prepareSetup>>): Promise<void> {
  if (await db.get('SELECT id FROM business LIMIT 1')) {
    throw new LocalError('YA_CONFIGURADO', 'Este celular ya tiene un negocio configurado.');
  }
  await db.run(
    `INSERT INTO business (id, name, owner_name, phone, recovery_hash, recovery_salt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    s.businessId, s.businessName, s.ownerName, s.phone, s.recoveryHash, s.recoverySalt, s.ts, s.ts,
  );
  await db.run(
    `INSERT INTO local_users (id, name, role, pin_hash, pin_salt, created_at, updated_at)
     VALUES (?, ?, 'ADMIN', ?, ?, ?, ?)`,
    s.ownerId, s.ownerName, s.pinHash, s.pinSalt, s.ts, s.ts,
  );
}

export interface BusinessPatch {
  name?: string;
  ownerName?: string;
  phone?: string | null;
  receiptFooter?: string | null;
  defaultCreditLimitCents?: number;
  overdueDays?: number;
  cashLowThresholdCents?: number;
}

export async function updateBusiness(db: LocalDb, patch: BusinessPatch, now: Date = new Date()): Promise<LocalBusiness> {
  const current = await getBusiness(db);
  if (!current) throw new LocalError('SIN_NEGOCIO', 'Primero configura tu negocio.');
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (col: string, value: string | number | null) => {
    sets.push(`${col} = ?`);
    params.push(value);
  };
  if (patch.name !== undefined) set('name', cleanName(patch.name, 'el nombre del negocio'));
  if (patch.ownerName !== undefined) set('owner_name', cleanName(patch.ownerName, 'tu nombre'));
  if (patch.phone !== undefined) set('phone', cleanPhone(patch.phone));
  if (patch.receiptFooter !== undefined) set('receipt_footer', patch.receiptFooter?.trim() || null);
  const nonNegativeInt = (v: number, what: string) => {
    if (!Number.isInteger(v) || v < 0) throw new LocalError('VALOR_INVALIDO', `${what} no es válido.`);
    return v;
  };
  if (patch.defaultCreditLimitCents !== undefined) {
    set('default_credit_limit_cents', nonNegativeInt(patch.defaultCreditLimitCents, 'El límite de fiado'));
  }
  if (patch.overdueDays !== undefined) set('overdue_days', nonNegativeInt(patch.overdueDays, 'Los días para vencer'));
  if (patch.cashLowThresholdCents !== undefined) {
    set('cash_low_threshold_cents', nonNegativeInt(patch.cashLowThresholdCents, 'El mínimo de caja'));
  }
  if (sets.length > 0) {
    set('updated_at', now.toISOString());
    await db.run(`UPDATE business SET ${sets.join(', ')} WHERE id = ?`, ...params, current.id);
  }
  return (await getBusiness(db))!;
}

/**
 * Configuración en el formato que ya usan las pantallas. Sin RUC ni régimen:
 * los campos tributarios quedan vacíos y el IGV no se desglosa (NRUS es el
 * único régimen que no lo desglosa). No se emiten comprobantes de SUNAT.
 */
export function businessSettings(b: LocalBusiness): BusinessSettings {
  return {
    ruc: '',
    razonSocial: '',
    nombreComercial: b.name,
    direccion: '',
    ubigeo: null,
    phone: b.phone,
    taxRegime: 'NRUS',
    currency: 'PEN',
    igvRate: DEFAULT_IGV_RATE,
    cashLowThresholdCents: b.cashLowThresholdCents,
    defaultCreditLimitCents: b.defaultCreditLimitCents,
    overdueDays: b.overdueDays,
    staleProductDays: b.staleProductDays,
    creditAlertRatio: b.creditAlertRatio,
    yapePlinEnabled: true,
    receiptFooter: b.receiptFooter,
  };
}

// ---------- usuarios y PIN ----------

export async function listLocalUsers(db: LocalDb): Promise<LocalUser[]> {
  const rows = await db.all<UserRow>(
    `SELECT * FROM local_users WHERE active = 1 ORDER BY CASE role WHEN 'ADMIN' THEN 0 ELSE 1 END, name`,
  );
  return rows.map(toUser);
}

/** Usuario en el formato que ya usan las pantallas. */
export function toAppUser(u: LocalUser, createdAt: string): User {
  return { id: u.id, name: u.name, username: u.name, role: u.role, active: u.active, createdAt };
}

export async function unlock(
  db: LocalDb,
  c: LocalCrypto,
  userId: string,
  pin: string,
  now: Date = new Date(),
): Promise<UnlockResult> {
  const row = await db.get<UserRow>('SELECT * FROM local_users WHERE id = ? AND active = 1', userId);
  if (!row) throw new LocalError('USUARIO_NO_EXISTE', 'Ese usuario ya no existe en este celular.');
  if (row.locked_until && new Date(row.locked_until) > now) {
    return { ok: false, code: 'BLOQUEADO', message: lockedMessage(row.locked_until, now), lockedUntil: row.locked_until };
  }
  if ((await hashSecret(c, row.pin_salt, pin)) === row.pin_hash) {
    await db.run('UPDATE local_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', row.id);
    return { ok: true, user: toUser(row) };
  }
  const failed = row.failed_attempts + 1;
  if (failed >= MAX_PIN_ATTEMPTS) {
    const until = new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000).toISOString();
    await db.run('UPDATE local_users SET failed_attempts = 0, locked_until = ? WHERE id = ?', until, row.id);
    return { ok: false, code: 'BLOQUEADO', message: lockedMessage(until, now), lockedUntil: until };
  }
  await db.run('UPDATE local_users SET failed_attempts = ? WHERE id = ?', failed, row.id);
  const remaining = MAX_PIN_ATTEMPTS - failed;
  return {
    ok: false,
    code: 'PIN_INCORRECTO',
    message: `PIN incorrecto. Te ${remaining === 1 ? 'queda 1 intento' : `quedan ${remaining} intentos`}.`,
    remainingAttempts: remaining,
  };
}

function lockedMessage(untilIso: string, now: Date): string {
  const minutes = Math.max(1, Math.ceil((new Date(untilIso).getTime() - now.getTime()) / 60_000));
  return `Muchos intentos con PIN equivocado. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`;
}

async function setPin(db: LocalDb, c: LocalCrypto, userId: string, pin: string, now: Date): Promise<void> {
  validatePin(pin);
  const salt = c.randomHex(16);
  const hash = await hashSecret(c, salt, pin);
  await db.run(
    'UPDATE local_users SET pin_hash = ?, pin_salt = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
    hash, salt, now.toISOString(), userId,
  );
}

export async function changePin(
  db: LocalDb,
  c: LocalCrypto,
  userId: string,
  currentPin: string,
  newPin: string,
  now: Date = new Date(),
): Promise<void> {
  validatePin(newPin);
  const check = await unlock(db, c, userId, currentPin, now);
  if (!check.ok) throw new LocalError(check.code, check.message);
  await setPin(db, c, userId, newPin, now);
}

/** El dueño olvidó su PIN: con el código de recuperación pone uno nuevo. */
export async function resetOwnerPin(
  db: LocalDb,
  c: LocalCrypto,
  recoveryCode: string,
  newPin: string,
  now: Date = new Date(),
): Promise<LocalUser> {
  validatePin(newPin);
  const b = await db.get<BusinessRow>('SELECT * FROM business LIMIT 1');
  if (!b) throw new LocalError('SIN_NEGOCIO', 'Primero configura tu negocio.');
  if ((await hashSecret(c, b.recovery_salt, normalizeRecoveryCode(recoveryCode))) !== b.recovery_hash) {
    throw new LocalError('CODIGO_INCORRECTO', 'Ese código de recuperación no es el de este negocio.');
  }
  const owner = await db.get<UserRow>(
    "SELECT * FROM local_users WHERE role = 'ADMIN' AND active = 1 ORDER BY created_at LIMIT 1",
  );
  if (!owner) throw new LocalError('SIN_DUENO', 'No se encontró al dueño del negocio.');
  await setPin(db, c, owner.id, newPin, now);
  return toUser(owner);
}

/** Un ayudante con su propio PIN y menos permisos (vende, no cambia precios ni ve reportes). */
export async function addHelper(
  db: LocalDb,
  c: LocalCrypto,
  input: { name: string; pin: string },
  now: Date = new Date(),
): Promise<LocalUser> {
  const name = cleanName(input.name, 'el nombre del ayudante');
  validatePin(input.pin);
  const salt = c.randomHex(16);
  const hash = await hashSecret(c, salt, input.pin);
  const id = c.randomUUID();
  const ts = now.toISOString();
  await db.run(
    `INSERT INTO local_users (id, name, role, pin_hash, pin_salt, created_at, updated_at)
     VALUES (?, ?, 'VENDEDOR', ?, ?, ?, ?)`,
    id, name, hash, salt, ts, ts,
  );
  return { id, name, role: 'VENDEDOR', active: true };
}

export async function removeHelper(db: LocalDb, userId: string, now: Date = new Date()): Promise<void> {
  const row = await db.get<UserRow>('SELECT * FROM local_users WHERE id = ?', userId);
  if (!row) return;
  if (row.role === 'ADMIN') throw new LocalError('NO_PERMITIDO', 'Al dueño no se le puede quitar el acceso.');
  await db.run('UPDATE local_users SET active = 0, updated_at = ? WHERE id = ?', now.toISOString(), userId);
}
