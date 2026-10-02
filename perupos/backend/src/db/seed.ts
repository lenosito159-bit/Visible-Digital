import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { isValidRuc, type PaymentInput, type TaxAffectation, type Unit } from '@perupos/shared';
import { createSale } from '../services/sales.js';
import { migrate } from './migrate.js';
import { many, one, pool } from './pool.js';

/** Código EAN-13 interno (prefijo 200, uso en tienda) con dígito verificador. */
function internalEan(n: number): string {
  const base = `200000000${String(n).padStart(3, '0')}`;
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return base + ((10 - (sum % 10)) % 10);
}

export const CATEGORIES = [
  { name: 'Abarrotes', icon: 'basket' },
  { name: 'Bebidas', icon: 'beer' },
  { name: 'Lácteos', icon: 'water' },
  { name: 'Panadería', icon: 'cafe' },
  { name: 'Verduras', icon: 'leaf' },
  { name: 'Limpieza', icon: 'sparkles' },
  { name: 'Comidas', icon: 'restaurant' },
];

interface SeedProduct {
  name: string;
  category: string;
  priceCents: number;
  costCents: number;
  stock: number;
  minStock: number;
  unit?: Unit;
  tax?: TaxAffectation;
  /** Popularidad relativa para generar el historial de demostración. */
  weight: number;
}

/** 20 productos típicos de una bodega limeña, con precios referenciales en soles. */
export const PRODUCTS: SeedProduct[] = [
  { name: 'Arroz extra a granel', category: 'Abarrotes', priceCents: 450, costCents: 380, stock: 8, minStock: 10, unit: 'KG', weight: 10 },
  { name: 'Azúcar rubia a granel', category: 'Abarrotes', priceCents: 400, costCents: 330, stock: 25, minStock: 8, unit: 'KG', weight: 6 },
  { name: 'Aceite vegetal Primor 900 ml', category: 'Abarrotes', priceCents: 1090, costCents: 930, stock: 18, minStock: 6, weight: 4 },
  { name: 'Leche evaporada Gloria 400 g', category: 'Lácteos', priceCents: 450, costCents: 385, stock: 48, minStock: 12, weight: 8 },
  { name: 'Fideos spaghetti Don Vittorio 450 g', category: 'Abarrotes', priceCents: 320, costCents: 260, stock: 30, minStock: 10, weight: 5 },
  { name: 'Atún en trozos Florida 150 g', category: 'Abarrotes', priceCents: 650, costCents: 540, stock: 24, minStock: 6, weight: 3 },
  { name: 'Huevos de gallina (unidad)', category: 'Abarrotes', priceCents: 60, costCents: 48, stock: 180, minStock: 60, weight: 9 },
  { name: 'Pan francés (unidad)', category: 'Panadería', priceCents: 30, costCents: 20, stock: 150, minStock: 40, weight: 10 },
  { name: 'Sal yodada Emsal 1 kg', category: 'Abarrotes', priceCents: 200, costCents: 150, stock: 20, minStock: 5, weight: 2 },
  { name: 'Café instantáneo Altomayo 50 g', category: 'Abarrotes', priceCents: 990, costCents: 820, stock: 12, minStock: 4, weight: 1 },
  { name: 'Inca Kola 500 ml', category: 'Bebidas', priceCents: 300, costCents: 230, stock: 60, minStock: 24, weight: 9 },
  { name: 'Coca-Cola 500 ml', category: 'Bebidas', priceCents: 300, costCents: 230, stock: 48, minStock: 24, weight: 7 },
  { name: 'Inca Kola 1.5 L', category: 'Bebidas', priceCents: 700, costCents: 560, stock: 20, minStock: 8, weight: 4 },
  { name: 'Agua San Luis sin gas 625 ml', category: 'Bebidas', priceCents: 180, costCents: 120, stock: 36, minStock: 12, weight: 5 },
  { name: 'Cerveza Pilsen Callao 630 ml', category: 'Bebidas', priceCents: 750, costCents: 600, stock: 24, minStock: 12, weight: 4 },
  { name: 'Detergente Bolívar 460 g', category: 'Limpieza', priceCents: 650, costCents: 530, stock: 15, minStock: 5, weight: 2 },
  { name: 'Jabón de ropa Bolívar 190 g', category: 'Limpieza', priceCents: 350, costCents: 280, stock: 20, minStock: 6, weight: 2 },
  { name: 'Papel higiénico Suave x4', category: 'Limpieza', priceCents: 590, costCents: 480, stock: 16, minStock: 6, weight: 3 },
  { name: 'Lejía Clorox 1 L', category: 'Limpieza', priceCents: 420, costCents: 330, stock: 10, minStock: 4, weight: 0 },
  // La papa fresca está exonerada de IGV (Apéndice I de la Ley del IGV).
  { name: 'Papa amarilla', category: 'Verduras', priceCents: 450, costCents: 350, stock: 30, minStock: 10, unit: 'KG', tax: 'EXONERADO', weight: 6 },
];

