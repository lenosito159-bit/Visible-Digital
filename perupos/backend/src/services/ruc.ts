import { isValidRuc } from '@perupos/shared';
import { one, type Db } from '../db/pool.js';

export interface RucCheck {
  ruc: string;
  /** 11 dígitos, prefijo válido y dígito verificador correcto. */
  validFormat: boolean;
  /** PADRON = se encontró (o no) en la copia local del padrón; NO_VERIFICADO = no hay padrón cargado. */
  source: 'PADRON' | 'NO_VERIFICADO';
  found: boolean;
  razonSocial: string | null;
  estado: string | null;
  condicion: string | null;
  /** ACTIVO y HABIDO: se le puede emitir factura sin problemas. */
  ok: boolean;
  message: string;
  padronLoadedAt: string | null;
}

/**
 * Consulta el RUC en la copia local del Padrón Reducido de SUNAT.
 * No consulta a SUNAT en línea: SUNAT no ofrece una API pública gratuita para
 * esto. Si el padrón no está cargado, se dice claramente "no verificado".
 */
export async function checkRuc(db: Db, ruc: string): Promise<RucCheck> {
  const validFormat = isValidRuc(ruc);
  const base = { ruc, validFormat, razonSocial: null, estado: null, condicion: null };
  if (!validFormat) {
    return { ...base, source: 'NO_VERIFICADO', found: false, ok: false, message: 'El RUC no es válido (revisa los 11 dígitos).', padronLoadedAt: null };
  }
  const loaded = await one<{ at: Date | null }>(db, 'SELECT max(loaded_at) AS at FROM sunat_padron');
  if (!loaded?.at) {
    return {
      ...base,
      source: 'NO_VERIFICADO',
      found: false,
      ok: true,
      message: 'RUC con formato correcto, pero no verificado contra el padrón de SUNAT (padrón no cargado).',
      padronLoadedAt: null,
    };
  }
  const row = await one(db, 'SELECT * FROM sunat_padron WHERE ruc = $1', [ruc]);
  const padronLoadedAt = loaded.at.toISOString();
  if (!row) {
    return { ...base, source: 'PADRON', found: false, ok: false, message: 'Este RUC no aparece en el padrón de SUNAT.', padronLoadedAt };
  }
  const active = row.estado === 'ACTIVO';
  const habido = row.condicion === 'HABIDO';
  return {
    ruc,
    validFormat,
    source: 'PADRON',
    found: true,
    razonSocial: row.razon_social,
    estado: row.estado,
    condicion: row.condicion,
    ok: active && habido,
    message: active && habido ? 'RUC activo y habido.' : `RUC ${row.estado.toLowerCase()} y ${row.condicion.toLowerCase().replace('_', ' ')} en SUNAT.`,
    padronLoadedAt,
  };
}
