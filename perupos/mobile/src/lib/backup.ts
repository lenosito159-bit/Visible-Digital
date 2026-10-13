import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  backupReminder,
  backupSummary,
  createBackup,
  getBusiness,
  markBackupDone,
  readBackup,
  restoreBackup,
  type BackupFile,
  type BackupSummary,
} from '@perupos/shared';
import { localCrypto as c, localDb as db } from './localDb';
import { emitDataChanged } from './sync';

/**
 * Copia de seguridad en el celular:
 * - Se arma un archivo .json con todo el negocio y las fotos de los productos.
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

async function writeBackupFile(prefix: string): Promise<{ file: File; summary: BackupSummary }> {
  const business = await getBusiness(db);
  const backup = await createBackup(db, c, await collectPhotos());
  const dir = folder('copias');
  const file = new File(dir, `${prefix}-${slug(business?.name ?? '')}-${stamp(new Date())}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(backup));
  // Se guardan solo las últimas copias dentro de la app.
  const old = dir
    .list()
    .filter((f): f is File => f instanceof File && f.name.startsWith(prefix))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(KEEP_LOCAL);
  for (const f of old) f.delete();
  return { file, summary: backupSummary(backup) };
}

/** Hace la copia y abre el menú de compartir para guardarla fuera del celular. */
export async function makeAndShareBackup(): Promise<BackupSummary> {
  const { file, summary } = await writeBackupFile('perupos-copia');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Este celular no permite compartir archivos.');
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: 'Guarda tu copia fuera del celular (WhatsApp a ti mismo, Drive, correo…)',
  });
  await markBackupDone(db);
  emitDataChanged();
  return summary;
}

/** El comerciante elige el archivo de la copia. null si canceló. */
export async function pickBackup(): Promise<{ backup: BackupFile; summary: BackupSummary } | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream', '*/*'] });
  if (picked.canceled || !picked.result) return null;
  const backup = await readBackup(c, await picked.result.text());
  return { backup, summary: backupSummary(backup) };
}

/**
 * Reemplaza todo lo del celular por la copia. Si ya había un negocio, antes
 * guarda una copia de lo actual dentro de la app ("antes-de-recuperar").
 */
export async function restoreFromBackup(backup: BackupFile): Promise<void> {
  if (await getBusiness(db)) await writeBackupFile('antes-de-recuperar');
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
