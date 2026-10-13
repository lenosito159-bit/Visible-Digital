import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PaymentInput, SaleInput } from '../src/index.js';
import {
  type Actor,
  type LocalDb,
  addHelper,
  backupReminder,
  backupSummary,
  createBackup,
  createCustomer,
  createProduct,
  currentCash,
  daySummary,
  getBusiness,
  getCustomer,
  getLedger,
  getProduct,
  getSale,
  listLocalUsers,
  listProducts,
  listSales,
  markBackupVerified,
  migrateLocal,
  openCash,
  readBackup,
  recordAbono,
  recordSale,
  resetOwnerPin,
  restoreBackup,
  setupBusiness,
  setupDemo,
  unlock,
} from '../src/local/index.js';
import { nodeCrypto as c, nodeLocalDb } from './node-local-db.js';

type TestDb = ReturnType<typeof nodeLocalDb>;
let dir: string;
let phoneA: TestDb;
let owner: Actor;
let recoveryCode: string;
let ids: { aceite: string; pan: string; pilsen: string; juan: string; firstSale: string };

const yape = (amountCents: number, extra: Partial<PaymentInput> = {}): PaymentInput => ({ method: 'YAPE', amountCents, confirmation: 'MANUAL', ...extra });
const sale = (items: SaleInput['items'], payments: PaymentInput[], customerId: string | null = null): SaleInput => ({
  id: randomUUID(), createdAt: '', items, payments, discountCents: 0, customerId, docType: 'TICKET',
});

/** Un negocio con de todo: productos, los 3 cobros, fiado, abono, caja abierta y un ayudante. */
async function fillBusiness(db: LocalDb) {
  await migrateLocal(db);
  const setup = await setupBusiness(db, c, { businessName: 'Bodega Rosita', ownerName: 'Rosa', pin: '2580', phone: '987654321' });
  owner = { id: setup.owner.id, name: 'Rosa', role: 'ADMIN' };
  recoveryCode = setup.recoveryCode;
  await addHelper(db, c, { name: 'Pepe', pin: '1357' });
  const aceite = await createProduct(db, c, owner, { name: 'Aceite Primor', priceCents: 1090, stock: 18, costCents: 930, imageUrl: 'file:///viejo/celular/fotos/aceite.jpg' });
  const pan = await createProduct(db, c, owner, { name: 'Pan francés', priceCents: 30, stock: 150 });
  const pilsen = await createProduct(db, c, owner, { name: 'Pilsen', priceCents: 750, stock: 24 });
  const juan = await createCustomer(db, c, owner, { name: 'Juan', creditLimitCents: 10000 });
  await openCash(db, c, owner, 10000);
  const a = await recordSale(db, c, sale([{ productId: pilsen.id, quantity: 4, unitPriceCents: 750 }], [{ method: 'CASH', amountCents: 1000, tenderedCents: 2000 }, yape(2000, { reference: '123456' })]), owner);
  await recordSale(db, c, sale([{ productId: pilsen.id, quantity: 4, unitPriceCents: 750 }], [{ method: 'CASH', amountCents: 1000 }, yape(1000), { method: 'FIADO', amountCents: 1000 }], juan.id), owner);
  await recordSale(db, c, sale([{ productId: aceite.id, quantity: 2, unitPriceCents: 1090 }, { productId: pan.id, quantity: 4, unitPriceCents: 30 }, { productId: pan.id, quantity: 30, unitPriceCents: 30 }], [yape(3200, { tenderedCents: 4000 })]), owner);
  await recordAbono(db, c, { id: randomUUID(), customerId: juan.id, amountCents: 400, method: 'CASH', createdAt: '' }, owner);
  ids = { aceite: aceite.id, pan: pan.id, pilsen: pilsen.id, juan: juan.id, firstSale: a.sale.id };
}

