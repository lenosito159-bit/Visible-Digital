import { many, pool } from '../../db/pool.js';
import { getSale } from '../sales.js';
import { getSettings } from '../settings.js';
import { pseProvider } from './provider.js';

/** Tras 8 intentos fallidos el comprobante queda en ERROR para revisión manual. */
const MAX_ATTEMPTS = 8;

let running = false;

/**
 * Envía al PSE los comprobantes pendientes. Corre después de cada venta y
 * periódicamente, así una venta hecha sin internet se emite al reconectar.
 */
export async function emitPendingDocuments(limit = 20): Promise<number> {
  const provider = pseProvider();
  if (!provider || running) return 0;
  running = true;
  try {
    const rows = await many<{ id: string; sunat_response: unknown }>(
      pool,
      `SELECT id, sunat_response FROM sales
        WHERE sunat_status IN ('PENDIENTE', 'ERROR') AND sunat_attempts < $1
        ORDER BY created_at LIMIT $2`,
      [MAX_ATTEMPTS, limit],
    );
    if (rows.length === 0) return 0;
    const business = await getSettings(pool);
    let done = 0;
    for (const row of rows) {
      const sale = await getSale(pool, row.id);
      if (!sale) continue;
      // Si ya se envió y solo falta la respuesta de SUNAT, se consulta en vez de reenviar.
      const alreadySent = row.sunat_response && (row.sunat_response as { enviado?: boolean }).enviado;
      const result = alreadySent ? await provider.status(sale, business) : await provider.emit(sale, business);
      await pool.query(
        `UPDATE sales SET sunat_status = $2, sunat_qr = COALESCE($3, sunat_qr), sunat_hash = COALESCE($4, sunat_hash),
                sunat_pdf_url = COALESCE($5, sunat_pdf_url), sunat_response = $6,
                sunat_attempts = sunat_attempts + CASE WHEN $2 = 'ERROR' THEN 1 ELSE 0 END
          WHERE id = $1`,
        [
          sale.id,
          result.status,
          result.qr,
          result.hash,
          result.pdfUrl,
          JSON.stringify({ enviado: result.status !== 'ERROR' || !!alreadySent, message: result.message, raw: result.raw }),
        ],
      );
      if (result.status === 'ACEPTADO') done++;
    }
    return done;
  } finally {
    running = false;
  }
}
