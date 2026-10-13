import type { BusinessSettings, Sale } from '@perupos/shared';
import { createHash } from 'node:crypto';
import type { PseProvider, PseResult } from './provider.js';
import { sunatQrText } from './provider.js';

/** PSE de prueba: "acepta" todo al instante. No envía nada a SUNAT. */
export class MockPse implements PseProvider {
  readonly name = 'mock';

  async emit(sale: Sale, business: BusinessSettings): Promise<PseResult> {
    const hash = createHash('sha1').update(`${sale.serie}-${sale.correlativo}`).digest('base64').slice(0, 28);
    return {
      status: 'ACEPTADO',
      message: 'Comprobante de prueba (PSE simulado, no se envió a SUNAT).',
      qr: sunatQrText(sale, business, hash),
      hash,
      pdfUrl: null,
      raw: { mock: true },
    };
  }

  async status(sale: Sale, business: BusinessSettings): Promise<PseResult> {
    return this.emit(sale, business);
  }

  async void(): Promise<PseResult> {
    return { status: 'ACEPTADO', message: 'Anulación simulada.', qr: null, hash: null, pdfUrl: null, raw: { mock: true } };
  }
}
