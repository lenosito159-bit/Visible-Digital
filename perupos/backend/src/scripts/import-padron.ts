/**
 * Carga el Padrón Reducido del RUC de SUNAT en la tabla sunat_padron.
 *
 * 1. Descarga padron_reducido_ruc.zip desde
 *    https://www.sunat.gob.pe/descargaPRR/mrc137_padron_reducido.html (se actualiza a diario).
 * 2. Descomprímelo (el .txt pesa varios GB) y ejecuta:
 *    npm run padron:import -w @perupos/backend -- --file /ruta/padron_reducido_ruc.txt
 *
 * Formato: texto Latin-1, una fila por RUC, columnas separadas por "|":
 * RUC | NOMBRE O RAZÓN SOCIAL | ESTADO | CONDICIÓN DE DOMICILIO | UBIGEO | ...dirección...
 * Se guardan solo las 5 primeras columnas. "-" significa vacío.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { migrate } from '../db/migrate.js';
import { pool } from '../db/pool.js';

export interface PadronRow {
  ruc: string;
  razonSocial: string;
  estado: string;
  condicion: string;
  ubigeo: string | null;
}

/** Interpreta una línea del padrón. Devuelve null para la cabecera o líneas rotas. */
export function parsePadronLine(line: string): PadronRow | null {
  const cols = line.split('|').map((c) => c.trim());
  const [ruc, razon, estado, condicion, ubigeo] = cols;
  if (!ruc || !/^\d{11}$/.test(ruc) || !razon || !estado || !condicion) return null;
  const clean = (v: string | undefined) => (!v || v === '-' ? null : v.replace(/^"+|"+$/g, ''));
  return {
    ruc,
    razonSocial: clean(razon) ?? '',
    estado: estado.toUpperCase(),
    condicion: condicion.toUpperCase(),
    ubigeo: clean(ubigeo),
  };
}

async function flush(batch: PadronRow[]): Promise<void> {
  if (batch.length === 0) return;
  await pool.query(
    `INSERT INTO sunat_padron (ruc, razon_social, estado, condicion, ubigeo)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT (ruc) DO UPDATE SET razon_social = EXCLUDED.razon_social, estado = EXCLUDED.estado,
       condicion = EXCLUDED.condicion, ubigeo = EXCLUDED.ubigeo, loaded_at = now()`,
    [
      batch.map((r) => r.ruc),
      batch.map((r) => r.razonSocial),
      batch.map((r) => r.estado),
      batch.map((r) => r.condicion),
      batch.map((r) => r.ubigeo),
    ],
  );
}

export async function importPadron(file: string, log: (m: string) => void = console.log): Promise<{ rows: number; skipped: number }> {
  await migrate(() => {});
  const lines = createInterface({ input: createReadStream(file, { encoding: 'latin1' }), crlfDelay: Infinity });
  let batch: PadronRow[] = [];
  let rows = 0;
  let skipped = 0;
  for await (const line of lines) {
    const row = parsePadronLine(line);
    if (!row) {
      skipped++;
      continue;
    }
    batch.push(row);
    if (batch.length >= 5000) {
      await flush(batch);
      rows += batch.length;
      batch = [];
      if (rows % 500_000 === 0) log(`${rows.toLocaleString('es-PE')} RUC cargados…`);
    }
  }
  await flush(batch);
  rows += batch.length;
  return { rows, skipped };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--file');
  const file = i >= 0 ? process.argv[i + 1] : undefined;
  if (!file) {
    console.error('Indica el archivo: --file /ruta/padron_reducido_ruc.txt');
    process.exit(1);
  }
  importPadron(file)
    .then(({ rows, skipped }) => console.log(`Listo: ${rows} RUC cargados (${skipped} líneas ignoradas).`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
