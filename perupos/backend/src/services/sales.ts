import type pg from 'pg';
import {
  QR_METHODS,
  allowedDocTypes,
  checkCredit,
  checkPayments,
  computeTaxes,
  discountNeedsAdmin,
  formatSoles,
  isElectronic,
  lineTotal,
  qrAmount,
  validateBuyer,
  type Sale,
  type SaleInput,
} from '@perupos/shared';
import { audit, many, one, pool, tx, type Db } from '../db/pool.js';
import { verifyOverrideToken, type AuthUser } from '../http/auth.js';
import { HttpError, badRequest, forbidden, notFound } from '../http/errors.js';
import { iso, isoOrNull } from './mappers.js';
import { consumeCharge } from './payments/charges.js';
import { claimOperationRef } from './payments/operationRefs.js';
import { getSettings } from './settings.js';

/** Se aceptan precios de hasta 30 días atrás para ventas hechas sin internet. */
const STALE_PRICE_DAYS = 30;

export class CreditLimitError extends HttpError {
  constructor(message: string, details: unknown) {
    super(409, message, 'LIMITE_CREDITO', details);
  }
}

export interface CreateSaleResult {
  sale: Sale;
  created: boolean;
}

/**
 * Registra una venta completa en una sola transacción: ítems, IGV, pagos
 * mixtos, fiado, stock y numeración del comprobante. Es idempotente: si el
 * teléfono reenvía la misma venta (mismo id), se devuelve la ya registrada.
 */