/** Lo que el comerciante vería en el celular (para comparar antes y después). */
async function snapshot(db: LocalDb) {
  return {
    business: await getBusiness(db),
    users: await listLocalUsers(db),
    products: await listProducts(db, { includeInactive: true }),
    sales: await listSales(db),
    juan: await getCustomer(db, ids.juan),
    ledger: await getLedger(db, ids.juan),
    cash: await currentCash(db),
    day: await daySummary(db),
  };
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'perupos-copia-'));
  phoneA = nodeLocalDb(join(dir, 'celular-a.db'));
  await fillBusiness(phoneA);
});
afterEach(() => {
  phoneA.close();
  rmSync(dir, { recursive: true, force: true });
});

async function freshPhone(name = 'celular-b.db') {
  const db = nodeLocalDb(join(dir, name));
  await migrateLocal(db);
  return db;
}

describe('copia de seguridad y recuperación en otro celular', () => {
  it('se recupera TODO: negocio, PIN, código de recuperación, ventas, stock, deudas, cuaderno y caja', async () => {
    const before = await snapshot(phoneA);
    const backup = await createBackup(phoneA, c, { 'aceite.jpg': Buffer.from('foto').toString('base64') });
    const file = join(dir, 'perupos-copia.json');
    writeFileSync(file, JSON.stringify(backup));

    // Se perdió el celular: en uno nuevo se instala la app y se elige el archivo.
    const phoneB = await freshPhone();
    const read = await readBackup(c, readFileSync(file, 'utf8'));
    expect(backupSummary(read)).toMatchObject({ businessName: 'Bodega Rosita', sales: 3, products: 3, customers: 1, photos: 1, isDemo: false });
    expect(read.photos['aceite.jpg']).toBe(Buffer.from('foto').toString('base64'));
    await restoreBackup(phoneB, read);

    const after = await snapshot(phoneB);
    expect(after.products).toEqual(before.products);
    expect(after.sales).toEqual(before.sales);
    expect(after.juan).toEqual(before.juan);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.cash).toEqual(before.cash);
    expect(after.day).toEqual(before.day);
    expect(after.users).toEqual(before.users);
    expect(after.business?.lastBackupAt).toBe(backup.createdAt);
    expect(after.juan?.balanceCents).toBe(600);
    expect((await getProduct(phoneB, ids.pilsen))!.stock).toBe(16);
    expect((await getSale(phoneB, ids.firstSale))!.payments[1]).toMatchObject({ method: 'YAPE', confirmation: 'MANUAL', reference: '123456' });

    // Se entra con el mismo PIN, y el código de recuperación sigue sirviendo.
    expect((await unlock(phoneB, c, owner.id, '2580')).ok).toBe(true);
    const pepe = after.users.find((u) => u.name === 'Pepe')!;
    expect((await unlock(phoneB, c, pepe.id, '1357')).ok).toBe(true);
    await resetOwnerPin(phoneB, c, recoveryCode, '9999');
    expect((await unlock(phoneB, c, owner.id, '9999')).ok).toBe(true);

    // Se sigue vendiendo: el N° de venta continúa y el N° de operación usado sigue bloqueado.
    const next = await recordSale(phoneB, c, sale([{ productId: ids.pan, quantity: 1, unitPriceCents: 30 }], [{ method: 'CASH', amountCents: 30 }]), owner);
    expect(next.sale.number).toBe(4);
    await expect(
      recordSale(phoneB, c, sale([{ productId: ids.pan, quantity: 1, unitPriceCents: 30 }], [yape(30, { reference: '123456' })]), owner),
    ).rejects.toMatchObject({ code: 'OPERACION_YA_USADA' });
    phoneB.close();
  });

  it('recuperar encima de otro negocio lo reemplaza entero (no quedan restos)', async () => {
    const backup = await createBackup(phoneA, c);
    const phoneB = await freshPhone();
    await setupDemo(phoneB, c);
    expect((await listProducts(phoneB)).length).toBe(20);
    await restoreBackup(phoneB, await readBackup(c, JSON.stringify(backup)));
    expect((await getBusiness(phoneB))!.name).toBe('Bodega Rosita');
    expect((await listProducts(phoneB)).map((p) => p.name).sort()).toEqual(['Aceite Primor', 'Pan francés', 'Pilsen']);
    expect((await phoneB.get<{ n: number }>('SELECT COUNT(*) AS n FROM customers'))!.n).toBe(1);
    expect((await listLocalUsers(phoneB)).map((u) => u.name)).toEqual(['Rosa', 'Pepe']);
    phoneB.close();
  });
});

