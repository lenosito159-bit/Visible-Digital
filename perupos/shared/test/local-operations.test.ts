import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentInput, Product, SaleInput } from '../src/index.js';
import {
  type Actor,
  type LocalDb,
  addCashMovement,
  addHelper,
  adjustStock,
  closeCash,
  createCustomer,
  createProduct,
  currentCash,
  daySummary,
  endDemo,
  getBusiness,
  getCustomer,
  getLedger,
  getProduct,
  getSale,
  listProducts,
  listSales,
  migrateLocal,
  openCash,
  recentClosures,
  recordAbono,
  recordSale,
  setupBusiness,
  setupDemo,
  stockHistory,
  updateProduct,
  voidSale,
} from '../src/local/index.js';
import { nodeCrypto as c, nodeLocalDb } from './node-local-db.js';

type TestDb = ReturnType<typeof nodeLocalDb>;
let db: TestDb;
let owner: Actor;
let helper: Actor;
let p: Record<'pilsen' | 'inca' | 'coca' | 'primor' | 'leche' | 'pan' | 'papa', Product>;

async function seedBusiness(target: LocalDb) {
  await migrateLocal(target);
  const setup = await setupBusiness(target, c, { businessName: 'Bodega Rosita', ownerName: 'Rosa', pin: '2580' });
  const o: Actor = { id: setup.owner.id, name: 'Rosa', role: 'ADMIN' };
  const h = await addHelper(target, c, { name: 'Pepe', pin: '1357' });
  const mk = (name: string, priceCents: number, stock: number, unit: 'UND' | 'KG' = 'UND') =>
    createProduct(target, c, o, { name, priceCents, stock, unit });
  const products = {
    pilsen: await mk('Cerveza Pilsen 630 ml', 750, 24),
    inca: await mk('Inca Kola 1.5 L', 700, 20),
    coca: await mk('Coca-Cola 500 ml', 300, 48),
    primor: await mk('Aceite Primor 900 ml', 1090, 18),
    leche: await mk('Leche Gloria 400 g', 450, 48),
    pan: await mk('Pan francés', 30, 150),
    papa: await mk('Papa amarilla', 450, 30, 'KG'),
  };
  return { owner: o, helper: { id: h.id, name: 'Pepe', role: 'VENDEDOR' } as Actor, products };
}

beforeEach(async () => {
  db = nodeLocalDb();
  ({ owner, helper, products: p } = await seedBusiness(db));
});
afterEach(() => db.close());

// Pilsen ×4 (30.00) + Inca Kola 1.5 L ×2 (14.00) + Coca-Cola ×2 (6.00) = S/ 50.00
const items50 = () => [
  { productId: p.pilsen.id, quantity: 4, unitPriceCents: 750 },
  { productId: p.inca.id, quantity: 2, unitPriceCents: 700 },
  { productId: p.coca.id, quantity: 2, unitPriceCents: 300 },
];
// Primor ×2 (21.80) + Leche ×2 (9.00) + Pan ×4 (1.20) = S/ 32.00
const items32 = () => [
  { productId: p.primor.id, quantity: 2, unitPriceCents: 1090 },
  { productId: p.leche.id, quantity: 2, unitPriceCents: 450 },
  { productId: p.pan.id, quantity: 4, unitPriceCents: 30 },
];

const sale = (items: SaleInput['items'], payments: PaymentInput[], customerId: string | null = null, discountCents = 0): SaleInput => ({
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  items,
  payments,
  discountCents,
  customerId,
  docType: 'TICKET',
});
const yape = (amountCents: number, extra: Partial<PaymentInput> = {}): PaymentInput => ({
  method: 'YAPE',
  amountCents,
  confirmation: 'MANUAL',
  ...extra,
});
const stock = async (product: Product) => (await getProduct(db, product.id))!.stock;
const balance = async (id: string) => (await getCustomer(db, id))!.balanceCents;
const count = async (table: string) => (await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))!.n;

