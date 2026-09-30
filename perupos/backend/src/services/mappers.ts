import type {
  Alert,
  BusinessSettings,
  Category,
  Customer,
  Product,
  QrCharge,
  User,
} from '@perupos/shared';

type Row = Record<string, any>;

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

export function toUser(r: Row): User {
  return {
    id: r.id,
    name: r.name,
    username: r.username,
    role: r.role,
    active: r.active,
    createdAt: iso(r.created_at),
  };
}

export function toSettings(r: Row): BusinessSettings {
  return {
    ruc: r.ruc,
    razonSocial: r.razon_social,
    nombreComercial: r.nombre_comercial,
    direccion: r.direccion,
    ubigeo: r.ubigeo,
    phone: r.phone,
    taxRegime: r.tax_regime,
    currency: 'PEN',
    igvRate: Number(r.igv_rate),
    cashLowThresholdCents: r.cash_low_threshold_cents,
    defaultCreditLimitCents: r.default_credit_limit_cents,
    overdueDays: r.overdue_days,
    staleProductDays: r.stale_product_days,
    creditAlertRatio: Number(r.credit_alert_ratio),
    yapePlinEnabled: r.yape_plin_enabled,
    receiptFooter: r.receipt_footer,
  };
}

export function toCategory(r: Row): Category {
  return { id: r.id, name: r.name, icon: r.icon, sortOrder: r.sort_order };
}

export function toProduct(r: Row): Product {
  return {
    id: r.id,
    barcode: r.barcode,
    name: r.name,
    categoryId: r.category_id,
    priceCents: r.price_cents,
    costCents: r.cost_cents,
    stock: Number(r.stock),
    minStock: Number(r.min_stock),
    unit: r.unit,
    taxAffectation: r.tax_affectation,
    imageUrl: r.image_url,
    active: r.active,
    updatedAt: iso(r.updated_at),
  };
}

/** Espera columnas de customers + customer_debt (balance_cents, last_payment_at, oldest_unpaid_at). */
export function toCustomer(r: Row): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    photoUrl: r.photo_url,
    docType: r.doc_type,
    docNumber: r.doc_number,
    creditLimitCents: r.credit_limit_cents,
    balanceCents: Number(r.balance_cents ?? 0),
    oldestDebtAt: isoOrNull(r.oldest_unpaid_at),
    lastPaymentAt: isoOrNull(r.last_payment_at),
    active: r.active,
    updatedAt: iso(r.updated_at),
  };
}

export function toAlert(r: Row): Alert {
  return {
    id: r.id,
    type: r.type,
    severity: r.severity,
    title: r.title,
    message: r.message,
    targetRoles: r.target_roles,
    entityId: r.entity_id,
    createdAt: iso(r.created_at),
    resolvedAt: isoOrNull(r.resolved_at),
  };
}

export function toCharge(r: Row): QrCharge {
  return {
    id: r.id,
    amountCents: r.amount_cents,
    status: r.status,
    qrPayload: r.qr_payload,
    qrImageUrl: r.qr_image_url,
    expiresAt: iso(r.expires_at),
    paidAt: isoOrNull(r.paid_at),
    wallet: r.wallet,
  };
}

export { iso, isoOrNull };
