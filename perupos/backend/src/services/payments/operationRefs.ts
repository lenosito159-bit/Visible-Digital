import { one, type Db } from '../../db/pool.js';
import { badRequest, conflict } from '../../http/errors.js';

/** "  0012 3456 " => "00123456": así se compara igual aunque se escriba con espacios. */
export function normalizeReference(reference: string): string {
  return reference.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * Reserva el N° de operación de un Yape/Plin confirmado a mano. Si ya se usó
 * (en otra venta o en otro abono, de cualquier cliente), se rechaza: así no se
 * puede cobrar dos veces con la misma captura de pantalla.
 */
export async function claimOperationRef(
  db: Db,
  method: string,
  reference: string,
  target: { saleId?: string; movementId?: string },
): Promise<string> {
  const ref = normalizeReference(reference);
  if (!/^[A-Z0-9]{4,30}$/.test(ref)) throw badRequest('El N° de operación debe tener entre 4 y 30 letras o números.', 'OPERACION_INVALIDA');
  if (method !== 'YAPE' && method !== 'PLIN') return ref;
  const used = await one(db, 'SELECT sale_id, movement_id FROM operation_refs WHERE method = $1 AND reference = $2', [method, ref]);
  if (used) {
    throw conflict(`El N° de operación ${ref} ya se usó en otro cobro. Revisa la notificación de ${method === 'YAPE' ? 'Yape' : 'Plin'}.`, 'OPERACION_YA_USADA');
  }
  await db.query('INSERT INTO operation_refs (method, reference, sale_id, movement_id) VALUES ($1, $2, $3, $4)', [
    method,
    ref,
    target.saleId ?? null,
    target.movementId ?? null,
  ]);
  return ref;
}
