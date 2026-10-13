import { TZ, many, type Db } from '../db/pool.js';
import { getSettings } from './settings.js';
import { sunatDocCode, sunatIdentityCode } from './pse/provider.js';

const amount = (cents: number) => (cents / 100).toFixed(2);

function ddmmyyyy(d: Date): string {
  const lima = new Date(d.getTime() - 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(lima.getUTCDate())}/${p(lima.getUTCMonth() + 1)}/${lima.getUTCFullYear()}`;
}

/**
 * Columnas del archivo de reemplazo de la propuesta del Registro de Ventas e
 * Ingresos Electrónico (RVIE) del SIRE, separadas por "|".
 * El NOMBRE del archivo sigue la estructura publicada para el reemplazo de la
 * propuesta del RVIE. Las COLUMNAS no se pudieron contrastar con el Anexo 3
 * vigente (R.S. 112-2021 y modificatorias, p. ej. R.S. 000138-2023) desde el
 * entorno de desarrollo: valídalas con tu contador o con la carga de prueba del
 * SIRE antes de subir el archivo.
 */
export const SIRE_COLUMNS = [
  'RUC', 'Razón social', 'Periodo', 'CAR SUNAT', 'Fecha de emisión', 'Fecha Vcto/Pago', 'Tipo CP/Doc.',
  'Serie del CDP', 'Nro CP o Doc. Nro Inicial (Rango)', 'Nro Final (Rango)', 'Tipo Doc Identidad',
  'Nro Doc Identidad', 'Apellidos Nombres/ Razón Social', 'Valor Facturado Exportación', 'BI Gravada',
  'Dscto BI', 'IGV / IPM', 'Dscto IGV / IPM', 'Mto Exonerado', 'Mto Inafecto', 'ISC', 'BI Grav IVAP',
  'IVAP', 'ICBPER', 'Otros Tributos', 'Total CP', 'Moneda', 'Tipo Cambio', 'Fecha Emisión Doc Modificado',
  'Tipo CP Modificado', 'Serie CP Modificado', 'Nro CP Modificado', 'ID Proyecto Operadores Atribución',
  'Tipo de Nota', 'Est. Comp', 'Valor FOB Embarcado', 'Valor OP Gratuitas', 'Tipo Operación', 'DAM / CP',
  'CLU',
];

export interface SireExport {
  fileName: string;
  content: string;
  rows: number;
}

/** Exporta las boletas y facturas de un periodo (AAAAMM) para el SIRE. */
export async function exportSire(db: Db, period: string): Promise<SireExport> {
  const business = await getSettings(db);
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const sales = await many(
    db,
    `SELECT * FROM sales
      WHERE doc_type IN ('BOLETA', 'FACTURA')
        AND created_at >= ($1::date::timestamp AT TIME ZONE $2)
        AND created_at < (($1::date + interval '1 month')::timestamp AT TIME ZONE $2)
      ORDER BY doc_type, serie, correlativo`,
    [from, TZ],
  );
  const lines = sales.map((s) => {
    const voided = s.status === 'VOIDED';
    const v = (cents: number) => (voided ? '0.00' : amount(cents));
    const hasBuyer = s.buyer_doc_type && s.buyer_doc_type !== 'NONE';
    return [
      business.ruc,
      business.razonSocial,
      period,
      '', // CAR: lo asigna SUNAT.
      ddmmyyyy(s.created_at),
      '',
      sunatDocCode(s.doc_type),
      s.serie,
      String(s.correlativo),
      '',
      hasBuyer ? sunatIdentityCode(s.buyer_doc_type) : '0',
      hasBuyer ? s.buyer_doc_number : '-',
      hasBuyer ? s.buyer_name : 'CLIENTES VARIOS',
      '0.00',
      v(s.gravada_cents),
      '0.00',
      v(s.igv_cents),
      '0.00',
      v(s.exonerada_cents),
      v(s.inafecta_cents),
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      '0.00',
      v(s.total_cents),
      'PEN',
      '1.000',
      '',
      '',
      '',
      '',
      '',
      '',
      voided ? '2' : '1',
      '',
      '0.00',
      '0101',
      '',
      '',
    ].join('|');
  });
  // LERRRRRRRRRRRAAAAMM0014040002OIM2.TXT
  // 00 = RVIE · 140400 = libro · 02 = reemplaza la propuesta
  // O = indicador de operaciones (1 = empresa o entidad operativa)
  // I = indicador de contenido (1 = con información, 0 = sin información)
  // M = moneda (1 = soles) · 2 = generado por el nuevo sistema.
  const fileName = `LE${business.ruc}${period}00140400021${lines.length ? 1 : 0}12.txt`;
  return { fileName, content: lines.join('\r\n') + (lines.length ? '\r\n' : ''), rows: lines.length };
}
