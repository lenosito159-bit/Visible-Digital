import { formatSoles, lineTotal, computeTaxes } from '../money.js';
import { checkPayments } from '../payments.js';
import { checkCredit, discountNeedsAdmin } from '../rules.js';
import {
  PAYMENT_METHOD_LABELS,
  QR_METHODS,
  type Cents,
  type PaymentMethod,
  type Sale,
  type SaleInput,
  type TaxAffectation,
  type Unit,
} from '../types.js';
import { getBusiness } from './access.js';
import { moveStock, roundQuantity, type ProductRow } from './catalog.js';
import { refreshCustomerDebt } from './customers.js';
import { LocalError, requirePermission, type Actor, type LocalCrypto, type LocalDb } from './db.js';

/**
 * Ventas en el celular. Cada venta se guarda entera o no se guarda: ítems,
 * stock, pagos, fiado y N° de operación van en una sola transacción.
 * Es idempotente: reintentar con el mismo id no la duplica.
 *
 * Yape y Plin: el comerciante revisa en su app que le llegó y lo confirma
 * aquí. Se guarda como "MANUAL" (confirmado por el comerciante), nunca como
 * verificado por una integración.
 */

/** "  0012 3456 " => "00123456": así se compara igual aunque se escriba con espacios. */
export function normalizeReference(reference: string): string {
  return reference.replace(/[\s-]/g, '').toUpperCase();
}

/** Reserva el N° de operación de un Yape/Plin para que no se use dos veces. */
export async function claimOperationRef(
  db: LocalDb,
  method: PaymentMethod,
  reference: string,
  target: { saleId?: string; movementId?: string },
): Promise<string> {
  const ref = normalizeReference(reference);
  if (!/^[A-Z0-9]{4,30}$/.test(ref)) {
    throw new LocalError('OPERACION_INVALIDA', 'El N° de operación debe tener entre 4 y 30 letras o números.');
  }
  const used = await db.get('SELECT 1 FROM operation_refs WHERE method = ? AND reference = ?', method, ref);
  if (used) {
    throw new LocalError(
      'OPERACION_YA_USADA',
      `El N° de operación ${ref} ya se usó en otro cobro. Revisa tu app de ${PAYMENT_METHOD_LABELS[method]}.`,
    );
  }
  await db.run(
    'INSERT INTO operation_refs (method, reference, sale_id, movement_id) VALUES (?, ?, ?, ?)',
    method, ref, target.saleId ?? null, target.movementId ?? null,
  );
  return ref;
}

/** Yape/Plin solo se aceptan confirmados por el comerciante en su propia app. */
export function requireManualConfirmation(method: PaymentMethod, confirmation: string | undefined, chargeId?: string): void {
  if (!QR_METHODS.includes(method)) return;
  if (confirmation !== 'MANUAL' || chargeId) {
    throw new LocalError(
      'FALTA_CONFIRMAR',
      `Revisa en tu app de ${PAYMENT_METHOD_LABELS[method]} que te llegó el pago y confírmalo antes de guardar.`,
    );
  }
}

async function requireOwner(db: LocalDb, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await db.get<{ id: string }>("SELECT id FROM local_users WHERE id = ? AND role = 'ADMIN' AND active = 1", userId);
  return row?.id ?? null;
}

export interface RecordSaleOptions {
  /** Dueño que autorizó (con su PIN) un descuento > 10 % o un fiado sobre el límite. */
  authorizedBy?: string | null;
  now?: Date;
}