describe('catálogo e inventario', () => {
  it('un negocio nuevo empieza con el catálogo vacío', async () => {
    const fresh = nodeLocalDb();
    await migrateLocal(fresh);
    await setupBusiness(fresh, c, { businessName: 'Nueva', ownerName: 'Ana', pin: '1111' });
    expect(await listProducts(fresh)).toEqual([]);
    fresh.close();
  });

  it('crea productos con precio y stock, y valida lo básico', async () => {
    expect(p.pilsen).toMatchObject({ priceCents: 750, stock: 24, unit: 'UND' });
    await expect(createProduct(db, c, owner, { name: 'Gaseosa', priceCents: 0 })).rejects.toThrow('precio');
    await expect(createProduct(db, c, owner, { name: 'Gaseosa', priceCents: 200, stock: 1.5 })).rejects.toThrow('sin decimales');
    await createProduct(db, c, owner, { name: 'Galleta Soda', priceCents: 80, barcode: '7750000000001' });
    await expect(createProduct(db, c, owner, { name: 'Otra', priceCents: 80, barcode: '7750000000001' })).rejects.toThrow('Galleta Soda');
    // A granel acepta gramos.
    const azucar = await createProduct(db, c, owner, { name: 'Azúcar', priceCents: 400, stock: 2.5, unit: 'KG' });
    expect(azucar.stock).toBe(2.5);
  });

  it('crear dos veces con el mismo id no duplica', async () => {
    const id = randomUUID();
    await createProduct(db, c, owner, { id, name: 'Chicle', priceCents: 10, stock: 100 });
    await createProduct(db, c, owner, { id, name: 'Chicle', priceCents: 10, stock: 100 });
    expect((await listProducts(db, { search: 'Chicle' })).length).toBe(1);
    expect((await stockHistory(db, id)).length).toBe(1);
  });

  it('llegó mercadería, se cuenta el anaquel y queda el historial', async () => {
    await adjustStock(db, c, owner, p.coca.id, { kind: 'INGRESO', quantity: 24 });
    expect(await stock(p.coca)).toBe(72);
    await adjustStock(db, c, owner, p.coca.id, { kind: 'AJUSTE', countedStock: 70 }, 'Se rompieron 2');
    expect(await stock(p.coca)).toBe(70);
    expect((await stockHistory(db, p.coca.id)).map((m) => `${m.kind}:${m.quantity}`)).toEqual(['AJUSTE:-2', 'INGRESO:24', 'INICIAL:48']);
  });

  it('el ayudante crea productos pero no cambia precios ni stock', async () => {
    await createProduct(db, c, helper, { name: 'Caramelo', priceCents: 10 });
    await expect(updateProduct(db, helper, p.coca.id, { priceCents: 350 })).rejects.toMatchObject({ code: 'SIN_PERMISO' });
    await expect(adjustStock(db, c, helper, p.coca.id, { kind: 'INGRESO', quantity: 1 })).rejects.toMatchObject({ code: 'SIN_PERMISO' });
  });
});

