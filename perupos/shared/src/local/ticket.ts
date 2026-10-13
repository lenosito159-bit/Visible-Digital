import { formatSoles } from '../money.js';
import { formatLimaDate } from '../receipt.js';
import { QR_METHODS, type AbonoReceipt, type CashSummary, type PaymentMethod, type Sale } from '../types.js';

/**
 * Ticket interno del negocio: lo que el comerciante entrega o manda por
 * WhatsApp. No lleva RUC, régimen ni nada de SUNAT: no es boleta ni factura.
 *
 * Se arma una sola vez como lista de líneas y se dibuja en texto (ticketera
 * térmica, WhatsApp) o en HTML (imprimir, PDF).
 */
export const MANUAL_CONFIRMATION_LABEL = 'Confirmado manualmente por el comerciante';
export const INTERNAL_TICKET_NOTICE = ['Comprobante interno del negocio.', 'No es boleta ni factura.'];

export type TicketLine =
  | { kind: 'title'; text: string }
  | { kind: 'center'; text: string; bold?: boolean }
  | { kind: 'row'; label: string; value: string; strong?: boolean; indent?: boolean }
  | { kind: 'note'; text: string }
  | { kind: 'sep' };

export interface TicketBusiness {
  name: string;
  phone: string | null;
  receiptFooter: string | null;
}

/** Venta del celular: además trae la deuda del cliente justo después de esta venta (si fió). */
export type TicketSale = Sale & { fiadoBalanceAfterCents?: number | null };

const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  FIADO: 'Fiado (queda debiendo)',
};

const isManualDigital = (method: PaymentMethod, confirmation: string | null | undefined) =>
  QR_METHODS.includes(method) && confirmation === 'MANUAL';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function header(business: TicketBusiness): TicketLine[] {
  const lines: TicketLine[] = [{ kind: 'title', text: business.name }];
  if (business.phone) lines.push({ kind: 'center', text: `Cel. ${business.phone}` });
  return lines;
}

function footer(business: TicketBusiness, thanks: string): TicketLine[] {
  const lines: TicketLine[] = [{ kind: 'sep' }, ...INTERNAL_TICKET_NOTICE.map((text) => ({ kind: 'center' as const, text }))];
  if (business.receiptFooter) lines.push({ kind: 'center', text: business.receiptFooter });
  lines.push({ kind: 'center', text: thanks, bold: true });
  return lines;
}

export const saleNumber = (n: number) => `Venta N° ${String(n).padStart(6, '0')}`;

export function internalSaleTicket(sale: TicketSale, business: TicketBusiness): TicketLine[] {
  const out: TicketLine[] = [...header(business), { kind: 'sep' }];
  out.push({ kind: 'center', text: 'COMPROBANTE INTERNO', bold: true });
  out.push({ kind: 'center', text: saleNumber(sale.number) });
  if (sale.status === 'VOIDED') out.push({ kind: 'center', text: '*** VENTA ANULADA ***', bold: true });
  out.push({ kind: 'note', text: `Fecha: ${formatLimaDate(sale.createdAt)}` });
  out.push({ kind: 'note', text: `Atendió: ${sale.sellerName}` });
  if (sale.customerName) out.push({ kind: 'note', text: `Cliente: ${sale.customerName}` });
  out.push({ kind: 'sep' });

  for (const item of sale.items) {
    const qty = item.unit === 'KG' ? `${item.quantity.toFixed(3)} kg` : `${item.quantity}`;
    out.push({ kind: 'note', text: item.name });
    out.push({ kind: 'row', label: `${qty} x ${formatSoles(item.unitPriceCents)}`, value: formatSoles(item.totalCents), indent: true });
  }
  out.push({ kind: 'sep' });
  if (sale.discountCents > 0) {
    out.push({ kind: 'row', label: 'Subtotal', value: formatSoles(sale.subtotalCents) });
    out.push({ kind: 'row', label: 'Descuento', value: `-${formatSoles(sale.discountCents)}` });
  }
  out.push({ kind: 'row', label: 'TOTAL', value: formatSoles(sale.totalCents), strong: true });
  out.push({ kind: 'sep' });

  out.push({ kind: 'center', text: 'CÓMO PAGÓ', bold: true });
  for (const p of sale.payments) {
    out.push({ kind: 'row', label: METHOD_LABELS[p.method], value: formatSoles(p.amountCents) });
    if (p.tenderedCents && p.tenderedCents > p.amountCents) {
      const verb = p.method === 'CASH' ? 'Entregó' : p.method === 'YAPE' ? 'Yapeó' : p.method === 'PLIN' ? 'Plineó' : 'Pagó';
      out.push({ kind: 'row', label: verb, value: formatSoles(p.tenderedCents), indent: true });
    }
    if (isManualDigital(p.method, p.confirmation)) {
      out.push({ kind: 'note', text: `  ${MANUAL_CONFIRMATION_LABEL}` });
      if (p.reference) out.push({ kind: 'note', text: `  N° de operación ${p.reference}` });
    }
  }
  if (sale.changeCents > 0) {
    out.push({ kind: 'sep' });
    out.push({ kind: 'row', label: 'VUELTO', value: formatSoles(sale.changeCents), strong: true });
  }

  const fiado = sale.payments.find((p) => p.method === 'FIADO');
  if (fiado && sale.customerName) {
    const who = firstName(sale.customerName);
    out.push({ kind: 'sep' });
    out.push({ kind: 'center', text: 'FIADO', bold: true });
    out.push({ kind: 'note', text: `${who} queda debiendo ${formatSoles(fiado.amountCents)} de esta compra.` });
    if (sale.fiadoBalanceAfterCents != null && sale.fiadoBalanceAfterCents !== fiado.amountCents) {
      out.push({ kind: 'note', text: `Deuda total de ${who}: ${formatSoles(sale.fiadoBalanceAfterCents)}.` });
    }
  }
  out.push(...footer(business, '¡Gracias por su compra!'));
  return out;
}

