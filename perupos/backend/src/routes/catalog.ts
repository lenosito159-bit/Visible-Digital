import { mkdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { can } from '@perupos/shared';
import { config } from '../config.js';
import { audit, many, one, pool, tx } from '../db/pool.js';
import { currentUser, requireAuth, requirePermission } from '../http/auth.js';
import { badRequest, forbidden, notFound, parse } from '../http/errors.js';
import { productEditSchema, productQuickSchema } from '../http/schemas.js';
import { toCategory, toProduct } from '../services/mappers.js';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

const productsDir = join(config.UPLOAD_DIR, 'products');
mkdirSync(productsDir, { recursive: true });

const upload = multer({
  dest: join(config.UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

catalogRouter.get('/categories', requirePermission('products.read'), async (_req, res) => {
  res.json((await many(pool, 'SELECT * FROM categories ORDER BY sort_order, name')).map(toCategory));
});

catalogRouter.post('/categories', requirePermission('products.edit'), async (req, res) => {
  const body = parse(z.object({ name: z.string().trim().min(2).max(40), icon: z.string().max(40).default('pricetag') }), req.body);
  const row = await one(
    pool,
    'INSERT INTO categories (name, icon, sort_order) VALUES ($1, $2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories)) RETURNING *',
    [body.name, body.icon],
  );
  res.status(201).json(toCategory(row!));
});

catalogRouter.get('/products', requirePermission('products.read'), async (req, res) => {
  const q = parse(
    z.object({
      search: z.string().max(60).optional(),
      categoryId: z.uuid().optional(),
      includeInactive: z.enum(['1', '0']).optional(),
    }),
    req.query,
  );
  const params: unknown[] = [];
  const where: string[] = [];
  if (q.includeInactive !== '1') where.push('active');
  if (q.search) {
    const i = params.push(`%${q.search.toLowerCase()}%`);
    where.push(`(lower(name) LIKE $${i} OR barcode LIKE $${i})`);
  }
  if (q.categoryId) where.push(`category_id = $${params.push(q.categoryId)}`);
  const rows = await many(pool, `SELECT * FROM products ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`, params);
  res.json(rows.map(toProduct));
});

catalogRouter.get('/products/barcode/:code', requirePermission('products.read'), async (req, res) => {
  const row = await one(pool, 'SELECT * FROM products WHERE barcode = $1', [req.params.code]);
  if (!row) throw notFound('Producto no registrado.');
  res.json(toProduct(row));
});

/**
 * Alta rápida desde la caja: el vendedor escanea algo que no existe y lo crea
 * con nombre, precio y categoría. El stock y el costo los completa el Admin.
 */
catalogRouter.post('/products', requirePermission('products.quickCreate', 'products.edit'), async (req, res) => {
  const user = currentUser(req);
  const quick = parse(productQuickSchema, req.body);
  // El Admin puede completar además stock, costo, mínimo y afectación al IGV.
  const extra = can(user.role, 'products.edit') ? parse(productEditSchema, req.body) : {};
  const body = { ...extra, ...quick };
  if (body.id) {
    const existing = await one(pool, 'SELECT * FROM products WHERE id = $1', [body.id]);
    if (existing) {
      res.json(toProduct(existing));
      return;
    }
  }
  const row = await tx(async (db) => {
    const created = await one(
      db,
      `INSERT INTO products (id, barcode, name, category_id, price_cents, unit, cost_cents, stock, min_stock, tax_affectation, created_by)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        body.id ?? null,
        body.barcode ?? null,
        body.name,
        body.categoryId ?? null,
        body.priceCents,
        body.unit,
        body.costCents ?? null,
        body.stock ?? 0,
        body.minStock ?? 0,
        body.taxAffectation ?? 'GRAVADO',
        user.id,
      ],
    );
    await db.query('INSERT INTO price_history (product_id, price_cents, changed_by) VALUES ($1, $2, $3)', [
      created!.id,
      body.priceCents,
      user.id,
    ]);
    await audit(db, user.id, 'CREA_PRODUCTO', 'product', created!.id, { name: body.name, priceCents: body.priceCents });
    return created!;
  });
  res.status(201).json(toProduct(row));
});

catalogRouter.patch('/products/:id', requirePermission('products.edit'), async (req, res) => {
  const body = parse(productEditSchema, req.body);
  const user = currentUser(req);
  const row = await tx(async (db) => {
    const before = await one(db, 'SELECT * FROM products WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!before) throw notFound('No se encontró el producto.');
    const updated = await one(
      db,
      `UPDATE products SET
         barcode = CASE WHEN $2::boolean THEN $3 ELSE barcode END,
         name = COALESCE($4, name),
         category_id = CASE WHEN $5::boolean THEN $6::uuid ELSE category_id END,
         price_cents = COALESCE($7, price_cents),
         cost_cents = CASE WHEN $8::boolean THEN $9::int ELSE cost_cents END,
         stock = COALESCE($10, stock),
         min_stock = COALESCE($11, min_stock),
         unit = COALESCE($12, unit),
         tax_affectation = COALESCE($13, tax_affectation),
         active = COALESCE($14, active)
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        body.barcode !== undefined,
        body.barcode ?? null,
        body.name ?? null,
        body.categoryId !== undefined,
        body.categoryId ?? null,
        body.priceCents ?? null,
        body.costCents !== undefined,
        body.costCents ?? null,
        body.stock ?? null,
        body.minStock ?? null,
        body.unit ?? null,
        body.taxAffectation ?? null,
        body.active ?? null,
      ],
    );
    if (body.priceCents !== undefined && body.priceCents !== before.price_cents) {
      await db.query('INSERT INTO price_history (product_id, price_cents, changed_by) VALUES ($1, $2, $3)', [
        before.id,
        body.priceCents,
        user.id,
      ]);
      await audit(db, user.id, 'CAMBIA_PRECIO', 'product', before.id, { from: before.price_cents, to: body.priceCents });
    }
    if (body.stock !== undefined && Number(body.stock) !== Number(before.stock)) {
      await audit(db, user.id, 'AJUSTA_STOCK', 'product', before.id, { from: Number(before.stock), to: body.stock });
    }
    return updated!;
  });
  res.json(toProduct(row));
});

/** Suma stock al recibir mercadería (más simple que editar el número a mano). */
catalogRouter.post('/products/:id/restock', requirePermission('inventory.edit'), async (req, res) => {
  const body = parse(z.object({ quantity: z.number().positive().max(100000), costCents: z.number().int().min(0).optional() }), req.body);
  const row = await one(
    pool,
    'UPDATE products SET stock = stock + $2, cost_cents = COALESCE($3, cost_cents) WHERE id = $1 RETURNING *',
    [req.params.id, body.quantity, body.costCents ?? null],
  );
  if (!row) throw notFound('No se encontró el producto.');
  await audit(pool, currentUser(req).id, 'REPONE_STOCK', 'product', row.id, body);
  res.json(toProduct(row));
});

/** Foto de referencia del producto (cámara o galería). */
catalogRouter.post(
  '/products/:id/image',
  requirePermission('products.quickCreate', 'products.edit'),
  upload.single('image'),
  async (req, res) => {
    if (!req.file) throw badRequest('Envía una foto JPG, PNG o WEBP.');
    const product = await one(pool, 'SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!product) throw notFound('No se encontró el producto.');
    const user = currentUser(req);
    // El vendedor solo puede poner foto a productos que no tienen una.
    if (!can(user.role, 'products.edit') && product.image_url) throw forbidden('Solo el Administrador puede cambiar la foto.');
    const ext = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${product.id}-${Date.now()}.${ext}`;
    await rename(req.file.path, join(productsDir, fileName));
    const row = await one(pool, 'UPDATE products SET image_url = $2 WHERE id = $1 RETURNING *', [
      product.id,
      `/uploads/products/${fileName}`,
    ]);
    res.json(toProduct(row!));
  },
);