export async function recordSale(
  db: LocalDb,
  c: LocalCrypto,
  input: SaleInput,
  seller: Actor,
  opts: RecordSaleOptions = {},
): Promise<{ sale: Sale; created: boolean }> {
  requirePermission(seller, 'sales.create', 'Tu usuario no puede registrar ventas.');
  const previous = await getSale(db, input.id);
  if (previous) return { sale: previous, created: false };
  if (input.items.length === 0) throw new LocalError('CARRITO_VACIO', 'El carrito está vacío.');
  const ts = (opts.now ?? new Date()).toISOString();

  return db.transaction(async () => {
    // Dentro de la transacción otra vez: si dos toques llegan juntos, gana uno.
    const again = await getSale(db, input.id);
    if (again) return { sale: again, created: false };
    const business = await getBusiness(db);

    // 1. Productos y precios.
    const lines: { product: ProductRow; quantity: number; unitPriceCents: Cents; totalCents: Cents }[] = [];
    for (const item of input.items) {
      const product = await db.get<ProductRow>('SELECT * FROM products WHERE id = ?', item.productId);
      if (!product || !product.active) {
        throw new LocalError('PRODUCTO_NO_EXISTE', 'Uno de los productos ya no está en tu catálogo. Quítalo del carrito.');
      }
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new LocalError('CANTIDAD_INVALIDA', `Revisa la cantidad de ${product.name}.`);
      }
      if (product.unit === 'UND' && !Number.isInteger(item.quantity)) {
        throw new LocalError('CANTIDAD_INVALIDA', `${product.name} se vende por unidad.`);
      }
      if (item.unitPriceCents !== product.price_cents && seller.role !== 'ADMIN') {
        throw new LocalError(
          'PRECIO_CAMBIO',
          `El precio de ${product.name} ahora es ${formatSoles(product.price_cents)}. Quítalo y vuelve a agregarlo al carrito.`,
        );
      }
      const quantity = roundQuantity(item.quantity, product.unit);
      lines.push({ product, quantity, unitPriceCents: item.unitPriceCents, totalCents: lineTotal(item.unitPriceCents, quantity) });
    }

    // 2. Totales (sin desglose de IGV: es un comprobante interno).
    const totals = computeTaxes(
      lines.map((l) => ({ totalCents: l.totalCents, taxAffectation: l.product.tax_affectation })),
      input.discountCents,
      'NRUS',
    );
    if (!Number.isInteger(input.discountCents) || input.discountCents < 0 || input.discountCents > totals.subtotalCents) {
      throw new LocalError('DESCUENTO_INVALIDO', 'El descuento no puede ser mayor que la venta.');
    }
    let authorizedBy: string | null = null;
    if (input.discountCents > 0 && discountNeedsAdmin(seller.role, input.discountCents, totals.subtotalCents)) {
      authorizedBy = await requireOwner(db, opts.authorizedBy);
      if (!authorizedBy) {
        throw new LocalError('REQUIERE_AUTORIZACION', 'Un descuento mayor al 10 % necesita el PIN del dueño.');
      }
    }

    // 3. Pagos: efectivo, Yape/Plin confirmado por el comerciante, fiado.
    for (const p of input.payments) requireManualConfirmation(p.method, p.confirmation, p.chargeId);
    const check = checkPayments(totals.totalCents, input.payments, { hasCustomer: !!input.customerId, final: true });
    if (!check.ok) throw new LocalError('PAGO_INVALIDO', check.errors.join(' '));

    // 4. Cliente y fiado.
    const fiado = input.payments.find((p) => p.method === 'FIADO');
    if (input.customerId) {
      const customer = await db.get<{ id: string; name: string; balance_cents: number; credit_limit_cents: number; active: number }>(
        'SELECT id, name, balance_cents, credit_limit_cents, active FROM customers WHERE id = ?',
        input.customerId,
      );
      if (!customer || !customer.active) throw new LocalError('CLIENTE_NO_EXISTE', 'No se encontró al cliente.');
      if (fiado) {
        const credit = checkCredit(customer.balance_cents, customer.credit_limit_cents, fiado.amountCents, business?.creditAlertRatio);
        if (credit.exceedsLimit && seller.role !== 'ADMIN') {
          const owner = await requireOwner(db, opts.authorizedBy);
          if (!owner) {
            throw new LocalError(
              'LIMITE_CREDITO',
              `${customer.name} debe ${formatSoles(customer.balance_cents)} y su límite es ${formatSoles(customer.credit_limit_cents)}. ` +
                'Este fiado lo pasa: necesita el PIN del dueño.',
            );
          }
          authorizedBy ??= owner;
        }
      }
    }

    // 5. Guardar.
    const number = ((await db.get<{ n: number | null }>('SELECT MAX(number) AS n FROM sales'))?.n ?? 0) + 1;
    await db.run(
      `INSERT INTO sales (id, number, seller_id, seller_name, customer_id, status, subtotal_cents, discount_cents,
         total_cents, change_cents, authorized_by, created_at)
       VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?)`,
      input.id, number, seller.id, seller.name, input.customerId, totals.subtotalCents, totals.discountCents,
      totals.totalCents, check.changeCents, authorizedBy, ts,
    );
    for (const [i, line] of lines.entries()) {
      await db.run(
        `INSERT INTO sale_items (sale_id, position, product_id, name, quantity, unit, unit_price_cents, total_cents, tax_affectation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.id, i, line.product.id, line.product.name, line.quantity, line.product.unit, line.unitPriceCents,
        line.totalCents, line.product.tax_affectation,
      );
      // Se puede vender aunque el stock diga 0: en la bodega el anaquel manda.
      await moveStock(db, c, seller, line.product.id, -line.quantity, 'VENTA', ts, { saleId: input.id });
    }
    for (const [i, p] of input.payments.entries()) {
      const isQr = QR_METHODS.includes(p.method);
      const reference = isQr && p.reference?.trim() ? await claimOperationRef(db, p.method, p.reference, { saleId: input.id }) : null;
      const tendered = p.method === 'CASH' ? (p.tenderedCents ?? p.amountCents) : isQr && p.tenderedCents !== undefined ? p.tenderedCents : null;
      await db.run(
        `INSERT INTO sale_payments (sale_id, position, method, amount_cents, tendered_cents, change_cents, confirmation, reference)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        input.id, i, p.method, p.amountCents, tendered, tendered === null ? 0 : tendered - p.amountCents,
        isQr ? 'MANUAL' : null, reference,
      );
    }
    if (fiado && input.customerId) {
      const before = (await db.get<{ b: number }>('SELECT balance_cents AS b FROM customers WHERE id = ?', input.customerId))!.b;
      await db.run(
        `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, sale_id, method, confirmation, reference, note,
           balance_after_cents, user_id, user_name, created_at)
         VALUES (?, ?, 'FIADO', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
        c.randomUUID(), input.customerId, fiado.amountCents, input.id, `Venta N° ${number}`,
        before + fiado.amountCents, seller.id, seller.name, ts,
      );
      await refreshCustomerDebt(db, input.customerId, ts);
    }
    return { sale: (await getSale(db, input.id))!, created: true };
  });
}

interface SaleRow {
  id: string;
  number: number;
  seller_id: string;
  seller_name: string;
  customer_id: string | null;
  customer_name: string | null;
  status: 'COMPLETED' | 'VOIDED';
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  change_cents: number;
  created_at: string;
  voided_at: string | null;
}

interface ItemRow {
  sale_id: string;
  product_id: string;
  name: string;
  quantity: number;
  unit: Unit;
  unit_price_cents: number;
  total_cents: number;
  tax_affectation: TaxAffectation;
}

interface PaymentRow {
  sale_id: string;
  method: PaymentMethod;
  amount_cents: number;
  tendered_cents: number | null;
  change_cents: number;
  confirmation: 'MANUAL' | null;
  reference: string | null;
}

const SALE_SELECT =
  'SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id';

/** Venta guardada en el celular. */
export type LocalSale = Sale & {
  voidedAt: string | null;
  /** Si fió: lo que el cliente quedó debiendo en total justo después de esta venta. */
  fiadoBalanceAfterCents: number | null;
};

function toSale(row: SaleRow, items: ItemRow[], payments: PaymentRow[], fiadoBalanceAfterCents: number | null = null): LocalSale {
  return {
    id: row.id,
    number: row.number,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    customerId: row.customer_id,
    customerName: row.customer_name,
    status: row.status,
    docType: 'TICKET',
    serie: null,
    correlativo: null,
    sunatStatus: 'NO_APLICA',
    sunatQr: null,
    items: items.map((i) => ({
      productId: i.product_id,
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      unitPriceCents: i.unit_price_cents,
      totalCents: i.total_cents,
      taxAffectation: i.tax_affectation,
      igvCents: 0,
    })),
    payments: payments.map((p) => ({
      method: p.method,
      amountCents: p.amount_cents,
      tenderedCents: p.tendered_cents,
      changeCents: p.change_cents,
      confirmation: p.confirmation,
      chargeId: null,
      reference: p.reference,
    })),
    subtotalCents: row.subtotal_cents,
    discountCents: row.discount_cents,
    gravadaCents: 0,
    exoneradaCents: 0,
    inafectaCents: 0,
    igvCents: 0,
    totalCents: row.total_cents,
    changeCents: row.change_cents,
    buyerDocType: null,
    buyerDocNumber: null,
    buyerName: null,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    fiadoBalanceAfterCents,
  };
}

export async function getSale(db: LocalDb, id: string): Promise<LocalSale | null> {
  const row = await db.get<SaleRow>(`${SALE_SELECT} WHERE s.id = ?`, id);
  if (!row) return null;
  const items = await db.all<ItemRow>('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY position', id);
  const payments = await db.all<PaymentRow>('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY position', id);
  const fiado = await db.get<{ b: number }>(
    "SELECT balance_after_cents AS b FROM credit_movements WHERE sale_id = ? AND kind = 'FIADO'",
    id,
  );
  return toSale(row, items, payments, fiado?.b ?? null);
}

/** Ventas más recientes primero. `sellerId` para "Mis ventas" del ayudante. */
export async function listSales(
  db: LocalDb,
  filter: { from?: string; to?: string; sellerId?: string; limit?: number } = {},
): Promise<LocalSale[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const add = (clause: string, value: string) => {
    where.push(clause);
    params.push(value);
  };
  if (filter.from) add('s.created_at >= ?', filter.from);
  if (filter.to) add('s.created_at < ?', filter.to);
  if (filter.sellerId) add('s.seller_id = ?', filter.sellerId);
  params.push(filter.limit ?? 100);
  const rows = await db.all<SaleRow>(
    `${SALE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.number DESC LIMIT ?`,
    ...params,
  );
  if (rows.length === 0) return [];
  const marks = rows.map(() => '?').join(',');
  const ids = rows.map((r) => r.id);
  const items = await db.all<ItemRow>(`SELECT * FROM sale_items WHERE sale_id IN (${marks}) ORDER BY position`, ...ids);
  const payments = await db.all<PaymentRow>(`SELECT * FROM sale_payments WHERE sale_id IN (${marks}) ORDER BY position`, ...ids);
  return rows.map((r) =>
    toSale(
      r,
      items.filter((i) => i.sale_id === r.id),
      payments.filter((p) => p.sale_id === r.id),
    ),
  );
}

/** Anular una venta (solo el dueño): devuelve el stock y descuenta el fiado. */
export async function voidSale(
  db: LocalDb,
  c: LocalCrypto,
  actor: Actor,
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<Sale> {
  requirePermission(actor, 'sales.void', 'Solo el dueño puede anular ventas.');
  const ts = now.toISOString();
  await db.transaction(async () => {
    const sale = await db.get<{ status: string; number: number; customer_id: string | null }>(
      'SELECT status, number, customer_id FROM sales WHERE id = ?',
      id,
    );
    if (!sale) throw new LocalError('VENTA_NO_EXISTE', 'No se encontró la venta.');
    if (sale.status === 'VOIDED') throw new LocalError('YA_ANULADA', 'La venta ya estaba anulada.');
    await db.run(
      "UPDATE sales SET status = 'VOIDED', voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?",
      ts, actor.id, reason.trim() || null, id,
    );
    const items = await db.all<{ product_id: string; quantity: number }>(
      'SELECT product_id, quantity FROM sale_items WHERE sale_id = ?',
      id,
    );
    for (const item of items) {
      await moveStock(db, c, actor, item.product_id, item.quantity, 'ANULACION', ts, { saleId: id });
    }
    // El N° de operación vuelve a quedar libre (por si se registró en la venta equivocada).
    await db.run('DELETE FROM operation_refs WHERE sale_id = ?', id);
    const fiado = await db.get<{ customer_id: string; amount_cents: number }>(
      "SELECT customer_id, amount_cents FROM credit_movements WHERE sale_id = ? AND kind = 'FIADO'",
      id,
    );
    if (fiado) {
      const before = (await db.get<{ b: number }>('SELECT balance_cents AS b FROM customers WHERE id = ?', fiado.customer_id))!.b;
      await db.run(
        `INSERT INTO credit_movements (id, customer_id, kind, amount_cents, sale_id, method, confirmation, reference, note,
           balance_after_cents, user_id, user_name, created_at)
         VALUES (?, ?, 'ABONO', ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
        c.randomUUID(), fiado.customer_id, fiado.amount_cents, id, `Anulación de la venta N° ${sale.number}`,
        before - fiado.amount_cents, actor.id, actor.name, ts,
      );
      await refreshCustomerDebt(db, fiado.customer_id, ts);
    }
  });
  return (await getSale(db, id))!;
}
