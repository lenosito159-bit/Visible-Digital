import type { BusinessSettings, Sale, SunatStatus } from '@perupos/shared';
import { config } from '../../config.js';
import { MockPse } from './mock.js';
import { NubefactPse } from './nubefact.js';

export interface PseResult {
  status: Exclude<SunatStatus, 'NO_APLICA'>;
  message: string;
  /** Texto del código QR que va impreso en el comprobante. */
  qr: string | null;
  hash: string | null;
  pdfUrl: string | null;
  raw: unknown;
}

/** Proveedor de Servicios Electrónicos: emite boletas, facturas y tickets POS ante SUNAT. */
export interface PseProvider {
  readonly name: string;
  emit(sale: Sale, business: BusinessSettings): Promise<PseResult>;
  /** Consulta si SUNAT ya aceptó un comprobante enviado (las boletas van en resumen diario). */
  status(sale: Sale, business: BusinessSettings): Promise<PseResult>;
  /** Comunicación de baja / anulación. */
  void(sale: Sale, business: BusinessSettings, reason: string): Promise<PseResult>;
}

let instance: PseProvider | null | undefined;

export function pseProvider(): PseProvider | null {
  if (instance === undefined) {
    instance =
      config.PSE_PROVIDER === 'nubefact'
        ? new NubefactPse(config.NUBEFACT_URL!, config.NUBEFACT_TOKEN!)
        : config.PSE_PROVIDER === 'mock'
          ? new MockPse()
          : null;
  }
  return instance;
}

export function setPseProvider(provider: PseProvider | null): void {
  instance = provider;
}

/** Código de tipo de comprobante (catálogo 01 de SUNAT). */
export function sunatDocCode(docType: Sale['docType']): string {
  if (docType === 'FACTURA') return '01';
  if (docType === 'BOLETA') return '03';
  // Ticket POS: el código real lo define el PSE-CF. '12' es solo un marcador para el modo de prueba.
  return '12';
}

/** Código de documento de identidad (catálogo 06 de SUNAT). */
export function sunatIdentityCode(docType: Sale['buyerDocType']): string {
  switch (docType) {
    case 'DNI':
      return '1';
    case 'CE':
      return '4';
    case 'RUC':
      return '6';
    default:
      return '0';
  }
}

/** Fecha de emisión en hora de Lima: YYYY-MM-DD. */
export function limaDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Contenido del QR de la representación impresa:
 * RUC | TIPO | SERIE | NÚMERO | IGV | TOTAL | FECHA | TIPO DOC. ADQUIRENTE | NÚMERO DOC. ADQUIRENTE |
 */
export function sunatQrText(sale: Sale, business: BusinessSettings, hash = ''): string {
  return [
    business.ruc,
    sunatDocCode(sale.docType),
    sale.serie,
    sale.correlativo,
    (sale.igvCents / 100).toFixed(2),
    (sale.totalCents / 100).toFixed(2),
    limaDate(sale.createdAt),
    sale.buyerDocType ? sunatIdentityCode(sale.buyerDocType) : '',
    sale.buyerDocNumber ?? '',
    hash,
  ].join('|') + '|';
}