describe('los 3 flujos de cobro', () => {
  it('(a) efectivo + Yape: "te doy 20 en efectivo con un billete de 50 y te yapeo 30"', async () => {
    const input = sale(items50(), [{ method: 'CASH', amountCents: 2000, tenderedCents: 5000 }, yape(3000, { reference: '0012 3456' })]);
    const { sale: s, created } = await recordSale(db, c, input, helper);
    expect(created).toBe(true);
    expect(s).toMatchObject({ number: 1, totalCents: 5000, changeCents: 3000, status: 'COMPLETED', docType: 'TICKET' });
    expect(s.payments).toEqual([
      expect.objectContaining({ method: 'CASH', amountCents: 2000, tenderedCents: 5000, changeCents: 3000, confirmation: null }),
      // Yape queda como confirmado por el comerciante, no como verificado.
      expect.objectContaining({ method: 'YAPE', amountCents: 3000, confirmation: 'MANUAL', chargeId: null, reference: '00123456' }),
    ]);
    expect(await stock(p.pilsen)).toBe(20);
    expect(await stock(p.inca)).toBe(18);
    expect(await stock(p.coca)).toBe(46);
  });

  it('(b) efectivo + Yape + fiado: "10 en efectivo, 20 te yapeo y 20 apúntamelo"', async () => {
    const pedro = await createCustomer(db, c, helper, { name: 'Pedro' });
    const input = sale(
      items50(),
      [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000), { method: 'FIADO', amountCents: 2000 }],
      pedro.id,
    );
    const { sale: s } = await recordSale(db, c, input, helper);
    expect(s.payments.map((x) => `${x.method}:${x.amountCents}`)).toEqual(['CASH:1000', 'YAPE:2000', 'FIADO:2000']);
    expect(s.changeCents).toBe(1000);
    expect(s.customerName).toBe('Pedro');
    expect(await balance(pedro.id)).toBe(2000);
    const ledger = await getLedger(db, pedro.id);
    expect(ledger).toEqual([expect.objectContaining({ kind: 'FIADO', amountCents: 2000, saleId: s.id, balanceAfterCents: 2000 })]);
  });

  it('(c) "te yapeo 40, dame el vuelto": vuelto de 8 en efectivo', async () => {
    const input = sale(items32(), [yape(3200, { tenderedCents: 4000 })]);
    const { sale: s } = await recordSale(db, c, input, helper);
    expect(s.changeCents).toBe(800);
    expect(s.payments[0]).toMatchObject({ method: 'YAPE', amountCents: 3200, tenderedCents: 4000, changeCents: 800, confirmation: 'MANUAL' });
  });

  it('Yape sin confirmar, o marcado como verificado por QR, no se guarda', async () => {
    const pending = sale(items32(), [{ method: 'YAPE', amountCents: 3200 }]);
    await expect(recordSale(db, c, pending, helper)).rejects.toMatchObject({ code: 'FALTA_CONFIRMAR' });
    const qr = sale(items32(), [{ method: 'YAPE', amountCents: 3200, confirmation: 'QR', chargeId: 'x' }]);
    await expect(recordSale(db, c, qr, helper)).rejects.toMatchObject({ code: 'FALTA_CONFIRMAR' });
    expect(await count('sales')).toBe(0);
    expect(await stock(p.primor)).toBe(18);
  });

  it('montos que no cuadran no se guardan', async () => {
    const short = sale(items50(), [{ method: 'CASH', amountCents: 4000 }]);
    await expect(recordSale(db, c, short, helper)).rejects.toThrow('Faltan S/ 10.00');
    const fiadoSinCliente = sale(items50(), [{ method: 'FIADO', amountCents: 5000 }]);
    await expect(recordSale(db, c, fiadoSinCliente, helper)).rejects.toThrow('elige al cliente');
    expect(await count('sales')).toBe(0);
  });
});

