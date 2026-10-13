import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentInput, SaleInput } from '../src/index.js';
import {
  type Actor,
  addCashMovement,
  adjustStock,
  computeAlerts,
  createCustomer,
  createProduct,
  migrateLocal,
  openCash,
  periodRange,
  periodReport,
  recordAbono,
  recordSale,
  setupBusiness,
  takeNewAlerts,
  updateBusiness,
  updateProduct,
  voidSale,
} from '../src/local/index.js';
import { nodeCrypto as c, nodeLocalDb } from './node-local-db.js';

let db: ReturnType<typeof nodeLocalDb>;
let owner: Actor;

// Tiempo fijo: lunes 12 de octubre de 2026, 3 p. m. en Lima.
const NOW = new Date('2026-10-12T20:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(async () => {
  db = nodeLocalDb();
  await migrateLocal(db);
  const setup = await setupBusiness(db, c, { businessName: 'Bodega Rosita', ownerName: 'Rosa', pin: '2580' }, daysAgo(90));
  owner = { id: setup.owner.id, name: 'Rosa', role: 'ADMIN' };
});
afterEach(() => db.close());

const product = (name: string, priceCents: number, stock: number, extra: { costCents?: number; minStock?: number } = {}, at = daysAgo(60)) =>
  createProduct(db, c, owner, { name, priceCents, stock, ...extra }, at);
const sell = (items: SaleInput['items'], payments: PaymentInput[], at: Date, customerId: string | null = null) =>
  recordSale(db, c, { id: randomUUID(), createdAt: '', items, payments, discountCents: 0, customerId, docType: 'TICKET' }, owner, { now: at });

describe('periodos en hora de Lima', () => {
  it('hoy, ayer, 7 días, este mes y el mes pasado', () => {
    expect(periodRange('HOY', NOW)).toEqual({ from: '2026-10-12T05:00:00.000Z', to: '2026-10-13T05:00:00.000Z' });
    expect(periodRange('AYER', NOW)).toEqual({ from: '2026-10-11T05:00:00.000Z', to: '2026-10-12T05:00:00.000Z' });
    expect(periodRange('SEMANA', NOW).from).toBe('2026-10-06T05:00:00.000Z');
    expect(periodRange('MES', NOW)).toEqual({ from: '2026-10-01T05:00:00.000Z', to: '2026-10-13T05:00:00.000Z' });
    expect(periodRange('MES_ANTERIOR', NOW)).toEqual({ from: '2026-09-01T05:00:00.000Z', to: '2026-10-01T05:00:00.000Z' });
    // 11:30 p. m. del 31 de diciembre en Lima: el "mes pasado" es noviembre.
    expect(periodRange('MES_ANTERIOR', new Date('2027-01-01T04:30:00Z')).from).toBe('2026-11-01T05:00:00.000Z');
  });
});

describe('informe del periodo', () => {
  it('suma ventas, formas de pago, fiado, abonos, ganancia y lo más vendido; las anuladas no cuentan', async () => {
    const aceite = await product('Aceite Primor', 1090, 50, { costCents: 930 });
    const pan = await product('Pan francés', 30, 500); // sin costo anotado
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 20000 });
    const { from, to } = periodRange('SEMANA', NOW);

    await sell([{ productId: aceite.id, quantity: 2, unitPriceCents: 1090 }], [{ method: 'CASH', amountCents: 2180 }], daysAgo(1));
    await sell(
      [{ productId: aceite.id, quantity: 1, unitPriceCents: 1090 }, { productId: pan.id, quantity: 10, unitPriceCents: 30 }],
      [{ method: 'YAPE', amountCents: 890, confirmation: 'MANUAL' }, { method: 'FIADO', amountCents: 500 }],
      daysAgo(0),
      juan.id,
    );
    const voided = await sell([{ productId: pan.id, quantity: 5, unitPriceCents: 30 }], [{ method: 'CASH', amountCents: 150 }], daysAgo(0));
    await voidSale(db, c, owner, voided.sale.id, 'error', NOW);
    // Fuera del periodo.
    await sell([{ productId: pan.id, quantity: 1, unitPriceCents: 30 }], [{ method: 'CASH', amountCents: 30 }], daysAgo(20));
    await recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 200, method: 'CASH', createdAt: '' }, owner, NOW);

    const r = await periodReport(db, from, to);
    expect(r).toMatchObject({
      salesCount: 2,
      salesCents: 2180 + 1390,
      averageTicketCents: 1785,
      voidedCount: 1,
      fiadoCents: 500,
      abonosCents: 200,
      totalDebtCents: 300,
    });
    expect(r.byMethod).toEqual({ CASH: 2180, YAPE: 890, FIADO: 500 });
    // Aceite: 3 × (10.90 − 9.30) = 4.80 de ganancia; el pan no tiene costo anotado.
    expect(r.margin).toEqual({ cents: 480, coveredSalesCents: 3270, uncoveredSalesCents: 300 });
    expect(r.topProducts.map((t) => `${t.name}:${t.quantity}`)).toEqual(['Aceite Primor:3', 'Pan francés:10']);
    expect(r.byDay).toHaveLength(7);
    expect(r.byDay.at(-1)).toEqual({ day: '2026-10-12', salesCents: 1390, salesCount: 1 });
    expect(r.byDay.at(-2)).toEqual({ day: '2026-10-11', salesCents: 2180, salesCount: 1 });
  });

  it('periodo sin ventas: todo en cero, sin errores', async () => {
    const { from, to } = periodRange('HOY', NOW);
    const r = await periodReport(db, from, to);
    expect(r).toMatchObject({ salesCount: 0, salesCents: 0, averageTicketCents: 0, topProducts: [] });
  });
});

