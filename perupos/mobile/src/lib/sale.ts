import QRCode from 'qrcode';
import {
  PAYMENT_METHOD_LABELS,
  QR_METHODS,
  amountInWords,
  buildReceiptText,
  checkPayments,
  computeTaxes,
  documentNumber,
  formatLimaDate,
  formatSoles,
  isElectronic,
  lineTotal,
  DOC_TYPE_LABELS,
  type BusinessSettings,
  type Sale,
  type SaleInput,
  type User,
} from '@perupos/shared';
import type { CartLine } from './cart';

/**
 * Arma en el teléfono la misma venta que registrará el servidor, para poder
 * mostrar e imprimir el ticket aunque no haya internet.
 */
export function buildLocalSale(
  input: SaleInput,
  lines: CartLine[],
  settings: BusinessSettings,
  seller: User,
  customerName: string | null,
): Sale {
  const taxes = computeTaxes(
    lines.map((l) => ({ totalCents: lineTotal(l.product.priceCents, l.quantity), taxAffectation: l.product.taxAffectation })),
    input.discountCents,
    settings.taxRegime,
    settings.igvRate,
  );
  const check = checkPayments(taxes.totalCents, input.payments, { hasCustomer: !!input.customerId, final: false });
  return {
    id: input.id,
    number: 0,
    sellerId: seller.id,
    sellerName: seller.name,
    customerId: input.customerId,
    customerName,
    status: 'COMPLETED',
    docType: input.docType,
    serie: null,
    correlativo: null,
    sunatStatus: isElectronic(input.docType) ? 'PENDIENTE' : 'NO_APLICA',
    sunatQr: null,
    items: lines.map((l, i) => ({
      productId: l.product.id,
      name: l.product.name,
      quantity: l.quantity,
      unit: l.product.unit,
      unitPriceCents: l.product.priceCents,
      totalCents: lineTotal(l.product.priceCents, l.quantity),
      taxAffectation: l.product.taxAffectation,
      igvCents: taxes.lines[i]?.igvCents ?? 0,
    })),
    payments: input.payments.map((p) => ({
      method: p.method,
      amountCents: p.amountCents,
      tenderedCents: p.method === 'CASH' ? (p.tenderedCents ?? p.amountCents) : null,
      changeCents: p.method === 'CASH' ? (p.tenderedCents ?? p.amountCents) - p.amountCents : 0,
      confirmation: QR_METHODS.includes(p.method) ? (p.confirmation ?? null) : null,
      chargeId: p.chargeId ?? null,
    })),
    subtotalCents: taxes.subtotalCents,
    discountCents: taxes.discountCents,
    gravadaCents: taxes.gravadaCents,
    exoneradaCents: taxes.exoneradaCents,
    inafectaCents: taxes.inafectaCents,
    igvCents: taxes.igvCents,
    totalCents: taxes.totalCents,
    changeCents: check.changeCents,
    buyerDocType: input.buyer?.docType ?? null,
    buyerDocNumber: input.buyer?.docNumber ?? null,
    buyerName: input.buyer?.name ?? null,
    createdAt: input.createdAt,
  };
}

/** Número a mostrar: el del comprobante si ya se sincronizó; si no, provisional. */
export function saleLabel(sale: Sale): string {
  if (sale.number === 0) return 'Por enviar';
  return documentNumber(sale);
}

/** QR como SVG en texto (para el ticket impreso / PDF). */
export function qrSvg(text: string, size = 140): string {
  const model = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = model.modules.size;
  const cell = size / n;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (model.modules.get(r, c)) path += `M${(c * cell).toFixed(2)},${(r * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML del ticket para imprimir (80 mm) o guardar como PDF. */
export function receiptHtml(sale: Sale, business: BusinessSettings): string {
  const nrus = business.taxRegime === 'NRUS';
  const rows = sale.items
    .map((i) => {
      const qty = i.unit === 'KG' ? `${i.quantity.toFixed(3)} kg` : i.quantity;
      return `<tr><td colspan="2">${esc(i.name)}</td></tr><tr><td class="muted">${qty} x ${formatSoles(i.unitPriceCents)}</td><td class="r">${formatSoles(i.totalCents)}</td></tr>`;
    })
    .join('');
  const line = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="total"' : ''}><td>${label}</td><td class="r">${value}</td></tr>`;
  const totals = [
    sale.discountCents > 0 ? line('Subtotal', formatSoles(sale.subtotalCents)) + line('Descuento', `-${formatSoles(sale.discountCents)}`) : '',
    !nrus && sale.gravadaCents > 0 ? line('Op. gravada', formatSoles(sale.gravadaCents)) : '',
    !nrus && sale.exoneradaCents > 0 ? line('Op. exonerada', formatSoles(sale.exoneradaCents)) : '',
    !nrus && sale.inafectaCents > 0 ? line('Op. inafecta', formatSoles(sale.inafectaCents)) : '',
    !nrus ? line('IGV 18%', formatSoles(sale.igvCents)) : '',
    line('TOTAL', formatSoles(sale.totalCents), true),
  ].join('');
  const pays = sale.payments
    .map((p) =>
      line(PAYMENT_METHOD_LABELS[p.method], formatSoles(p.amountCents)) +
      (p.method === 'CASH' && p.tenderedCents && p.tenderedCents > p.amountCents ? line('Recibido', formatSoles(p.tenderedCents)) : ''),
    )
    .join('');
  const qr = sale.sunatQr ? `<div class="c">${qrSvg(sale.sunatQr)}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: -apple-system, Roboto, Arial, sans-serif; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; margin: 0; } .c { text-align: center; } .r { text-align: right; white-space: nowrap; }
  .muted { color: #333; } table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; } .total td { font-size: 15px; font-weight: 800; }
</style></head><body>
  <div class="c"><h1>${esc(business.nombreComercial || business.razonSocial)}</h1>
  ${business.nombreComercial ? `<div>${esc(business.razonSocial)}</div>` : ''}
  <div>RUC ${business.ruc}</div><div>${esc(business.direccion)}</div>
  ${nrus ? '<div>Nuevo RUS</div>' : ''}</div>
  <hr><div class="c"><b>${DOC_TYPE_LABELS[sale.docType].toUpperCase()}</b><br>${sale.number ? documentNumber(sale) : 'Número por asignar'}</div>
  <div>Fecha: ${formatLimaDate(sale.createdAt)}<br>Atendió: ${esc(sale.sellerName)}</div>
  ${sale.buyerDocNumber ? `<div>${sale.buyerDocType}: ${sale.buyerDocNumber}<br>${esc(sale.buyerName ?? '')}</div>` : sale.customerName ? `<div>Cliente: ${esc(sale.customerName)}</div>` : ''}
  <hr><table>${rows}</table><hr><table>${totals}</table>
  <div>SON: ${amountInWords(sale.totalCents)}</div><hr>
  <table>${pays}${sale.changeCents > 0 ? line('VUELTO', formatSoles(sale.changeCents), true) : ''}</table><hr>
  ${qr}
  <div class="c">${sale.docType === 'TICKET' ? 'Nota de venta. Canjeable por comprobante de pago.' : `Representación impresa de la ${DOC_TYPE_LABELS[sale.docType]}.`}</div>
  ${business.receiptFooter ? `<div class="c">${esc(business.receiptFooter)}</div>` : ''}
  <div class="c"><b>¡Gracias por su compra!</b></div>
</body></html>`;
}

export { buildReceiptText };