describe('reglas de bodega', () => {
  it('el mismo N° de operación de Yape no sirve dos veces (ni en venta ni en abono)', async () => {
    await recordSale(db, c, sale(items32(), [yape(3200, { reference: '987654' })]), helper);
    await expect(recordSale(db, c, sale(items32(), [yape(3200, { reference: '9876 54' })]), helper)).rejects.toMatchObject({
      code: 'OPERACION_YA_USADA',
    });
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    await recordSale(db, c, sale(items50(), [{ method: 'FIADO', amountCents: 5000 }], juan.id), helper);
    await expect(
      recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 1000, method: 'YAPE', confirmation: 'MANUAL', reference: '987654', createdAt: '' }, helper),
    ).rejects.toMatchObject({ code: 'OPERACION_YA_USADA' });
  });

  it('fiado sobre el límite: el ayudante necesita el PIN del dueño', async () => {
    const maria = await createCustomer(db, c, owner, { name: 'María', creditLimitCents: 3000 });
    const input = sale(items50(), [{ method: 'FIADO', amountCents: 5000 }], maria.id);
    await expect(recordSale(db, c, input, helper)).rejects.toMatchObject({ code: 'LIMITE_CREDITO' });
    // Otro ayudante no puede autorizar.
    await expect(recordSale(db, c, input, helper, { authorizedBy: helper.id })).rejects.toMatchObject({ code: 'LIMITE_CREDITO' });
    const { sale: s } = await recordSale(db, c, input, helper, { authorizedBy: owner.id });
    expect(s.totalCents).toBe(5000);
    expect(await balance(maria.id)).toBe(5000);
  });

  it('descuento de más de 10 % del ayudante necesita el PIN del dueño', async () => {
    const input = sale(items50(), [{ method: 'CASH', amountCents: 4000 }], null, 1000);
    await expect(recordSale(db, c, input, helper)).rejects.toMatchObject({ code: 'REQUIERE_AUTORIZACION' });
    const { sale: s } = await recordSale(db, c, input, helper, { authorizedBy: owner.id });
    expect(s).toMatchObject({ subtotalCents: 5000, discountCents: 1000, totalCents: 4000 });
  });

  it('si el dueño cambió el precio, el ayudante debe volver a agregar el producto', async () => {
    await updateProduct(db, owner, p.coca.id, { priceCents: 350 });
    await expect(recordSale(db, c, sale(items50(), [{ method: 'CASH', amountCents: 5000 }]), helper)).rejects.toMatchObject({
      code: 'PRECIO_CAMBIO',
    });
  });

  it('a granel: 1.250 kg de papa', async () => {
    const { sale: s } = await recordSale(
      db, c, sale([{ productId: p.papa.id, quantity: 1.25, unitPriceCents: 450 }], [{ method: 'CASH', amountCents: 563 }]), helper,
    );
    expect(s.totalCents).toBe(563);
    expect(await stock(p.papa)).toBe(28.75);
  });

  it('anular (solo el dueño): vuelve el stock, se descuenta el fiado y el N° de operación queda libre', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    const input = sale(items50(), [yape(2000, { reference: '55556666' }), { method: 'FIADO', amountCents: 3000 }], juan.id);
    const { sale: s } = await recordSale(db, c, input, helper);
    await expect(voidSale(db, c, helper, s.id, 'error')).rejects.toMatchObject({ code: 'SIN_PERMISO' });
    const voided = await voidSale(db, c, owner, s.id, 'Se equivocó de cliente');
    expect(voided.status).toBe('VOIDED');
    expect(await stock(p.pilsen)).toBe(24);
    expect(await balance(juan.id)).toBe(0);
    await expect(voidSale(db, c, owner, s.id, 'otra vez')).rejects.toMatchObject({ code: 'YA_ANULADA' });
    await recordSale(db, c, sale(items32(), [yape(3200, { reference: '55556666' })]), helper);
  });
});

describe('fiados y abonos', () => {
  it('abono parcial por Yape confirmado a mano, con constancia de saldo', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    await recordSale(db, c, sale(items50(), [{ method: 'FIADO', amountCents: 5000 }], juan.id), helper);
    const r = await recordAbono(
      db, c, { id: randomUUID(), customerId: juan.id, amountCents: 2000, method: 'YAPE', confirmation: 'MANUAL', createdAt: '' }, helper,
    );
    expect(r).toMatchObject({ previousBalanceCents: 5000, balanceCents: 3000, method: 'YAPE', confirmation: 'MANUAL', customerName: 'Juan' });
    expect(await balance(juan.id)).toBe(3000);
    expect((await getCustomer(db, juan.id))!.lastPaymentAt).not.toBeNull();
  });

  it('no se abona más de lo que debe, ni a quien no debe, ni Yape sin confirmar', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    const abono = (amountCents: number, extra = {}) =>
      recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents, method: 'CASH', createdAt: '', ...extra }, helper);
    await expect(abono(1000)).rejects.toMatchObject({ code: 'SIN_DEUDA' });
    await recordSale(db, c, sale(items32(), [{ method: 'FIADO', amountCents: 3200 }], juan.id), helper);
    await expect(abono(5000)).rejects.toMatchObject({ code: 'ABONO_MAYOR' });
    await expect(abono(1000, { method: 'PLIN' })).rejects.toMatchObject({ code: 'FALTA_CONFIRMAR' });
    expect(await balance(juan.id)).toBe(3200);
  });

  it('los abonos pagan primero el fiado más antiguo', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 20000 });
    const d1 = new Date('2026-09-01T15:00:00Z');
    const d2 = new Date('2026-09-20T15:00:00Z');
    await recordSale(db, c, sale(items32(), [{ method: 'FIADO', amountCents: 3200 }], juan.id), helper, { now: d1 });
    await recordSale(db, c, sale(items50(), [{ method: 'FIADO', amountCents: 5000 }], juan.id), helper, { now: d2 });
    expect((await getCustomer(db, juan.id))!.oldestDebtAt).toBe(d1.toISOString());
    await recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 3200, method: 'CASH', createdAt: '' }, helper);
    expect((await getCustomer(db, juan.id))!.oldestDebtAt).toBe(d2.toISOString());
  });
});