describe('avisos', () => {
  it('stock bajo y agotado; desaparece al reponer', async () => {
    const coca = await product('Coca-Cola', 300, 3, { minStock: 6 });
    const leche = await product('Leche', 450, 0, { minStock: 2 });
    await product('Agua', 180, 40, { minStock: 12 });
    let alerts = await computeAlerts(db, NOW);
    expect(alerts.filter((a) => a.type === 'STOCK_BAJO').map((a) => `${a.severity}:${a.title}`)).toEqual([
      'CRITICAL:Se acabó: Leche',
      'WARNING:Queda poco: Coca-Cola',
    ]);
    await adjustStock(db, c, owner, coca.id, { kind: 'INGRESO', quantity: 24 }, null, NOW);
    await adjustStock(db, c, owner, leche.id, { kind: 'INGRESO', quantity: 12 }, null, NOW);
    alerts = await computeAlerts(db, NOW);
    expect(alerts.filter((a) => a.type === 'STOCK_BAJO')).toEqual([]);
  });

  it('deuda vencida y cerca del límite de fiado', async () => {
    const pan = await product('Pan', 30, 1000);
    const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 1000 });
    const maria = await createCustomer(db, c, owner, { name: 'María', creditLimitCents: 10000 });
    await sell([{ productId: pan.id, quantity: 30, unitPriceCents: 30 }], [{ method: 'FIADO', amountCents: 900 }], daysAgo(40), juan.id);
    await sell([{ productId: pan.id, quantity: 10, unitPriceCents: 30 }], [{ method: 'FIADO', amountCents: 300 }], daysAgo(5), maria.id);
    const alerts = await computeAlerts(db, NOW);
    const juanAlerts = alerts.filter((a) => a.entityId === juan.id).map((a) => a.type).sort();
    expect(juanAlerts).toEqual(['DEUDA_VENCIDA', 'LIMITE_CREDITO']);
    expect(alerts.find((a) => a.type === 'DEUDA_VENCIDA')!.title).toBe('Juan debe hace 40 días');
    expect(alerts.some((a) => a.entityId === maria.id)).toBe(false);
    // Abona y vuelve a contar desde el abono.
    await recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 500, method: 'CASH', createdAt: '' }, owner, NOW);
    expect((await computeAlerts(db, NOW)).some((a) => a.type === 'DEUDA_VENCIDA')).toBe(false);
  });

  it('caja con poco sencillo', async () => {
    await updateBusiness(db, { cashLowThresholdCents: 2000 });
    await openCash(db, c, owner, 5000, daysAgo(0));
    expect((await computeAlerts(db, NOW)).some((a) => a.type === 'CAJA_BAJA')).toBe(false);
    await addCashMovement(db, c, owner, 'OUT', 4000, 'Pago al proveedor', daysAgo(0));
    expect((await computeAlerts(db, NOW)).find((a) => a.type === 'CAJA_BAJA')?.message).toContain('S/ 10.00');
  });

  it('producto sin movimiento: tiene stock y no se vende hace más de 30 días', async () => {
    const lejia = await product('Lejía', 420, 10, {}, daysAgo(60));
    const pan = await product('Pan', 30, 100, {}, daysAgo(60));
    await product('Galleta nueva', 80, 10, {}, daysAgo(3)); // recién creado: no avisa
    await sell([{ productId: pan.id, quantity: 1, unitPriceCents: 30 }], [{ method: 'CASH', amountCents: 30 }], daysAgo(2));
    const stale = (await computeAlerts(db, NOW)).filter((a) => a.type === 'SIN_MOVIMIENTO');
    expect(stale.map((a) => a.entityId)).toEqual([lejia.id]);
    await updateProduct(db, owner, lejia.id, { active: false });
    expect((await computeAlerts(db, NOW)).some((a) => a.type === 'SIN_MOVIMIENTO')).toBe(false);
  });

  it('cada aviso se notifica una sola vez, y otra vez si se resolvió y volvió', async () => {
    // Creada hoy: así no aparece también como "sin movimiento".
    const coca = await product('Coca-Cola', 300, 3, { minStock: 6 }, NOW);
    expect((await takeNewAlerts(db, NOW)).map((a) => a.key)).toEqual([`STOCK_BAJO:${coca.id}`]);
    expect(await takeNewAlerts(db, NOW)).toEqual([]);
    await adjustStock(db, c, owner, coca.id, { kind: 'INGRESO', quantity: 24 }, null, NOW);
    expect(await takeNewAlerts(db, NOW)).toEqual([]);
    await adjustStock(db, c, owner, coca.id, { kind: 'AJUSTE', countedStock: 2 }, null, NOW);
    expect((await takeNewAlerts(db, NOW)).map((a) => a.key)).toEqual([`STOCK_BAJO:${coca.id}`]);
  });
});
