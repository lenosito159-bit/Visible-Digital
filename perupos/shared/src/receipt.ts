import { amountInWords, formatSoles } from './money.js';
import { isElectronic } from './rules.js';
import type { AbonoReceipt, BusinessSettings, CashSummary, PaymentMethod, Sale } from './types.js';
import { DOC_TYPE_LABELS, PAYMENT_METHOD_LABELS, TAX_REGIME_LABELS } from './types.js';

/** Ancho típico de una ticketera térmica de 58 mm (32) u 80 mm (42/48). */
export type ReceiptWidth = 32 | 42 | 48;

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = Math.floor((width - text.length) / 2);
  return ' '.repeat(pad) + text;
}

function row(left: string, right: string, width: number): string {
  const space = width - right.length;
  const l = left.length > space - 1 ? left.slice(0, space - 1) : left;
  return l + ' '.repeat(Math.max(1, space - l.length)) + right;
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > width) {
      if (current) lines.push(current);
      current = w;
    } else current = (current + ' ' + w).trim();
  }
  if (current) lines.push(current);
  return lines;
}

/** Fecha en hora de Lima (UTC-5, Perú no usa horario de verano). */
export function formatLimaDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() - 5 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function documentNumber(sale: Pick<Sale, 'serie' | 'correlativo' | 'number'>): string {
  if (sale.serie && sale.correlativo) return `${sale.serie}-${String(sale.correlativo).padStart(8, '0')}`;
  return `NV-${String(sale.number).padStart(6, '0')}`;
}

/**
 * Representación impresa del comprobante en texto plano: sirve para la
 * ticketera térmica y para compartir por WhatsApp.
 */
export function buildReceiptText(
  sale: Sale,
  business: BusinessSettings,
  width: ReceiptWidth = 32,
): string {
  const sep = '-'.repeat(width);
  const out: string[] = [];
  const nrus = business.taxRegime === 'NRUS';

  out.push(center(business.nombreComercial || business.razonSocial, width));
  if (business.nombreComercial && business.nombreComercial !== business.razonSocial) {
    out.push(...wrap(business.razonSocial, width).map((l) => center(l, width)));
  }
  out.push(center(`RUC ${business.ruc}`, width));
  out.push(...wrap(business.direccion, width).map((l) => center(l, width)));
  if (business.phone) out.push(center(`Tel. ${business.phone}`, width));
  if (nrus) out.push(center(TAX_REGIME_LABELS.NRUS, width));
  out.push(sep);
  out.push(center(DOC_TYPE_LABELS[sale.docType].toUpperCase(), width));
  out.push(center(documentNumber(sale), width));
  out.push(`Fecha: ${formatLimaDate(sale.createdAt)}`);
  out.push(`Atendió: ${sale.sellerName}`);
  if (sale.buyerDocNumber) {
    out.push(`${sale.buyerDocType}: ${sale.buyerDocNumber}`);
    if (sale.buyerName) out.push(...wrap(`Cliente: ${sale.buyerName}`, width));
  } else if (sale.customerName) {
    out.push(...wrap(`Cliente: ${sale.customerName}`, width));
  }
  out.push(sep);

  for (const item of sale.items) {
    out.push(...wrap(item.name, width));
    const qty = item.unit === 'KG' ? `${item.quantity.toFixed(3)} kg` : `${item.quantity}`;
    out.push(row(`  ${qty} x ${formatSoles(item.unitPriceCents)}`, formatSoles(item.totalCents), width));
  }
  out.push(sep);

  if (sale.discountCents > 0) {
    out.push(row('Subtotal', formatSoles(sale.subtotalCents), width));
    out.push(row('Descuento', `-${formatSoles(sale.discountCents)}`, width));
  }
  if (!nrus) {
    if (sale.gravadaCents > 0) out.push(row('Op. gravada', formatSoles(sale.gravadaCents), width));
    if (sale.exoneradaCents > 0) out.push(row('Op. exonerada', formatSoles(sale.exoneradaCents), width));
    if (sale.inafectaCents > 0) out.push(row('Op. inafecta', formatSoles(sale.inafectaCents), width));
    out.push(row('IGV 18%', formatSoles(sale.igvCents), width));
  }
  out.push(row('TOTAL', formatSoles(sale.totalCents), width));
  out.push(...wrap(`SON: ${amountInWords(sale.totalCents)}`, width));
  out.push(sep);

  out.push('Forma de pago:');
  for (const p of sale.payments) {
    out.push(row(`  ${PAYMENT_METHOD_LABELS[p.method]}`, formatSoles(p.amountCents), width));
    if (p.tenderedCents && p.tenderedCents > p.amountCents) {
      out.push(row('  Recibido', formatSoles(p.tenderedCents), width));
    }
  }
  if (sale.changeCents > 0) out.push(row('VUELTO', formatSoles(sale.changeCents), width));
  out.push(sep);

  if (sale.status === 'VOIDED') out.push(center('*** ANULADO ***', width));
  if (sale.docType === 'TICKET') {
    out.push(...wrap('Nota de venta. Canjeable por comprobante de pago.', width).map((l) => center(l, width)));
  } else if (isElectronic(sale.docType)) {
    const label = DOC_TYPE_LABELS[sale.docType];
    out.push(...wrap(`Representación impresa de la ${label}.`, width).map((l) => center(l, width)));
    if (sale.sunatStatus === 'PENDIENTE' || sale.sunatStatus === 'ERROR') {
      out.push(...wrap('Comprobante en envío a SUNAT.', width).map((l) => center(l, width)));
    }
  }
  if (business.receiptFooter) out.push(...wrap(business.receiptFooter, width).map((l) => center(l, width)));
  out.push(center('¡Gracias por su compra!', width));
  return out.join('\n');
}