describe('caja', () => {
  it('cuadra: apertura + efectivo − vuelto de yapeos + abonos en efectivo + ingresos − retiros', async () => {
    await openCash(db, c, helper, 10000);
    await expect(openCash(db, c, helper, 0)).rejects.toMatchObject({ code: 'CAJA_ABIERTA' });
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    // (a) 20 en efectivo + 30 Yape.
    await recordSale(db, c, sale(items50(), [{ method: 'CASH', amountCents: 2000, tenderedCents: 5000 }, yape(3000)]), helper);
    // (b) 10 + 20 Yape + 20 fiado.
    await recordSale(db, c, sale(items50(), [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000), { method: 'FIADO', amountCents: 2000 }], juan.id), helper);
    // (c) yapeó 40 por 32: salen 8 del cajón.
    await recordSale(db, c, sale(items32(), [yape(3200, { tenderedCents: 4000 })]), helper);
    await recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 500, method: 'CASH', createdAt: '' }, helper);
    await addCashMovement(db, c, helper, 'IN', 2000, 'Sencillo');
    await addCashMovement(db, c, owner, 'OUT', 1500, 'Pago al panadero');
    const cash = (await currentCash(db))!;
    expect(cash).toMatchObject({
      openingCents: 10000,
      salesCount: 3,
      cashSalesCents: 3000,
      digitalChangeCents: 800,
      cashAbonosCents: 500,
      inCents: 2000,
      outCents: 1500,
      expectedCents: 10000 + 3000 - 800 + 500 + 2000 - 1500,
    });
    expect(cash.byMethod).toMatchObject({ CASH: 3000, YAPE: 3000 + 2000 + 3200, FIADO: 2000 });

    // Faltan 10 en el cajón, pero le yapeó 10 al dueño.
    const closed = await closeCash(db, helper, 12200, 1000);
    expect(closed).toMatchObject({ expectedCents: 13200, countedCents: 12200, transferredCents: 1000, differenceCents: 0 });
    expect(await currentCash(db)).toBeNull();
    expect((await recentClosures(db))[0]!.sessionId).toBe(cash.sessionId);
    // Una venta después del cierre no cambia el cierre.
    await recordSale(db, c, sale(items32(), [{ method: 'CASH', amountCents: 3200 }]), helper);
    expect((await recentClosures(db))[0]!.expectedCents).toBe(13200);
    await openCash(db, c, helper, 12200);
  });

  it('retiro sin motivo o con caja cerrada no se guarda', async () => {
    await expect(addCashMovement(db, c, helper, 'OUT', 1000, 'algo')).rejects.toMatchObject({ code: 'CAJA_CERRADA' });
    await openCash(db, c, helper, 0);
    await expect(addCashMovement(db, c, helper, 'OUT', 1000, '  ')).rejects.toMatchObject({ code: 'MOTIVO' });
  });
});