export async function createSale(user: AuthUser, input: SaleInput): Promise<CreateSaleResult> {
  const existing = await getSale(pool, input.id);
  if (existing) {
    if (existing.sellerId !== user.id) throw badRequest('Ese id de venta ya existe.', 'ID_DUPLICADO');
    return { sale: existing, created: false };
  }

  const sale = await tx(async (db) => {
    const settings = await getSettings(db);
    if (input.items.length === 0) throw badRequest('El carrito está vacío.');

    // 1. Productos y precios (bloqueados para descontar stock sin carreras).
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const products = await many(db, 'SELECT * FROM products WHERE id = ANY($1::uuid[]) FOR UPDATE', [ids]);
    const byId = new Map(products.map((p) => [p.id as string, p]));
    const priceWarnings: unknown[] = [];

    const lines = [];
    for (const item of input.items) {
      const product = byId.get(item.productId);
      if (!product) throw badRequest('Uno de los productos ya no existe. Actualiza el catálogo.', 'PRODUCTO_NO_EXISTE');
      if (product.unit === 'UND' && !Number.isInteger(item.quantity)) {
        throw badRequest(`${product.name} se vende por unidad.`);
      }
      if (item.unitPriceCents !== product.price_cents) {
        const ok = user.role === 'ADMIN' || (await wasRecentPrice(db, item.productId, item.unitPriceCents, input.createdAt));
        if (!ok) throw forbidden(`El precio de ${product.name} no coincide. Solo el Administrador puede cambiar precios.`);
        priceWarnings.push({ productId: item.productId, sent: item.unitPriceCents, current: product.price_cents });
      }
      lines.push({
        product,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: lineTotal(item.unitPriceCents, item.quantity),
      });
    }

    // 2. Totales e IGV.
    const taxes = computeTaxes(
      lines.map((l) => ({ totalCents: l.totalCents, taxAffectation: l.product.tax_affectation })),
      input.discountCents,
      settings.taxRegime,
      settings.igvRate,
    );
    if (input.discountCents > taxes.subtotalCents) throw badRequest('El descuento no puede ser mayor que la venta.');

    let discountAuthorizedBy: string | null = null;
    if (input.discountCents > 0 && discountNeedsAdmin(user.role, input.discountCents, taxes.subtotalCents)) {
      discountAuthorizedBy = await requireOverride(db, input.authorizationToken, 'DISCOUNT', input.id);
      if (!discountAuthorizedBy) {
        throw new HttpError(403, 'Un descuento mayor al 10 % necesita la autorización del Administrador.', 'REQUIERE_AUTORIZACION', {
          purpose: 'DISCOUNT',
        });
      }
    }

    // 3. Pagos.
    const check = checkPayments(taxes.totalCents, input.payments, { hasCustomer: !!input.customerId, final: true });
    if (!check.ok) throw badRequest(check.errors.join(' '), 'PAGO_INVALIDO');
    const usesQr = input.payments.some((p) => QR_METHODS.includes(p.method) && p.confirmation === 'QR');
    if (usesQr && !settings.yapePlinEnabled) throw badRequest('El cobro con QR no está activado.', 'QR_DESACTIVADO');

    // 4. Comprobante.
    if (!allowedDocTypes(settings.taxRegime).includes(input.docType)) {
      throw badRequest('Tu régimen tributario no permite emitir ese comprobante.', 'COMPROBANTE_NO_PERMITIDO');
    }
    const buyerError = validateBuyer(input.docType, taxes.totalCents, input.buyer);
    if (buyerError) throw badRequest(buyerError, 'COMPRADOR_INVALIDO');

    // 5. Cliente y fiado.
    let creditAuthorizedBy: string | null = null;
    const fiado = input.payments.find((p) => p.method === 'FIADO');
    if (input.customerId) {
      const customer = await one(
        db,
        `SELECT c.*, d.balance_cents FROM customers c JOIN customer_debt d ON d.customer_id = c.id
          WHERE c.id = $1 FOR UPDATE OF c`,
        [input.customerId],
      );
      if (!customer) throw badRequest('El cliente no existe. Sincroniza e intenta de nuevo.', 'CLIENTE_NO_EXISTE');
      if (fiado) {
        const credit = checkCredit(customer.balance_cents, customer.credit_limit_cents, fiado.amountCents, settings.creditAlertRatio);
        if (credit.exceedsLimit) {
          creditAuthorizedBy = await requireOverride(db, input.authorizationToken, 'CREDIT', input.id);
          if (!creditAuthorizedBy && user.role !== 'ADMIN') {
            throw new CreditLimitError(
              `${customer.name} debe ${formatSoles(customer.balance_cents)} y su límite es ${formatSoles(customer.credit_limit_cents)}. ` +
                'Este fiado lo supera: necesita autorización del Administrador.',
              { purpose: 'CREDIT', balanceCents: customer.balance_cents, limitCents: customer.credit_limit_cents },
            );
          }
          creditAuthorizedBy ??= user.id;
        }
      }
    }

    // 6. Numeración del comprobante electrónico.
    let serie: string | null = null;
    let correlativo: number | null = null;
    if (isElectronic(input.docType)) {
      const next = await one<{ serie: string; last_number: number }>(
        db,
        `UPDATE doc_series SET last_number = last_number + 1
          WHERE serie = (SELECT serie FROM doc_series WHERE doc_type = $1 AND active ORDER BY serie LIMIT 1)
          RETURNING serie, last_number`,
        [input.docType],
      );
      if (!next) throw badRequest('No hay una serie configurada para ese comprobante.', 'SIN_SERIE');
      serie = next.serie;
      correlativo = next.last_number;
    }

    // 7. Guardar.
    await db.query(
      `INSERT INTO sales (id, seller_id, customer_id, doc_type, serie, correlativo, sunat_status,
         subtotal_cents, discount_cents, gravada_cents, exonerada_cents, inafecta_cents, igv_cents, total_cents,
         change_cents, buyer_doc_type, buyer_doc_number, buyer_name, buyer_address,
         discount_authorized_by, credit_authorized_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        input.id,
        user.id,
        input.customerId,
        input.docType,
        serie,
        correlativo,
        isElectronic(input.docType) ? 'PENDIENTE' : 'NO_APLICA',
        taxes.subtotalCents,
        taxes.discountCents,
        taxes.gravadaCents,
        taxes.exoneradaCents,
        taxes.inafectaCents,
        taxes.igvCents,
        taxes.totalCents,
        check.changeCents,
        input.buyer?.docType ?? null,
        input.buyer?.docNumber ?? null,
        input.buyer?.name ?? null,
        input.buyer?.address ?? null,
        discountAuthorizedBy,
        creditAuthorizedBy,
        clampClientDate(input.createdAt),
      ],
    );

    for (const [i, line] of lines.entries()) {
      const tax = taxes.lines[i]!;
      await db.query(
        `INSERT INTO sale_items (sale_id, product_id, name, quantity, unit, unit_price_cents, total_cents,
           discount_cents, tax_affectation, igv_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          input.id,
          line.product.id,
          line.product.name,
          line.quantity,
          line.product.unit,
          line.unitPriceCents,
          line.totalCents,
          line.totalCents - tax.totalCents,
          line.product.tax_affectation,
          tax.igvCents,
        ],
      );
      await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1', [line.product.id, line.quantity]);
    }

    for (const p of input.payments) {
      let method = p.method;
      const isQr = QR_METHODS.includes(p.method);
      if (p.chargeId && p.confirmation === 'QR') {
        // Si el cliente yapeó de más, el QR se cobró por lo que pagó (monto + vuelto).
        const { wallet } = await consumeCharge(db, p.chargeId, qrAmount(p));
        // El QR es interoperable: si el proveedor sabe con qué app pagó, lo anotamos.
        if (wallet?.toUpperCase().includes('PLIN')) method = 'PLIN';
        else if (wallet?.toUpperCase().includes('YAPE')) method = 'YAPE';
      }
      let reference = p.reference?.trim() || null;
      if (isQr && p.confirmation === 'MANUAL' && reference) {
        reference = await claimOperationRef(db, p.method, reference, { saleId: input.id });
      }
      const tendered =
        p.method === 'CASH' ? (p.tenderedCents ?? p.amountCents) : isQr && p.tenderedCents !== undefined ? p.tenderedCents : null;
      await db.query(
        `INSERT INTO payments (sale_id, method, amount_cents, tendered_cents, change_cents, confirmation, charge_id, reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.id,
          method,
          p.amountCents,
          tendered,
          tendered === null ? 0 : tendered - p.amountCents,
          isQr ? (p.confirmation ?? null) : null,
          p.confirmation === 'QR' ? (p.chargeId ?? null) : null,
          reference,
        ],
      );
      if (isQr && p.confirmation === 'MANUAL') {
        await audit(db, user.id, 'PAGO_DIGITAL_MANUAL', 'sale', input.id, { method: p.method, amountCents: p.amountCents, reference });
      }
    }

    if (fiado && input.customerId) {
      await db.query(
        `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, sale_id, user_id, created_at)
         VALUES (gen_random_uuid(), $1, 'FIADO', $2, $3, $4, $5)`,
        [input.customerId, fiado.amountCents, input.id, user.id, clampClientDate(input.createdAt)],
      );
    }

    if (priceWarnings.length) await audit(db, user.id, 'PRECIO_ANTERIOR', 'sale', input.id, priceWarnings);
    if (discountAuthorizedBy) {
      await audit(db, discountAuthorizedBy, 'AUTORIZA_DESCUENTO', 'sale', input.id, { discountCents: input.discountCents, seller: user.id });
    }
    if (creditAuthorizedBy) {
      await audit(db, creditAuthorizedBy, 'AUTORIZA_FIADO_SOBRE_LIMITE', 'sale', input.id, { amountCents: fiado?.amountCents });
    }

    return (await getSale(db, input.id))!;
  }).catch(async (err) => {
    // Dos envíos simultáneos de la misma venta: gana uno y el otro devuelve la registrada.
    if ((err as { code?: string }).code === '23505' && String((err as { constraint?: string }).constraint).startsWith('sales_pkey')) {
      const again = await getSale(pool, input.id);
      if (again) return again;
    }
    throw err;
  });

  return { sale, created: true };
}

/**
 * true si ese precio estuvo vigente en algún momento de los 30 días previos a
 * la venta (el teléfono pudo vender sin internet con el catálogo anterior).
 */
async function wasRecentPrice(db: Db, productId: string, priceCents: number, soldAt: string): Promise<boolean> {
  const row = await one(
    db,
    `SELECT 1 FROM (
       SELECT price_cents, changed_at, LEAD(changed_at) OVER (ORDER BY changed_at, id) AS next_at
         FROM price_history WHERE product_id = $1
     ) h
     WHERE h.price_cents = $2 AND h.changed_at <= $3::timestamptz
       AND (h.next_at IS NULL OR h.next_at >= $3::timestamptz - make_interval(days => $4))
     LIMIT 1`,
    [productId, priceCents, clampClientDate(soldAt), STALE_PRICE_DAYS],
  );
  return !!row;
}

async function requireOverride(
  db: Db,
  token: string | undefined,
  purpose: 'DISCOUNT' | 'CREDIT',
  saleId: string,
): Promise<string | null> {
  if (!token) return null;
  const adminId = verifyOverrideToken(token, purpose, saleId);
  if (!adminId) return null;
  const admin = await one(db, "SELECT id FROM users WHERE id = $1 AND role = 'ADMIN' AND active", [adminId]);
  return admin ? adminId : null;
}

/** La hora del teléfono puede estar mal: no se aceptan fechas en el futuro. */
function clampClientDate(value: string): Date {
  const d = new Date(value);
  const now = new Date();
  if (Number.isNaN(d.getTime()) || d > now) return now;
  return d;
}

export async function getSale(db: Db, id: string): Promise<Sale | null> {
  const row = await one(
    db,
    `SELECT s.*, u.name AS seller_name, c.name AS customer_name
       FROM sales s JOIN users u ON u.id = s.seller_id LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1`,
    [id],
  );
  if (!row) return null;
  const items = await many(db, 'SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [id]);
  const payments = await many(db, 'SELECT * FROM payments WHERE sale_id = $1 ORDER BY id', [id]);
  return toSale(row, items, payments);
}

export function toSale(row: Record<string, any>, items: Record<string, any>[], payments: Record<string, any>[]): Sale {
  return {
    id: row.id,
    number: row.number,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    status: row.status,
    docType: row.doc_type,
    serie: row.serie,
    correlativo: row.correlativo,
    sunatStatus: row.sunat_status,
    sunatQr: row.sunat_qr,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPriceCents: i.unit_price_cents,
      totalCents: i.total_cents,
      taxAffectation: i.tax_affectation,
      igvCents: i.igv_cents,
    })),
    payments: payments.map((p) => ({
      method: p.method,
      amountCents: p.amount_cents,
      tenderedCents: p.tendered_cents,
      changeCents: p.change_cents,
      confirmation: p.confirmation,
      chargeId: p.charge_id,
      reference: p.reference,
    })),
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    gravadaCents: row.gravada_cents,
    exoneradaCents: row.exonerada_cents,
    inafectaCents: row.inafecta_cents,
    igvCents: row.igv_cents,
    totalCents: row.total_cents,
    changeCents: row.change_cents,
    buyerDocType: row.buyer_doc_type,
    buyerDocNumber: row.buyer_doc_number,
    buyerName: row.buyer_name,
    createdAt: iso(row.created_at),
  };
}

export async function listSales(
  db: Db,
  filters: { sellerId?: string; from?: string; to?: string; limit: number; before?: number },
): Promise<(Omit<Sale, 'items' | 'payments'> & { voidedAt: string | null; payments: Sale['payments'] })[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (filters.sellerId) where.push(`s.seller_id = $${params.push(filters.sellerId)}`);
  if (filters.from) where.push(`s.created_at >= $${params.push(filters.from)}`);
  if (filters.to) where.push(`s.created_at < $${params.push(filters.to)}`);
  if (filters.before) where.push(`s.number < $${params.push(filters.before)}`);
  const rows = await many(
    db,
    `SELECT s.*, u.name AS seller_name, c.name AS customer_name
       FROM sales s JOIN users u ON u.id = s.seller_id LEFT JOIN customers c ON c.id = s.customer_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.number DESC LIMIT $${params.push(filters.limit)}`,
    params,
  );
  const payments = rows.length
    ? await many(db, 'SELECT * FROM payments WHERE sale_id = ANY($1::uuid[]) ORDER BY id', [rows.map((r) => r.id)])
    : [];
  return rows.map((r) => {
    const { items: _items, ...sale } = toSale(r, [], payments.filter((p) => p.sale_id === r.id));
    return { ...sale, voidedAt: isoOrNull(r.voided_at) };
  });
}

/** Anula una venta (solo Admin): devuelve el stock y revierte el fiado. */
export async function voidSale(user: AuthUser, id: string, reason: string): Promise<Sale> {
  return tx(async (db: pg.PoolClient) => {
    const row = await one(db, 'SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id]);
    if (!row) throw notFound('No se encontró la venta.');
    if (row.status === 'VOIDED') throw badRequest('La venta ya estaba anulada.');
    await db.query(
      "UPDATE sales SET status = 'VOIDED', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1",
      [id, user.id, reason],
    );
    const items = await many(db, 'SELECT product_id, quantity FROM sale_items WHERE sale_id = $1', [id]);
    for (const item of items) {
      await db.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [item.product_id, item.quantity]);
    }
    const fiado = await one(db, "SELECT * FROM credit_movements WHERE sale_id = $1 AND kind = 'FIADO'", [id]);
    if (fiado) {
      await db.query(
        `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, sale_id, user_id, note, created_at)
         VALUES (gen_random_uuid(), $1, 'ABONO', $2, $3, $4, $5, now())`,
        [fiado.customer_id, fiado.amount_cents, id, user.id, `Anulación de la venta N° ${row.number}`],
      );
    }
    await audit(db, user.id, 'ANULA_VENTA', 'sale', id, { reason, totalCents: row.total_cents });
    return (await getSale(db, id))!;
  });
}