export function internalAbonoTicket(
  abono: AbonoReceipt & { confirmation?: 'MANUAL' | null; reference?: string | null },
  business: TicketBusiness,
): TicketLine[] {
  const out: TicketLine[] = [...header(business), { kind: 'sep' }];
  out.push({ kind: 'center', text: 'CONSTANCIA DE ABONO', bold: true });
  out.push({ kind: 'note', text: `Fecha: ${formatLimaDate(abono.createdAt)}` });
  out.push({ kind: 'note', text: `Cliente: ${abono.customerName}` });
  out.push({ kind: 'note', text: `Recibió: ${abono.userName}` });
  out.push({ kind: 'sep' });
  out.push({ kind: 'row', label: 'Debía', value: formatSoles(abono.previousBalanceCents) });
  out.push({ kind: 'row', label: `Abonó (${METHOD_LABELS[abono.method]})`, value: `-${formatSoles(abono.amountCents)}` });
  if (isManualDigital(abono.method, abono.confirmation)) {
    out.push({ kind: 'note', text: `  ${MANUAL_CONFIRMATION_LABEL}` });
    if (abono.reference) out.push({ kind: 'note', text: `  N° de operación ${abono.reference}` });
  }
  out.push({ kind: 'row', label: 'AHORA DEBE', value: formatSoles(abono.balanceCents), strong: true });
  out.push(...footer(business, abono.balanceCents === 0 ? '¡Deuda cancelada! Gracias.' : 'Gracias por su abono.'));
  return out;
}