describe('sin guardados a medias ni duplicados', () => {
  /** La misma base, pero falla al llegar a cierta sentencia (como si se apagara el celular a la mitad). */
  function failingAt(base: TestDb, pattern: RegExp): LocalDb & { armed: boolean } {
    const wrapper = {
      armed: true,
      exec: base.exec,
      get: base.get,
      all: base.all,
      transaction: base.transaction,
      async run(sql: string, ...params: (string | number | null)[]) {
        if (wrapper.armed && pattern.test(sql)) throw new Error('Se apagó el celular');
        return base.run(sql, ...params);
      },
    };
    return wrapper;
  }

  it('si la venta falla a la mitad no queda nada, y al reintentar se guarda una sola vez', async () => {
    const pedro = await createCustomer(db, c, helper, { name: 'Pedro' });
    const input = sale(
      items50(),
      [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000, { reference: '11112222' }), { method: 'FIADO', amountCents: 2000 }],
      pedro.id,
    );
    // Falla justo al anotar el fiado: ya se habían guardado venta, ítems, stock y pagos.
    const broken = failingAt(db, /INSERT INTO credit_movements/);
    await expect(recordSale(broken, c, input, helper)).rejects.toThrow('Se apagó el celular');
    expect(await count('sales')).toBe(0);
    expect(await count('sale_items')).toBe(0);
    expect(await count('sale_payments')).toBe(0);
    expect(await count('operation_refs')).toBe(0);
    expect(await count("stock_movements WHERE kind = 'VENTA'")).toBe(0);
    expect(await stock(p.pilsen)).toBe(24);
    expect(await balance(pedro.id)).toBe(0);

    // Reintento (el vendedor vuelve a tocar "Cobrar"): se guarda.
    const first = await recordSale(db, c, input, helper);
    expect(first.created).toBe(true);
    // Doble toque: no se duplica.
    const second = await recordSale(db, c, input, helper);
    expect(second).toMatchObject({ created: false, sale: { id: first.sale.id, number: first.sale.number } });
    expect(await count('sales')).toBe(1);
    expect(await stock(p.pilsen)).toBe(20);
    expect(await balance(pedro.id)).toBe(2000);
  });

  it('un abono que falla no descuenta nada, y reintentarlo no descuenta dos veces', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    await recordSale(db, c, sale(items50(), [{ method: 'FIADO', amountCents: 5000 }], juan.id), helper);
    const abono = { id: randomUUID(), customerId: juan.id, amountCents: 2000, method: 'YAPE' as const, confirmation: 'MANUAL' as const, reference: '33334444', createdAt: '' };
    await expect(recordAbono(failingAt(db, /UPDATE customers/), c, abono, helper)).rejects.toThrow('Se apagó');
    expect(await balance(juan.id)).toBe(5000);
    expect(await count("credit_movements WHERE kind = 'ABONO'")).toBe(0);
    expect(await count('operation_refs')).toBe(0);
    await recordAbono(db, c, abono, helper);
    const again = await recordAbono(db, c, abono, helper);
    expect(again.balanceCents).toBe(3000);
    expect(await balance(juan.id)).toBe(3000);
    expect(await count("credit_movements WHERE kind = 'ABONO'")).toBe(1);
  });

  it('un cierre de caja que falla deja la caja abierta como estaba', async () => {
    await openCash(db, c, helper, 5000);
    await expect(closeCash(failingAt(db, /UPDATE cash_sessions/), helper, 5000)).rejects.toThrow('Se apagó');
    expect((await currentCash(db))!.openingCents).toBe(5000);
    await closeCash(db, helper, 5000);
    expect(await currentCash(db)).toBeNull();
  });
});