function env(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

/** PRNG determinista: el historial de demostración sale igual en cada seed. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export async function seed({ demo = false, log = console.log }: { demo?: boolean; log?: (m: string) => void } = {}) {
  await migrate(() => {});

  const ruc = env('BUSINESS_RUC', '20123456786');
  if (!isValidRuc(ruc)) throw new Error(`BUSINESS_RUC=${ruc} no es un RUC válido.`);
  await pool.query(
    `INSERT INTO business_settings (id, ruc, razon_social, nombre_comercial, direccion, ubigeo, phone, tax_regime, yape_plin_enabled)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`,
    [
      ruc,
      env('BUSINESS_RAZON_SOCIAL', 'INVERSIONES DOÑA ROSA E.I.R.L.'),
      env('BUSINESS_NOMBRE_COMERCIAL', 'Bodega Doña Rosa'),
      env('BUSINESS_DIRECCION', 'Jr. Las Magnolias 245, San Juan de Lurigancho, Lima'),
      env('BUSINESS_UBIGEO', '150132'),
      env('BUSINESS_PHONE', '987654321'),
      env('BUSINESS_TAX_REGIME', 'RMT'),
      true,
    ],
  );
  for (const [serie, docType] of [['B001', 'BOLETA'], ['F001', 'FACTURA'], ['T001', 'TICKET_POS']]) {
    await pool.query('INSERT INTO doc_series (serie, doc_type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [serie, docType]);
  }

  const users = [
    { name: 'Rosa Quispe', username: 'admin', role: 'ADMIN', secret: env('SEED_ADMIN_PIN', '1234') },
    { name: 'Carlos Huamán', username: 'carlos', role: 'VENDEDOR', secret: env('SEED_VENDEDOR_PIN', '1111') },
    { name: 'Lucía Torres', username: 'lucia', role: 'AGENTE', secret: env('SEED_AGENTE_PIN', '2222') },
  ];
  for (const u of users) {
    await pool.query(
      'INSERT INTO users (name, username, role, secret_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING',
      [u.name, u.username, u.role, await bcrypt.hash(u.secret, 10)],
    );
  }

  for (const [i, c] of CATEGORIES.entries()) {
    await pool.query('INSERT INTO categories (name, icon, sort_order) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING', [
      c.name,
      c.icon,
      i,
    ]);
  }
  const categoryIds = new Map((await many(pool, 'SELECT id, name FROM categories')).map((c) => [c.name as string, c.id as string]));
  const admin = (await one<{ id: string }>(pool, "SELECT id FROM users WHERE username = 'admin'"))!;

  const alreadySeeded = (await one<{ n: number }>(pool, 'SELECT count(*) AS n FROM products'))!.n > 0;
  if (!alreadySeeded) {
    for (const [i, p] of PRODUCTS.entries()) {
      const row = await one<{ id: string }>(
        pool,
        `INSERT INTO products (barcode, name, category_id, price_cents, cost_cents, stock, min_stock, unit, tax_affectation, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() - interval '60 days') RETURNING id`,
        [
          internalEan(i + 1),
          p.name,
          categoryIds.get(p.category),
          p.priceCents,
          p.costCents,
          demo ? 100000 : p.stock,
          p.minStock,
          p.unit ?? 'UND',
          p.tax ?? 'GRAVADO',
          admin.id,
        ],
      );
      await pool.query(
        "INSERT INTO price_history (product_id, price_cents, changed_by, changed_at) VALUES ($1, $2, $3, now() - interval '60 days')",
        [row!.id, p.priceCents, admin.id],
      );
    }
    log(`${PRODUCTS.length} productos creados.`);

    // Clientes con su saldo pasado del cuaderno de fiados.
    const customers = [
      { name: 'Juan Pérez', trato: 'DON', phone: '987111222', limit: 10000, debt: 4500, daysAgo: 40 },
      { name: 'María López', trato: 'DONA', phone: '986333444', limit: 5000, debt: 4600, daysAgo: 6 },
      { name: 'Señora Carmen (la del 3er piso)', trato: null, phone: null, limit: 8000, debt: 2350, daysAgo: 12 },
      { name: 'Pedro Castillo Ramos', trato: 'DON', phone: '985555666', limit: 5000, debt: 0, daysAgo: 0 },
    ];
    for (const c of customers) {
      const row = await one<{ id: string }>(
        pool,
        `INSERT INTO customers (name, trato, phone, credit_limit_cents, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, now() - interval '90 days') RETURNING id`,
        [c.name, c.trato, c.phone, c.limit, admin.id],
      );
      if (c.debt > 0) {
        await pool.query(
          `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, user_id, note, created_at)
           VALUES ($1, $2, 'FIADO', $3, $4, 'Saldo pasado del cuaderno', now() - make_interval(days => $5))`,
          [randomUUID(), row!.id, c.debt, admin.id, c.daysAgo],
        );
      }
    }
    log(`${customers.length} clientes creados.`);
  }

  if (demo && !alreadySeeded) {
    await seedHistory(log);
    // Deja el stock en valores realistas (algunos bajo el mínimo, para ver alertas).
    for (const p of PRODUCTS) await pool.query('UPDATE products SET stock = $2 WHERE name = $1', [p.name, p.stock]);
  }

  log('Usuarios de prueba: admin / 1234 (Admin) · carlos / 1111 (Vendedor) · lucia / 2222 (Agente).');
  log('Cambia estos PIN desde Admin → Usuarios antes de usar la app en tu tienda.');
}

/** Cuatro semanas de ventas con horarios típicos de bodega (picos en la mañana y la noche). */
async function seedHistory(log: (m: string) => void) {
  const random = rng(20260930);
  const seller = (await one<{ id: string; name: string }>(pool, "SELECT id, name FROM users WHERE username = 'carlos'"))!;
  const products = await many(pool, 'SELECT id, name, price_cents, unit FROM products ORDER BY name');
  const weighted = products.flatMap((p) => {
    const w = PRODUCTS.find((s) => s.name === p.name)?.weight ?? 1;
    return Array.from({ length: w }, () => p);
  });
  const hourWeights = [0, 0, 0, 0, 0, 0, 3, 8, 9, 6, 4, 4, 5, 4, 3, 2, 2, 3, 6, 9, 10, 7, 3, 0];
  const hours = hourWeights.flatMap((w, h) => Array.from({ length: w }, () => h));
  let count = 0;
  for (let daysAgo = 28; daysAgo >= 1; daysAgo--) {
    const date = new Date(Date.now() - daysAgo * 86_400_000);
    const dow = (date.getUTCDay() + 6) % 7;
    // Los fines de semana se vende más; los martes, menos.
    const base = dow >= 5 ? 32 : dow === 1 ? 16 : 24;
    const salesToday = Math.round(base * (0.8 + random() * 0.4));
    for (let s = 0; s < salesToday; s++) {
      const hour = hours[Math.floor(random() * hours.length)]!;
      const lima = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour + 5, Math.floor(random() * 60)));
      const lines = new Map<string, { productId: string; quantity: number; unitPriceCents: number }>();
      const nItems = 1 + Math.floor(random() * 3);
      for (let k = 0; k < nItems; k++) {
        const p = weighted[Math.floor(random() * weighted.length)]!;
        const qty = p.unit === 'KG' ? 1 : 1 + Math.floor(random() * (p.price_cents < 100 ? 8 : 2));
        const prev = lines.get(p.id);
        lines.set(p.id, { productId: p.id, quantity: (prev?.quantity ?? 0) + qty, unitPriceCents: p.price_cents });
      }
      const items = [...lines.values()];
      const total = items.reduce((a, i) => a + Math.round(i.unitPriceCents * i.quantity), 0);
      const r = random();
      const payments: PaymentInput[] =
        r < 0.62
          ? [{ method: 'CASH', amountCents: total, tenderedCents: Math.ceil(total / 1000) * 1000 }]
          : r < 0.84
            ? [{ method: 'YAPE', amountCents: total, confirmation: 'MANUAL' }]
            : r < 0.92
              ? [{ method: 'PLIN', amountCents: total, confirmation: 'MANUAL' }]
              : total > 200
                ? [
                    { method: 'CASH', amountCents: Math.floor(total / 200) * 100 },
                    { method: 'YAPE', amountCents: total - Math.floor(total / 200) * 100, confirmation: 'MANUAL' },
                  ]
                : [{ method: 'CASH', amountCents: total }];
      await createSale(
        { id: seller.id, role: 'VENDEDOR', name: seller.name },
        { id: randomUUID(), createdAt: lima.toISOString(), items, payments, discountCents: 0, customerId: null, docType: 'TICKET' },
      );
      count++;
    }
  }
  await pool.query("DELETE FROM audit_log WHERE action = 'PAGO_DIGITAL_MANUAL'");
  log(`${count} ventas de demostración creadas (últimas 4 semanas).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed({ demo: process.argv.includes('--demo') })
    .then(() => console.log('Seed completo.'))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
