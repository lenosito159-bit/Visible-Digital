import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PaymentInput, SaleInput } from '../src/index.js';
import {
  type Actor,
  type LocalDb,
  backupSummary,
  createBackup,
  currentCash,
  encryptBackup,
  getCustomer,
  listCustomers,
  listProducts,
  listSales,
  migrateLocal,
  openBackup,
  openCash,
  peekBackup,
  recordAbono,
  recordSale,
  restoreBackup,
  setupDemo,
  unlock,
  updateProduct,
} from '../src/local/index.js';
import { nodeCrypto as c, nodeLocalDb } from './node-local-db.js';

/**
 * La parte A de PRUEBA-APK.md, paso a paso, con la demostración. Si un número
 * de la guía no coincide con lo que hace la app, este test falla.
 */
describe('PRUEBA-APK.md, parte A (demostración)', () => {
  it('los números de la guía: caja S/ 132.30, stock, deudas, numeración y foto tras recuperar', async () => {
    const phone = nodeLocalDb();
    await migrateLocal(phone);
    const { owner } = await setupDemo(phone, c);
    const actor: Actor = { id: owner.id, name: owner.name, role: 'ADMIN' };
    const byName = async (db: LocalDb, name: string) => (await listProducts(db)).find((p) => p.name === name)!;
    const customer = async (db: LocalDb, name: string) => (await listCustomers(db)).find((x) => x.name.startsWith(name))!;
    const p = {
      // Los nombres exactos que la guía le pide buscar al comerciante.
      pilsen: await byName(phone, 'Cerveza Pilsen Callao 630 ml'),
      inca: await byName(phone, 'Inca Kola 1.5 L'),
      coca: await byName(phone, 'Coca-Cola 500 ml'),
      aceite: await byName(phone, 'Aceite vegetal Primor 900 ml'),
      leche: await byName(phone, 'Leche evaporada Gloria 400 g'),
      pan: await byName(phone, 'Pan francés (unidad)'),
    };
    const item = (prod: { id: string; priceCents: number }, quantity: number) => ({ productId: prod.id, quantity, unitPriceCents: prod.priceCents });
    const yape = (amountCents: number, extra: Partial<PaymentInput> = {}): PaymentInput => ({ method: 'YAPE', amountCents, confirmation: 'MANUAL', ...extra });
    const sell = (items: SaleInput['items'], payments: PaymentInput[], customerId: string | null = null) =>
      recordSale(phone, c, { id: randomUUID(), createdAt: '', items, payments, discountCents: 0, customerId, docType: 'TICKET' }, actor);
    const items50 = [item(p.pilsen, 4), item(p.inca, 2), item(p.coca, 2)];

    // Paso 2: caja con S/ 100.
    await openCash(phone, c, actor, 10000);
    // Paso 3 (a): 20 en efectivo entregando 50 + Yape 30 con operación 123456.
    const a = await sell(items50, [{ method: 'CASH', amountCents: 2000, tenderedCents: 5000 }, yape(3000, { reference: '123456' })]);
    expect(a.sale.changeCents).toBe(3000);
    // Paso 4 (b): 10 (entrega 20) + Yape 20 + Fiado 20 a Pedro Castillo.
    const pedro = await customer(phone, 'Pedro');
    const b = await sell(items50, [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000), { method: 'FIADO', amountCents: 2000 }], pedro.id);
    expect(b.sale.changeCents).toBe(1000);
    // Paso 5 (c): S/ 32 con Yape de 40.
    const cc = await sell([item(p.aceite, 2), item(p.leche, 2), item(p.pan, 4)], [yape(3200, { tenderedCents: 4000 })]);
    expect(cc.sale.totalCents).toBe(3200);
    expect(cc.sale.changeCents).toBe(800);
    // Paso 6: el mismo N° de operación se rechaza.
    await expect(sell([item(p.pan, 1)], [yape(30, { reference: '123456' })])).rejects.toMatchObject({ code: 'OPERACION_YA_USADA' });
    // Paso 7: 1 Pan en efectivo, doble toque (mismo id).
    const pan: SaleInput = { id: randomUUID(), createdAt: '', items: [item(p.pan, 1)], payments: [{ method: 'CASH', amountCents: 30 }], discountCents: 0, customerId: null, docType: 'TICKET' };
    await recordSale(phone, c, pan, actor);
    expect((await recordSale(phone, c, pan, actor)).created).toBe(false);
    // Pasos 8 y 9: abonos.
    await recordAbono(phone, c, { id: randomUUID(), customerId: pedro.id, amountCents: 500, method: 'YAPE', confirmation: 'MANUAL', createdAt: '' }, actor);
    const juan = await customer(phone, 'Juan');
    await recordAbono(phone, c, { id: randomUUID(), customerId: juan.id, amountCents: 1000, method: 'CASH', createdAt: '' }, actor);

    // Paso 10: caja = 100 + 20 + 10 + 0.30 − 8 + 10 = 132.30.
    const cash = (await currentCash(phone))!;
    expect(cash).toMatchObject({ openingCents: 10000, cashSalesCents: 3030, digitalChangeCents: 800, cashAbonosCents: 1000, expectedCents: 13230 });
    // Sin los dos movimientos nuevos (pan + abono de Juan) sería 122, como en la guía anterior.
    expect(cash.expectedCents - 30 - 1000).toBe(12200);

    // Paso 11: stock.
    const stock = async (db: LocalDb) =>
      Object.fromEntries(await Promise.all(Object.entries(p).map(async ([k, prod]) => [k, (await byName(db, prod.name))!.stock])));
    const expectedStock = { pilsen: 16, inca: 16, coca: 44, aceite: 16, leche: 46, pan: 145 };
    expect(await stock(phone)).toEqual(expectedStock);
    // Paso 11b: foto del Aceite (en el celular la guarda keepPhoto en .../fotos/).
    await updateProduct(phone, actor, p.aceite.id, { imageUrl: 'file:///data/user/0/pe.perupos.app/files/fotos/aceite-1.jpg' });

    // Paso 12: copia con contraseña (la foto va dentro, en base64).
    const backup = await createBackup(phone, c, { 'aceite-1.jpg': Buffer.from('foto del aceite').toString('base64') });
    const file = JSON.stringify(await encryptBackup(backup, 'prueba demo 2026', c));
    // Paso 14: comprobar antes de desinstalar (equivocada y correcta).
    await expect(openBackup(c, file, 'prueba demo 2025')).rejects.toMatchObject({ code: 'CONTRASENA_INCORRECTA' });
    expect(backupSummary(await openBackup(c, file, 'prueba demo 2026'))).toMatchObject({ sales: 4, products: 20, customers: 3, photos: 1 });
    phone.close();

    // Pasos 16–18: celular recién instalado; se ve el negocio antes de la contraseña.
    const fresh = nodeLocalDb();
    await migrateLocal(fresh);
    expect(peekBackup(file)).toMatchObject({ businessName: 'Bodega de demostración', isDemo: true, encrypted: true });
    const opened = await openBackup(c, file, 'prueba demo 2026');
    // Lo que hace la app con las fotos: escribirlas en la carpeta del celular nuevo y corregir la ruta.
    const newUri = 'file:///data/user/0/pe.perupos.app/files/fotos/aceite-1.jpg';
    for (const prod of opened.tables.products) if (String(prod.image_url ?? '').includes('/fotos/')) prod.image_url = newUri;
    await restoreBackup(fresh, opened);

    // Paso 19: todo igual.
    expect((await unlock(fresh, c, owner.id, '1234')).ok).toBe(true);
    expect((await listSales(fresh)).length).toBe(4);
    expect((await getCustomer(fresh, pedro.id))!.balanceCents).toBe(1500);
    expect((await getCustomer(fresh, juan.id))!.balanceCents).toBe(3500);
    expect((await customer(fresh, 'María')).balanceCents).toBe(4600);
    expect((await currentCash(fresh))!.expectedCents).toBe(13230);
    expect(await stock(fresh)).toEqual(expectedStock);
    expect((await byName(fresh, 'Aceite vegetal Primor 900 ml')).imageUrl).toBe(newUri);
    expect(opened.photos['aceite-1.jpg']).toBe(Buffer.from('foto del aceite').toString('base64'));
    // Paso 20: la numeración sigue (Venta N° 000005).
    const next = await recordSale(fresh, c, { id: randomUUID(), createdAt: '', items: [item(p.pan, 1)], payments: [{ method: 'CASH', amountCents: 30 }], discountCents: 0, customerId: null, docType: 'TICKET' }, actor);
    expect(next.sale.number).toBe(5);
    // Paso 21: el N° de operación 123456 sigue bloqueado.
    await expect(
      recordSale(fresh, c, { id: randomUUID(), createdAt: '', items: [item(p.pan, 1)], payments: [yape(30, { reference: '123456' })], discountCents: 0, customerId: null, docType: 'TICKET' }, actor),
    ).rejects.toMatchObject({ code: 'OPERACION_YA_USADA' });
    fresh.close();
  });
});