describe('cerrar y volver a abrir la app', () => {
  it('se conservan ventas, stock, deudas y caja', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'perupos-'));
    const file = join(dir, 'perupos.db');
    try {
      const first = nodeLocalDb(file);
      const seeded = await seedBusiness(first);
      const q = seeded.products;
      const h = seeded.helper;
      const juan = await createCustomer(first, c, seeded.owner, { name: 'Juan', creditLimitCents: 10000 });
      await openCash(first, c, h, 10000);
      const s = (items: SaleInput['items'], payments: PaymentInput[], customerId: string | null = null) =>
        recordSale(first, c, { id: randomUUID(), createdAt: '', items, payments, discountCents: 0, customerId, docType: 'TICKET' }, h);
      const i50 = [
        { productId: q.pilsen.id, quantity: 4, unitPriceCents: 750 },
        { productId: q.inca.id, quantity: 2, unitPriceCents: 700 },
        { productId: q.coca.id, quantity: 2, unitPriceCents: 300 },
      ];
      const a = await s(i50, [{ method: 'CASH', amountCents: 2000, tenderedCents: 5000 }, yape(3000)]);
      await s(i50, [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000), { method: 'FIADO', amountCents: 2000 }], juan.id);
      await s([{ productId: q.primor.id, quantity: 2, unitPriceCents: 1090 }, { productId: q.leche.id, quantity: 2, unitPriceCents: 450 }, { productId: q.pan.id, quantity: 4, unitPriceCents: 30 }], [yape(3200, { tenderedCents: 4000 })]);
      await recordAbono(first, c, { id: randomUUID(), customerId: juan.id, amountCents: 500, method: 'CASH', createdAt: '' }, h);
      const before = (await currentCash(first))!;
      first.close();

      // La app se cierra (o se reinicia el celular) y se vuelve a abrir.
      const again = nodeLocalDb(file);
      await migrateLocal(again);
      expect((await getBusiness(again))!.name).toBe('Bodega Rosita');
      const sales = await listSales(again);
      expect(sales.map((x) => x.number)).toEqual([3, 2, 1]);
      expect((await getSale(again, a.sale.id))!.payments[1]).toMatchObject({ method: 'YAPE', confirmation: 'MANUAL' });
      expect((await getProduct(again, q.pilsen.id))!.stock).toBe(16);
      expect((await getProduct(again, q.primor.id))!.stock).toBe(16);
      expect((await getCustomer(again, juan.id))!.balanceCents).toBe(1500);
      expect((await getLedger(again, juan.id)).map((m) => m.kind)).toEqual(['ABONO', 'FIADO']);
      const after = (await currentCash(again))!;
      expect(after).toEqual(before);
      expect(after.expectedCents).toBe(10000 + 3000 - 800 + 500);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resumen del día', () => {
  it('suma lo vendido hoy (hora de Lima) por método', async () => {
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
    const now = new Date('2026-10-12T20:00:00Z'); // 3 p. m. en Lima
    const yesterday = new Date('2026-10-12T04:30:00Z'); // 11:30 p. m. del día anterior en Lima
    await recordSale(db, c, sale(items32(), [{ method: 'CASH', amountCents: 3200 }]), helper, { now: yesterday });
    await recordSale(db, c, sale(items50(), [{ method: 'CASH', amountCents: 2000 }, yape(1000), { method: 'FIADO', amountCents: 2000 }], juan.id), helper, { now });
    const day = await daySummary(db, now);
    expect(day).toMatchObject({ salesCents: 5000, salesCount: 1, cashCents: 2000, digitalCents: 1000, fiadoCents: 2000 });
    expect((await daySummary(db, now, helper.id)).salesCount).toBe(1);
  });
});

describe('modo demostración', () => {
  it('trae 20 productos y clientes de ejemplo, y se borra entero para empezar el negocio real', async () => {
    const demoDb = nodeLocalDb();
    await migrateLocal(demoDb);
    const { business, pin } = await setupDemo(demoDb, c);
    expect(business.isDemo).toBe(true);
    expect(pin).toBe('1234');
    expect((await listProducts(demoDb)).length).toBe(20);
    expect((await demoDb.get<{ n: number }>('SELECT COUNT(*) AS n FROM customers WHERE balance_cents > 0'))!.n).toBe(2);
    await endDemo(demoDb);
    expect(await getBusiness(demoDb)).toBeNull();
    await setupBusiness(demoDb, c, { businessName: 'Mi bodega', ownerName: 'Ana', pin: '4321' });
    expect(await listProducts(demoDb)).toEqual([]);
    demoDb.close();
  });

  it('nunca borra un negocio real', async () => {
    await expect(endDemo(db)).rejects.toMatchObject({ code: 'NO_ES_DEMO' });
    expect((await listProducts(db)).length).toBe(7);
  });
});
