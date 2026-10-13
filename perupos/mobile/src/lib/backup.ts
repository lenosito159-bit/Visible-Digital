import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  BACKUP_PASSWORD_MIN,
  backupReminder,
  backupSummary,
  createBackup,
  encryptBackup,
  getBusiness,
  markBackupDone,
  markBackupVerified,
  openBackup,
  peekBackup,
  restoreBackup,
  type BackupFile,
  type BackupPeek,
  type BackupSummary,
} from '@perupos/shared';
import { localCrypto as c, localDb as db } from './localDb';
import { emitDataChanged } from './sync';

/**
 * Copia de seguridad en el celular:
 * - Se arma un archivo .json con todo el negocio y las fotos, cifrado con la
 *   contraseña que pone el comerciante.
 * - El comerciante lo guarda donde quiera con el menú de compartir del celular
 *   (WhatsApp a sí mismo, Drive, correo, memoria). La app no lo sube sola.
 * - Además quedan las últimas copias dentro de la app, por si se equivoca al
 *   recuperar (pero eso no sirve si se pierde el celular).
 */
const KEEP_LOCAL = 5;

function folder(name: 'fotos' | 'copias'): Directory {
  const dir = new Directory(Paths.document, name);
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** "Bodega Doña Rosa" → "bodega-dona-rosa". */
const slug = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'negocio';

/** "2026-10-12-1530" en hora de Lima. */
function stamp(now: Date): string {
  const d = new Date(now.getTime() - 5 * 3_600_000).toISOString();
  return `${d.slice(0, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}`;
}

async function collectPhotos(): Promise<Record<string, string>> {
  const rows = await db.all<{ image_url: string | null }>("SELECT image_url FROM products WHERE image_url LIKE '%/fotos/%'");
  const photos: Record<string, string> = {};
  for (const r of rows) {
    const file = new File(r.image_url!);
    if (file.exists) photos[file.name] = await file.base64();
  }
  return photos;
}

async function writeBackupFile(prefix: string, password: string): Promise<{ file: File; summary: BackupSummary }> {
  const business = await getBusiness(db);
  const backup = await createBackup(db, c, await collectPhotos());
  const content = JSON.stringify(await encryptBackup(backup, password, c));
  const dir = folder('copias');
  const file = new File(dir, `${prefix}-${slug(business?.name ?? '')}-${stamp(new Date())}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  // Se guardan solo las últimas copias dentro de la app.
  const old = dir
    .list()
    .filter((f): f is File => f instanceof File && f.name.startsWith(prefix))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(KEEP_LOCAL);
  for (const f of old) f.delete();
  return { file, summary: backupSummary(backup) };
}

/**
 * Hace la copia protegida y abre el menú de compartir. Ojo: que el menú se
 * abra NO significa que la copia quedó guardada (el comerciante puede cerrar
 * el menú o el envío puede fallar). Por eso queda como "sin comprobar".
 */
export async function makeAndShareBackup(password: string): Promise<{ summary: BackupSummary; fileName: string }> {
  const { file, summary } = await writeBackupFile('perupos-copia', password);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este celular no permite compartir archivos.');
  await markBackupDone(db);
  emitDataChanged();
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Guarda tu copia fuera del celular (WhatsApp a ti mismo, Drive, correo…)',
  });
  return { summary, fileName: file.name };
}

/** El comerciante elige un archivo. null si canceló. Solo se lee lo que está a la vista. */
export async function pickBackupFile(): Promise<{ text: string; peek: BackupPeek; name: string } | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream', '*/*'] });
  if (picked.canceled || !picked.result) return null;
  const text = await picked.result.text();
  return { text, peek: peekBackup(text), name: picked.result.name };
}

/** Abre la copia con su contraseña y la revisa entera. No cambia nada del celular. */
export async function openBackupText(text: string, password: string): Promise<{ backup: BackupFile; summary: BackupSummary }> {
  const backup = await openBackup(c, text, password || undefined);
  return { backup, summary: backupSummary(backup) };
}

/** Comprobar una copia guardada: si se abre con la contraseña, queda anotada como comprobada. */
export async function verifyBackupText(text: string, password: string): Promise<BackupSummary> {
  const { backup, summary } = await openBackupText(text, password);
  await markBackupVerified(db, backup.createdAt);
  emitDataChanged();
  return summary;
}

/**
 * Reemplaza todo lo del celular por la copia. Si ya había un negocio, antes
 * guarda una copia de lo actual dentro de la app ("antes-de-recuperar"),
 * protegida con la misma contraseña de la copia que se recupera.
 */
export async function restoreFromBackup(backup: BackupFile, password: string): Promise<void> {
  // (Una copia antigua sin contraseña no tiene con qué proteger esa copia previa: se omite.)
  if (password.length >= BACKUP_PASSWORD_MIN && (await getBusiness(db))) await writeBackupFile('antes-de-recuperar', password);
  // Fotos: se escriben en la carpeta de este celular y se corrige su ruta.
  const dir = folder('fotos');
  const newUri: Record<string, string> = {};
  for (const [name, base64] of Object.entries(backup.photos)) {
    const file = new File(dir, name);
    if (file.exists) file.delete();
    file.create();
    file.write(base64, { encoding: 'base64' });
    newUri[name] = file.uri;
  }
  for (const p of backup.tables.products) {
    const url = typeof p.image_url === 'string' ? p.image_url : null;
    if (url?.includes('/fotos/')) p.image_url = newUri[url.split('/').pop() ?? ''] ?? null;
  }
  await restoreBackup(db, backup);
  emitDataChanged();
}

export const backupReminderText = () => backupReminder(db);