describe('archivos que no se deben restaurar', () => {
  it('dañado, incompleto, de otra app o de una versión más nueva: se rechaza con un mensaje claro', async () => {
    const backup = await createBackup(phoneA, c);
    const text = JSON.stringify(backup);

    // Alguien editó una deuda en el archivo.
    const edited = JSON.parse(text);
    edited.tables.customers[0].balance_cents = 0;
    await expect(readBackup(c, JSON.stringify(edited))).rejects.toMatchObject({ code: 'COPIA_DANADA' });
    // Se cortó al descargar.
    await expect(readBackup(c, text.slice(0, text.length / 2))).rejects.toMatchObject({ code: 'NO_ES_COPIA' });
    // Otro archivo cualquiera.
    await expect(readBackup(c, '{"hola": 1}')).rejects.toMatchObject({ code: 'NO_ES_COPIA' });
    await expect(readBackup(c, 'foto.jpg')).rejects.toMatchObject({ code: 'NO_ES_COPIA' });
    // De una versión futura de la app.
    await expect(readBackup(c, JSON.stringify({ ...backup, schemaVersion: 99 }))).rejects.toMatchObject({ code: 'COPIA_MAS_NUEVA' });
    // Una foto cambiada también se detecta.
    const photo = await createBackup(phoneA, c, { 'a.jpg': 'QUJD' });
    await expect(readBackup(c, JSON.stringify({ ...photo, photos: { 'a.jpg': 'WFla' } }))).rejects.toMatchObject({ code: 'COPIA_DANADA' });
  });

  it('si la restauración falla a la mitad, el celular queda exactamente como estaba', async () => {
    const backup = await readBackup(c, JSON.stringify(await createBackup(phoneA, c)));
    const phoneB = await freshPhone();
    await setupBusiness(phoneB, c, { businessName: 'Bodega Nueva', ownerName: 'Ana', pin: '1111' });
    await createProduct(phoneB, c, { id: (await listLocalUsers(phoneB))[0]!.id, name: 'Ana', role: 'ADMIN' }, { name: 'Galleta', priceCents: 80, stock: 5 });
    const before = await phoneB.all('SELECT * FROM products');

    // Se apaga el celular justo cuando ya se borró lo anterior y se estaban copiando las ventas.
    const broken: LocalDb = {
      ...phoneB,
      exec: phoneB.exec,
      get: phoneB.get,
      all: phoneB.all,
      transaction: phoneB.transaction,
      async run(sql, ...params) {
        if (/INSERT INTO sales /.test(sql)) throw new Error('Se apagó el celular');
        return phoneB.run(sql, ...params);
      },
    };
    await expect(restoreBackup(broken, backup)).rejects.toThrow('Se apagó');
    expect((await getBusiness(phoneB))!.name).toBe('Bodega Nueva');
    expect(await phoneB.all('SELECT * FROM products')).toEqual(before);
    expect((await phoneB.get<{ n: number }>('SELECT COUNT(*) AS n FROM sales'))!.n).toBe(0);
    // Y luego se puede restaurar bien.
    await restoreBackup(phoneB, backup);
    expect((await getBusiness(phoneB))!.name).toBe('Bodega Rosita');
    phoneB.close();
  });
});

describe('recordatorio de copia', () => {
  it('avisa si nunca se hizo copia o si pasó una semana; no molesta en la demostración', async () => {
    const now = new Date();
    expect(await backupReminder(phoneA, now)).toContain('Todavía no tienes una copia');
    await markBackupVerified(phoneA, now.toISOString(), now);
    expect(await backupReminder(phoneA, now)).toBeNull();
    expect(await backupReminder(phoneA, new Date(now.getTime() + 8 * 86_400_000))).toContain('hace 8 días');
    const demo = await freshPhone('demo.db');
    await setupDemo(demo, c);
    expect(await backupReminder(demo)).toBeNull();
    demo.close();
  });
});
