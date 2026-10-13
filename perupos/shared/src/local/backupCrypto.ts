import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { BACKUP_APP, readBackup, type BackupFile } from './backup.js';
import { LocalError, type LocalCrypto } from './db.js';

/**
 * Copia protegida con contraseña.
 *
 * - La clave sale de la contraseña con PBKDF2-SHA256 (muchas vueltas: probar
 *   contraseñas al azar es lento) y una sal al azar.
 * - El contenido va cifrado con XChaCha20-Poly1305: sin la contraseña no se
 *   puede leer, y cualquier cambio en el archivo se detecta.
 * - A la vista solo quedan el nombre del negocio y la fecha, para saber qué
 *   copia es antes de pedir la contraseña.
 * - Si se olvida la contraseña, la copia NO se puede abrir: nadie tiene otra
 *   llave (ni el código de recuperación del PIN sirve para esto).
 */
export const BACKUP_ENCRYPTED_FORMAT = 2;
export const BACKUP_KDF_ITERATIONS = 150_000;
export const BACKUP_PASSWORD_MIN = 8;

export interface EncryptedBackupFile {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_ENCRYPTED_FORMAT;
  encrypted: true;
  createdAt: string;
  business: { name: string; isDemo: boolean };
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: { name: 'XChaCha20-Poly1305'; nonce: string };
  /** Copia (BackupFile en JSON) cifrada, en base64. */
  data: string;
}

export function validateBackupPassword(password: string): void {
  if (password.length < BACKUP_PASSWORD_MIN) {
    throw new LocalError(
      'CONTRASENA_CORTA',
      `La contraseña debe tener al menos ${BACKUP_PASSWORD_MIN} letras o números. Usa una frase fácil de recordar, por ejemplo "bodega rosita 2026".`,
    );
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  // asyncTick: el celular sigue respondiendo mientras calcula.
  return pbkdf2Async(sha256, utf8Encode(password.normalize('NFC')), salt, { c: iterations, dkLen: 32, asyncTick: 20 });
}

export async function encryptBackup(backup: BackupFile, password: string, c: LocalCrypto): Promise<EncryptedBackupFile> {
  validateBackupPassword(password);
  const salt = hexToBytes(c.randomHex(16));
  const nonce = hexToBytes(c.randomHex(24));
  const key = await deriveKey(password, salt, BACKUP_KDF_ITERATIONS);
  const data = xchacha20poly1305(key, nonce).encrypt(utf8Encode(JSON.stringify(backup)));
  return {
    app: BACKUP_APP,
    format: BACKUP_ENCRYPTED_FORMAT,
    encrypted: true,
    createdAt: backup.createdAt,
    business: backup.business,
    kdf: { name: 'PBKDF2-SHA256', iterations: BACKUP_KDF_ITERATIONS, salt: base64Encode(salt) },
    cipher: { name: 'XChaCha20-Poly1305', nonce: base64Encode(nonce) },
    data: base64Encode(data),
  };
}

export interface BackupPeek {
  encrypted: boolean;
  businessName: string;
  isDemo: boolean;
  createdAt: string;
}

/** Lo que se puede ver de una copia sin la contraseña (para mostrar cuál es). */
export function peekBackup(text: string): BackupPeek {
  let data: Partial<EncryptedBackupFile & BackupFile>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LocalError('NO_ES_COPIA', 'Ese archivo no es una copia de PeruPOS (o está incompleto).');
  }
  if (!data || data.app !== BACKUP_APP || !data.business || typeof data.createdAt !== 'string') {
    throw new LocalError('NO_ES_COPIA', 'Ese archivo no es una copia de PeruPOS.');
  }
  return { encrypted: data.encrypted === true, businessName: data.business.name, isDemo: !!data.business.isDemo, createdAt: data.createdAt };
}

/**
 * Abre una copia: si está protegida, la descifra con la contraseña; luego la
 * revisa entera (huella, versión). No toca la base.
 */
export async function openBackup(c: LocalCrypto, text: string, password?: string): Promise<BackupFile> {
  const peek = peekBackup(text);
  if (!peek.encrypted) return readBackup(c, text);
  const f = JSON.parse(text) as EncryptedBackupFile;
  if (f.format > BACKUP_ENCRYPTED_FORMAT || f.kdf?.name !== 'PBKDF2-SHA256' || f.cipher?.name !== 'XChaCha20-Poly1305') {
    throw new LocalError('COPIA_MAS_NUEVA', 'La copia es de una versión más nueva de la app. Actualiza la app y vuelve a intentar.');
  }
  if (!password) throw new LocalError('NECESITA_CONTRASENA', 'Esta copia tiene contraseña. Escríbela para abrirla.');
  let plain: Uint8Array;
  try {
    const key = await deriveKey(password, base64Decode(f.kdf.salt), f.kdf.iterations);
    plain = xchacha20poly1305(key, base64Decode(f.cipher.nonce)).decrypt(base64Decode(f.data));
  } catch {
    throw new LocalError(
      'CONTRASENA_INCORRECTA',
      'La contraseña no es la de esta copia (o el archivo está dañado). Revisa mayúsculas, espacios y tildes.',
    );
  }
  return readBackup(c, utf8Decode(plain));
}

// ---------- utilidades sin dependencias del celular (Hermes no siempre trae TextDecoder) ----------

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let cp: number;
    if (b < 0x80) (cp = b), (i += 1);
    else if (b < 0xe0) (cp = ((b & 31) << 6) | (bytes[i + 1]! & 63)), (i += 2);
    else if (b < 0xf0) (cp = ((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63)), (i += 3);
    else (cp = ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63)), (i += 4);
    chunk.push(cp);
    if (chunk.length >= 8192) {
      parts.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCodePoint(...chunk));
  return parts.join('');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    parts.push(
      B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < bytes.length ? B64[n & 63]! : '='),
    );
  }
  return parts.join('');
}

export function base64Decode(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((clean[i + 2] ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (clean[i + 3] ? B64.indexOf(clean[i + 3]!) : 0);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2]) out[o++] = (n >> 8) & 255;
    if (clean[i + 3]) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
