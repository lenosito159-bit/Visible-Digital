import type { Unit } from '../types.js';
import { getBusiness, insertSetup, prepareSetup, type LocalBusiness, type LocalUser } from './access.js';
import { insertProduct } from './catalog.js';
import { refreshCustomerDebt } from './customers.js';
import { LocalError, type Actor, type LocalCrypto, type LocalDb } from './db.js';

/**
 * Modo demostración: un negocio de ejemplo con 20 productos de bodega y 3
 * clientes, para probar la app sin tocar datos reales. Se borra entero con
 * endDemo() y recién ahí se configura el negocio de verdad.
 */
export const DEMO_PIN = '1234';

/** 20 productos típicos de una bodega limeña, con precios referenciales en soles. */
export const DEMO_PRODUCTS: { name: string; priceCents: number; costCents: number; stock: number; minStock: number; unit?: Unit }[] = [
  { name: 'Arroz extra a granel', priceCents: 450, costCents: 380, stock: 8, minStock: 10, unit: 'KG' },
  { name: 'Azúcar rubia a granel', priceCents: 400, costCents: 330, stock: 25, minStock: 8, unit: 'KG' },
  { name: 'Aceite vegetal Primor 900 ml', priceCents: 1090, costCents: 930, stock: 18, minStock: 6 },
  { name: 'Leche evaporada Gloria 400 g', priceCents: 450, costCents: 385, stock: 48, minStock: 12 },
  { name: 'Fideos spaghetti Don Vittorio 450 g', priceCents: 320, costCents: 260, stock: 30, minStock: 10 },
  { name: 'Atún en trozos Florida 150 g', priceCents: 650, costCents: 540, stock: 24, minStock: 6 },
  { name: 'Huevos de gallina (unidad)', priceCents: 60, costCents: 48, stock: 180, minStock: 60 },
  { name: 'Pan francés (unidad)', priceCents: 30, costCents: 20, stock: 150, minStock: 40 },
  { name: 'Sal yodada Emsal 1 kg', priceCents: 200, costCents: 150, stock: 20, minStock: 5 },
  { name: 'Café instantáneo Altomayo 50 g', priceCents: 990, costCents: 820, stock: 12, minStock: 4 },
  { name: 'Inca Kola 500 ml', priceCents: 300, costCents: 230, stock: 60, minStock: 24 },
  { name: 'Coca-Cola 500 ml', priceCents: 300, costCents: 230, stock: 48, minStock: 24 },
  { name: 'Inca Kola 1.5 L', priceCents: 700, costCents: 560, stock: 20, minStock: 8 },
  { name: 'Agua San Luis sin gas 625 ml', priceCents: 180, costCents: 120, stock: 36, minStock: 12 },
  { name: 'Cerveza Pilsen Callao 630 ml', priceCents: 750, costCents: 600, stock: 24, minStock: 12 },
  { name: 'Detergente Bolívar 460 g', priceCents: 650, costCents: 530, stock: 15, minStock: 5 },
  { name: 'Jabón de ropa Bolívar 190 g', priceCents: 350, costCents: 280, stock: 20, minStock: 6 },
  { name: 'Papel higiénico Suave x4', priceCents: 590, costCents: 480, stock: 16, minStock: 6 },
  { name: 'Lejía Clorox 1 L', priceCents: 420, costCents: 330, stock: 10, minStock: 4 },
  { name: 'Papa amarilla', priceCents: 450, costCents: 350, stock: 30, minStock: 10, unit: 'KG' },
];

const DEMO_CUSTOMERS = [
  { name: 'Juan Pérez', trato: 'DON' as const, phone: '987111222', limit: 10000, debt: 4500, daysAgo: 40 },
  { name: 'María López', trato: 'DONA' as const, phone: '986333444', limit: 5000, debt: 4600, daysAgo: 6 },
  { name: 'Pedro Castillo', trato: 'DON' as const, phone: null, limit: 5000, debt: 0, daysAgo: 0 },
];

/** Tablas del negocio en el celular, de las que dependen a las que no (para borrar en orden). */
export const BUSINESS_TABLES = [
  'cash_movements', 'cash_sessions', 'operation_refs', 'credit_movements', 'sale_payments', 'sale_items',
  'sales', 'stock_movements', 'customers', 'products', 'categories', 'alert_notified', 'local_users', 'business',
] as const;

export async function setupDemo(
  db: LocalDb,
  c: LocalCrypto,
  now: Date = new Date(),
): Promise<{ business: LocalBusiness; owner: LocalUser; pin: string }> {
  const prepared = await prepareSetup(c, { businessName: 'Bodega de demostración', ownerName: 'Dueño de prueba', pin: DEMO_PIN }, now);
  const actor: Actor = { id: prepared.ownerId, name: prepared.ownerName, role: 'ADMIN' };
  const ts = now.toISOString();
  // Todo en una sola transacción: o queda la demostración completa, o nada.
  await db.transaction(async () => {
    await insertSetup(db, prepared);
    await db.run('UPDATE business SET is_demo = 1');
    for (const p of DEMO_PRODUCTS) await insertProduct(db, c, actor, { ...p, id: c.randomUUID() }, ts);
    for (const cu of DEMO_CUSTOMERS) {
      const id = c.randomUUID();
      await db.run(
        `INSERT INTO customers (id, name, phone, photo_url, doc_type, doc_number, credit_limit_cents, balance_cents,
           pending_cents, oldest_debt_at, last_payment_at, active, updated_at, trato, reputation)
         VALUES (?, ?, ?, NULL, 'NONE', NULL, ?, 0, 0, NULL, NULL, 1, ?, ?, NULL)`,
        id, cu.name, cu.phone, cu.limit, ts, cu.trato,
      );
      if (cu.debt > 0) {
        const at = new Date(now.getTime() - cu.daysAgo * 86_400_000).toISOString();
        await db.run(
          `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, note, balance_after_cents, user_id, user_name, created_at)
           VALUES (?, ?, 'FIADO', ?, 'Fiado anterior (ejemplo)', ?, ?, ?, ?)`,
          c.randomUUID(), id, cu.debt, cu.debt, actor.id, actor.name, at,
        );
        await refreshCustomerDebt(db, id, ts);
      }
    }
  });
  const owner: LocalUser = { id: prepared.ownerId, name: prepared.ownerName, role: 'ADMIN', active: true };
  return { business: (await getBusiness(db))!, owner, pin: DEMO_PIN };
}

/** Borra la demostración entera para empezar con el negocio real. Nunca borra un negocio real. */
export async function endDemo(db: LocalDb): Promise<void> {
  const business = await getBusiness(db);
  if (!business) return;
  if (!business.isDemo) throw new LocalError('NO_ES_DEMO', 'Este negocio no es una demostración: no se borra.');
  await db.transaction(async () => {
    for (const table of BUSINESS_TABLES) await db.run(`DELETE FROM ${table}`);
  });
}