export function buildAbonoReceiptText(
  abono: AbonoReceipt,
  business: BusinessSettings,
  width: ReceiptWidth = 32,
): string {
  const sep = '-'.repeat(width);
  return [
    center(business.nombreComercial || business.razonSocial, width),
    center(`RUC ${business.ruc}`, width),
    sep,
    center('CONSTANCIA DE ABONO', width),
    `Fecha: ${formatLimaDate(abono.createdAt)}`,
    ...wrap(`Cliente: ${abono.customerName}`, width),
    `Recibió: ${abono.userName}`,
    sep,
    row('Deuda anterior', formatSoles(abono.previousBalanceCents), width),
    row(`Abono (${PAYMENT_METHOD_LABELS[abono.method]})`, `-${formatSoles(abono.amountCents)}`, width),
    row('SALDO PENDIENTE', formatSoles(abono.balanceCents), width),
    sep,
    abono.balanceCents === 0 ? center('¡Deuda cancelada! Gracias.', width) : center('Gracias por su abono.', width),
  ].join('\n');
}

/** Resumen del cierre de caja para mandarlo por WhatsApp al dueño. */
export function buildCashCloseText(cash: CashSummary, business: BusinessSettings, width: ReceiptWidth = 32): string {
  const sep = '-'.repeat(width);
  const methods: PaymentMethod[] = ['CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD', 'FIADO'];
  const lines = [
    center(business.nombreComercial || business.razonSocial, width),
    center(cash.closedAt ? 'CIERRE DE CAJA' : 'CAJA (PARCIAL)', width),
    `Abrió: ${cash.openedBy} ${formatLimaDate(cash.openedAt)}`,
    cash.closedAt ? `Cerró: ${formatLimaDate(cash.closedAt)}` : `Al: ${formatLimaDate(new Date().toISOString())}`,
    sep,
    `Ventas del turno (${cash.salesCount}):`,
    ...methods.filter((m) => cash.byMethod[m]).map((m) => row(`  ${PAYMENT_METHOD_LABELS[m]}`, formatSoles(cash.byMethod[m]!), width)),
  ];
  const abonos = methods.filter((m) => cash.abonosByMethod[m]);
  if (abonos.length) {
    lines.push('Abonos cobrados:');
    lines.push(...abonos.map((m) => row(`  ${PAYMENT_METHOD_LABELS[m]}`, formatSoles(cash.abonosByMethod[m]!), width)));
  }
  lines.push(
    sep,
    'Efectivo en el cajón:',
    row('  Apertura', formatSoles(cash.openingCents), width),
    row('  Ventas en efectivo', formatSoles(cash.cashSalesCents), width),
  );
  if (cash.digitalChangeCents) lines.push(row('  Vuelto de yapeos', `-${formatSoles(cash.digitalChangeCents)}`, width));
  if (cash.cashAbonosCents) lines.push(row('  Abonos en efectivo', formatSoles(cash.cashAbonosCents), width));
  if (cash.inCents) lines.push(row('  Ingresos', formatSoles(cash.inCents), width));
  if (cash.outCents) lines.push(row('  Retiros y pagos', `-${formatSoles(cash.outCents)}`, width));
  lines.push(row('DEBE HABER', formatSoles(cash.expectedCents), width));
  if (cash.countedCents !== null) {
    lines.push(row('Contado', formatSoles(cash.countedCents), width));
    if (cash.transferredCents) lines.push(row('Yapeado al admin.', formatSoles(cash.transferredCents), width));
    const diff = cash.differenceCents ?? 0;
    lines.push(row(diff === 0 ? 'CUADRA' : diff > 0 ? 'SOBRA' : 'FALTA', formatSoles(Math.abs(diff)), width));
  }
  return lines.join('\n');
}
