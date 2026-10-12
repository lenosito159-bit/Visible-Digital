import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentInput, SaleInput } from '../src/index.js';
import {
  type Actor,
  type TicketBusiness,
  MANUAL_CONFIRMATION_LABEL,
  closeCash,
  createCustomer,
  createProduct,
  getSale,
  internalAbonoTicket,
  internalCashTicket,
  internalSaleTicket,
  migrateLocal,
  openCash,
  recordAbono,
  recordSale,
  setupBusiness,
  ticketHtml,
  ticketText,
  voidSale,
} from '../src/local/index.js';
import { nodeCrypto as c, nodeLocalDb } from './node-local-db.js';

let db: ReturnType<typeof nodeLocalDb>;
let owner: Actor;
let ids: { pilsen: string; inca: string; coca: string; primor: string; leche: string; pan: string };
const business: TicketBusiness = { name: 'Bodega Rosita', phone: '987654321', receiptFooter: 'Gracias, casero' };

/** Palabras que harían pensar en un comprobante de SUNAT. */
const OFFICIAL = /\bRUC\b|R[ée]gimen|Nuevo RUS|\bRUS\b|IGV|SUNAT|Op\. gravada|Canjeable|Nota de venta|NV-|Representaci[óo]n impresa|\bSON:/i;

beforeEach(async () => {
  db = nodeLocalDb();
  await migrateLocal(db);
  const setup = await setupBusiness(db, c, { businessName: 'Bodega Rosita', ownerName: 'Rosa', pin: '2580', phone: '987654321' });
  owner = { id: setup.owner.id, name: 'Rosa', role: 'ADMIN' };
  const mk = async (name: string, priceCents: number) => (await createProduct(db, c, owner, { name, priceCents, stock: 100 })).id;
  ids = {
    pilsen: await mk('Cerveza Pilsen 630 ml', 750),
    inca: await mk('Inca Kola 1.5 L', 700),
    coca: await mk('Coca-Cola 500 ml', 300),
    primor: await mk('Aceite Primor 900 ml', 1090),
    leche: await mk('Leche Gloria 400 g', 450),
    pan: await mk('Pan francés', 30),
  };
});
afterEach(() => db.close());

const items50 = () => [
  { productId: ids.pilsen, quantity: 4, unitPriceCents: 750 },
  { productId: ids.inca, quantity: 2, unitPriceCents: 700 },
  { productId: ids.coca, quantity: 2, unitPriceCents: 300 },
];
const items32 = () => [
  { productId: ids.primor, quantity: 2, unitPriceCents: 1090 },
  { productId: ids.leche, quantity: 2, unitPriceCents: 450 },
  { productId: ids.pan, quantity: 4, unitPriceCents: 30 },
];
async function sell(items: SaleInput['items'], payments: PaymentInput[], customerId: string | null = null) {
  const { sale } = await recordSale(db, c, { id: randomUUID(), createdAt: '', items, payments, discountCents: 0, customerId, docType: 'TICKET' }, owner);
  return (await getSale(db, sale.id))!;
}
const text = async (saleId: string) => ticketText(internalSaleTicket((await getSale(db, saleId))!, business));
const yape = (amountCents: number, extra: Partial<PaymentInput> = {}): PaymentInput => ({ method: 'YAPE', amountCents, confirmation: 'MANUAL', ...extra });