/** Resumen de caja para el dueño (WhatsApp). Yape y Plin son lo que el comerciante confirmó. */
export function internalCashTicket(cash: CashSummary, business: TicketBusiness, now: Date = new Date()): TicketLine[] {
  const methods: PaymentMethod[] = ['CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD', 'FIADO'];
  const out: TicketLine[] = [{ kind: 'title', text: business.name }];
  out.push({ kind: 'center', text: cash.closedAt ? 'CIERRE DE CAJA' : 'CAJA (HASTA AHORA)', bold: true });
  out.push({ kind: 'note', text: `Abrió: ${cash.openedBy} ${formatLimaDate(cash.openedAt)}` });
  out.push({ kind: 'note', text: cash.closedAt ? `Cerró: ${formatLimaDate(cash.closedAt)}` : `Al: ${formatLimaDate(now.toISOString())}` });
  out.push({ kind: 'sep' }, { kind: 'note', text: `Ventas (${cash.salesCount}):` });
  for (const m of methods.filter((x) => cash.byMethod[x])) {
    out.push({ kind: 'row', label: METHOD_LABELS[m], value: formatSoles(cash.byMethod[m]!), indent: true });
  }
  const abonos = methods.filter((m) => cash.abonosByMethod[m]);
  if (abonos.length) {
    out.push({ kind: 'note', text: 'Abonos cobrados:' });
    for (const m of abonos) out.push({ kind: 'row', label: METHOD_LABELS[m], value: formatSoles(cash.abonosByMethod[m]!), indent: true });
  }
  if (cash.byMethod.YAPE || cash.byMethod.PLIN || cash.abonosByMethod.YAPE || cash.abonosByMethod.PLIN) {
    out.push({ kind: 'note', text: `Yape y Plin: ${MANUAL_CONFIRMATION_LABEL.toLowerCase()}.` });
  }
  out.push({ kind: 'sep' }, { kind: 'note', text: 'Efectivo en el cajón:' });
  out.push({ kind: 'row', label: 'Apertura', value: formatSoles(cash.openingCents), indent: true });
  out.push({ kind: 'row', label: 'Ventas en efectivo', value: formatSoles(cash.cashSalesCents), indent: true });
  if (cash.digitalChangeCents) out.push({ kind: 'row', label: 'Vuelto de yapeos', value: `-${formatSoles(cash.digitalChangeCents)}`, indent: true });
  if (cash.cashAbonosCents) out.push({ kind: 'row', label: 'Abonos en efectivo', value: formatSoles(cash.cashAbonosCents), indent: true });
  if (cash.inCents) out.push({ kind: 'row', label: 'Metiste', value: formatSoles(cash.inCents), indent: true });
  if (cash.outCents) out.push({ kind: 'row', label: 'Sacaste', value: `-${formatSoles(cash.outCents)}`, indent: true });
  out.push({ kind: 'row', label: 'DEBE HABER', value: formatSoles(cash.expectedCents), strong: true });
  if (cash.countedCents !== null) {
    out.push({ kind: 'row', label: 'Contado', value: formatSoles(cash.countedCents) });
    if (cash.transferredCents) out.push({ kind: 'row', label: 'Yapeado al dueño', value: formatSoles(cash.transferredCents) });
    const diff = cash.differenceCents ?? 0;
    out.push({ kind: 'row', label: diff === 0 ? 'CUADRA' : diff > 0 ? 'SOBRA' : 'FALTA', value: formatSoles(Math.abs(diff)), strong: true });
  }
  return out;
}

// ---------- dibujar ----------

function wrap(text: string, width: number, indent = ''): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if ((indent + next).length > width && current) {
      lines.push(indent + current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(indent + current);
  return lines;
}

function center(text: string, width: number): string[] {
  return wrap(text, width).map((l) => ' '.repeat(Math.max(0, Math.floor((width - l.length) / 2))) + l);
}

/** Texto para ticketera de 58 mm (32 columnas) u 80 mm (42/48) y para WhatsApp. */
export function ticketText(lines: TicketLine[], width: 32 | 42 | 48 = 32): string {
  const out: string[] = [];
  for (const l of lines) {
    switch (l.kind) {
      case 'title':
      case 'center':
        out.push(...center(l.text, width));
        break;
      case 'sep':
        out.push('-'.repeat(width));
        break;
      case 'note': {
        const indent = l.text.match(/^\s*/)?.[0] ?? '';
        out.push(...wrap(l.text, width, indent));
        break;
      }
      case 'row': {
        const label = (l.indent ? '  ' : '') + l.label;
        const space = width - l.value.length;
        const cut = label.length > space - 1 ? label.slice(0, space - 1) : label;
        out.push(cut + ' '.repeat(Math.max(1, space - cut.length)) + l.value);
        break;
      }
    }
  }
  return out.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML para imprimir (80 mm) o guardar como PDF. */
export function ticketHtml(lines: TicketLine[]): string {
  const body = lines
    .map((l) => {
      switch (l.kind) {
        case 'title':
          return `<h1>${esc(l.text)}</h1>`;
        case 'center':
          return `<div class="c">${l.bold ? `<b>${esc(l.text)}</b>` : esc(l.text)}</div>`;
        case 'sep':
          return '<hr>';
        case 'note':
          return `<div class="${l.text.startsWith(' ') ? 'n i' : 'n'}">${esc(l.text.trim())}</div>`;
        case 'row':
          return `<div class="row${l.strong ? ' s' : ''}${l.indent ? ' i' : ''}"><span>${esc(l.label)}</span><span>${esc(l.value)}</span></div>`;
      }
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: -apple-system, Roboto, Arial, sans-serif; font-size: 12px; color: #000; width: 72mm; margin: 0 auto; }
  h1 { font-size: 16px; margin: 0; text-align: center; } .c { text-align: center; } .i { padding-left: 10px; }
  .row { display: flex; justify-content: space-between; gap: 8px; } .row span:last-child { white-space: nowrap; }
  .s { font-size: 15px; font-weight: 800; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
</style></head><body>
${body}
</body></html>`;
}
