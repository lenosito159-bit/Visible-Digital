/**
 * Asigna imágenes de referencia del dataset PeruFoodNet a los platos preparados
 * que vende el negocio (menú, ceviche, lomo saltado...).
 *
 * PeruFoodNet (Mendeley Data, DOI 10.17632/hxhbbm497d) tiene 4,000 fotos de
 * 40 platos típicos peruanos, una carpeta por plato. NO tiene abarrotes
 * envasados: para arroz, aceite o gaseosas usa la foto que toma el vendedor.
 *
 * Uso:
 *   1. Descarga y descomprime el dataset (revisa su licencia en Mendeley).
 *   2. npm run perufoodnet:import -- --dir /ruta/PeruFoodNet            (asigna fotos)
 *      npm run perufoodnet:import -- --dir /ruta/PeruFoodNet --create   (además crea los platos
 *      en la categoría "Comidas", inactivos y sin precio, para que el Admin los active)
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { config } from '../config.js';
import { many, one, pool } from '../db/pool.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** "lomo_saltado" / "Lomo Saltado" / "lomo-saltado" => "lomo saltado". */
export function normalizeDish(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitle(name: string): string {
  return normalizeDish(name)
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/ (De|Del|Con|Y|A La|Al) /g, (m) => m.toLowerCase());
}

async function firstImage(dir: string): Promise<string | null> {
  const files = (await readdir(dir)).filter((f) => IMAGE_EXT.has(extname(f).toLowerCase())).sort();
  return files[0] ? join(dir, files[0]) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const root = dirIndex >= 0 ? args[dirIndex + 1] : undefined;
  if (!root) throw new Error('Indica la carpeta del dataset: --dir /ruta/PeruFoodNet');
  const create = args.includes('--create');

  const classes = new Map<string, string>();
  for (const entry of await readdir(root)) {
    const full = join(root, entry);
    if ((await stat(full)).isDirectory()) classes.set(normalizeDish(entry), full);
  }
  if (classes.size === 0) throw new Error(`No se encontraron carpetas de platos en ${root}`);
  console.log(`${classes.size} platos en el dataset.`);

  if (create) {
    const category = await one<{ id: string }>(
      pool,
      `INSERT INTO categories (name, icon, sort_order) VALUES ('Comidas', 'restaurant', 99)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    for (const key of classes.keys()) {
      await pool.query(
        `INSERT INTO products (name, category_id, price_cents, active, perufoodnet_class)
         SELECT $1, $2, 0, false, $3 WHERE NOT EXISTS (SELECT 1 FROM products WHERE perufoodnet_class = $3)`,
        [toTitle(key), category!.id, key],
      );
    }
  }

  const products = await many(pool, 'SELECT id, name, perufoodnet_class FROM products WHERE image_url IS NULL');
  const destDir = join(config.UPLOAD_DIR, 'products');
  await mkdir(destDir, { recursive: true });
  let assigned = 0;
  for (const p of products) {
    const key = p.perufoodnet_class ? normalizeDish(p.perufoodnet_class) : normalizeDish(p.name);
    const dir = classes.get(key);
    if (!dir) continue;
    const image = await firstImage(dir);
    if (!image) continue;
    const fileName = `${p.id}-perufoodnet${extname(image).toLowerCase()}`;
    await copyFile(image, join(destDir, fileName));
    await pool.query('UPDATE products SET image_url = $2, perufoodnet_class = $3 WHERE id = $1', [
      p.id,
      `/uploads/products/${fileName}`,
      key,
    ]);
    assigned++;
    console.log(`  ${p.name} ← ${key}`);
  }
  console.log(`${assigned} productos con foto de PeruFoodNet.`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