describe('ticket interno', () => {
  it('(a) efectivo + Yape: total, pagos, Yape confirmado manualmente y vuelto', async () => {
    const s = await sell(items50(), [{ method: 'CASH', amountCents: 2000, tenderedCents: 5000 }, yape(3000, { reference: '00123456' })]);
    const t = await text(s.id);
    expect(t).toContain('COMPROBANTE INTERNO');
    expect(t).toContain('Venta N° 000001');
    expect(t).toMatch(/TOTAL\s+S\/ 50\.00/);
    expect(t).toMatch(/Efectivo\s+S\/ 20\.00/);
    expect(t).toMatch(/Entregó\s+S\/ 50\.00/);
    expect(t).toMatch(/Yape\s+S\/ 30\.00/);
    expect(t.replace(/\s+/g, ' ')).toContain(MANUAL_CONFIRMATION_LABEL);
    expect(t).toContain('N° de operación 00123456');
    expect(t).toMatch(/VUELTO\s+S\/ 30\.00/);
    expect(t).not.toMatch(OFFICIAL);
    expect(t).toContain('No es boleta ni factura.');
  });

  it('(b) efectivo + Yape + fiado: cuánto fió y cuánto debe en total', async () => {
    const pedro = await createCustomer(db, c, owner, { name: 'Pedro Castillo', creditLimitCents: 10000 });
    await sell(items32(), [{ method: 'FIADO', amountCents: 3200 }], pedro.id);
    const s = await sell(items50(), [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000), { method: 'FIADO', amountCents: 2000 }], pedro.id);
    const t = await text(s.id);
    expect(t).toContain('Cliente: Pedro Castillo');
    expect(t).toMatch(/Fiado \(queda debiendo\)\s+S\/ 20\.00/);
    expect(t).toMatch(/VUELTO\s+S\/ 10\.00/);
    const flat = t.replace(/\s+/g, ' ');
    expect(flat).toContain('Pedro queda debiendo S/ 20.00 de esta compra.');
    expect(flat).toContain('Deuda total de Pedro: S/ 52.00.');
    expect(flat).toContain(MANUAL_CONFIRMATION_LABEL);
    expect(t).not.toMatch(OFFICIAL);
  });

  it('(c) "te yapeo 40, dame el vuelto": cuánto yapeó y el vuelto en efectivo', async () => {
    const s = await sell(items32(), [yape(3200, { tenderedCents: 4000 })]);
    const t = await text(s.id);
    expect(t).toMatch(/TOTAL\s+S\/ 32\.00/);
    expect(t).toMatch(/Yape\s+S\/ 32\.00/);
    expect(t).toMatch(/Yapeó\s+S\/ 40\.00/);
    expect(t).toMatch(/VUELTO\s+S\/ 8\.00/);
    expect(t.replace(/\s+/g, ' ')).toContain(MANUAL_CONFIRMATION_LABEL);
    expect(t).not.toMatch(OFFICIAL);
  });

  it('solo efectivo exacto: sin vuelto ni líneas de Yape', async () => {
    const s = await sell(items32(), [{ method: 'CASH', amountCents: 3200 }]);
    const t = await text(s.id);
    expect(t).not.toContain('VUELTO');
    expect(t).not.toContain(MANUAL_CONFIRMATION_LABEL);
    expect(t).not.toContain('FIADO');
  });

  it('una venta anulada lo dice', async () => {
    const s = await sell(items32(), [{ method: 'CASH', amountCents: 3200 }]);
    await voidSale(db, c, owner, s.id, 'error');
    expect(await text(s.id)).toContain('*** VENTA ANULADA ***');
  });

  it('cabe en 32 columnas (ticketera de 58 mm) y el HTML no lleva datos tributarios', async () => {
    const pedro = await createCustomer(db, c, owner, { name: 'Señora Carmen la del tercer piso de la esquina', creditLimitCents: 10000 });
    const s = await sell(items50(), [yape(3000, { tenderedCents: 4000 }), { method: 'FIADO', amountCents: 2000 }], pedro.id);
    const lines = internalSaleTicket((await getSale(db, s.id))!, business);
    for (const line of ticketText(lines, 32).split('\n')) expect(line.length).toBeLessThanOrEqual(32);
    const html = ticketHtml(lines);
    expect(html).toContain('Confirmado manualmente por el comerciante');
    expect(html).toContain('No es boleta ni factura.');
    expect(html).not.toMatch(OFFICIAL);
  });
});

describe('constancia de abono y resumen de caja', () => {
  it('abono por Yape: confirmado manualmente, debía y ahora debe', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    await sell(items50(), [{ method: 'FIADO', amountCents: 5000 }], juan.id);
    const r = await recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 2000, method: 'YAPE', confirmation: 'MANUAL', reference: '777888', createdAt: '' }, owner);
    const t = ticketText(internalAbonoTicket(r, business));
    expect(t).toContain('CONSTANCIA DE ABONO');
    expect(t).toMatch(/Debía\s+S\/ 50\.00/);
    expect(t).toMatch(/Abonó \(Yape\)\s+-S\/ 20\.00/);
    expect(t.replace(/\s+/g, ' ')).toContain(MANUAL_CONFIRMATION_LABEL);
    expect(t).toMatch(/AHORA DEBE\s+S\/ 30\.00/);
    expect(t).not.toMatch(OFFICIAL);
  });

  it('cierre de caja: Yape y Plin aparecen como confirmados por el comerciante', async () => {
    await openCash(db, c, owner, 10000);
    await sell(items32(), [yape(3200, { tenderedCents: 4000 })]);
    const closed = await closeCash(db, owner, 9200);
    const t = ticketText(internalCashTicket(closed, business));
    expect(t).toContain('CIERRE DE CAJA');
    expect(t).toMatch(/Vuelto de yapeos\s+-S\/ 8\.00/);
    expect(t).toMatch(/DEBE HABER\s+S\/ 92\.00/);
    expect(t).toMatch(/CUADRA\s+S\/ 0\.00/);
    expect(t.replace(/\s+/g, ' ').toLowerCase()).toContain(MANUAL_CONFIRMATION_LABEL.toLowerCase());
    expect(t).not.toMatch(OFFICIAL);
  });
});
