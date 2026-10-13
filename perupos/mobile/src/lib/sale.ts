import { saleNumber, type Sale } from '@perupos/shared';

/** "Venta N° 000001": número interno de la venta (no es una serie de SUNAT). */
export function saleLabel(sale: Pick<Sale, 'number'>): string {
  return saleNumber(sale.number);
}
