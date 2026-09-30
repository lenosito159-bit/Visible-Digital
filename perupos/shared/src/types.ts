// Tipos del dominio de PeruPOS. Todos los montos se guardan en céntimos
// (enteros) para evitar errores de redondeo: S/ 12.50 => 1250.

export type Cents = number;

export const ROLES = ['ADMIN', 'VENDEDOR', 'AGENTE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrador',
  VENDEDOR: 'Vendedor',
  AGENTE: 'Agente Financiero',
};

/** Régimen tributario del negocio en SUNAT. */
export const TAX_REGIMES = ['NRUS', 'RER', 'RMT', 'GENERAL'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  NRUS: 'Nuevo RUS',
  RER: 'Régimen Especial (RER)',
  RMT: 'Régimen MYPE Tributario (RMT)',
  GENERAL: 'Régimen General',
};

/** Afectación al IGV de un producto (catálogo 07 de SUNAT, simplificado). */
export const TAX_AFFECTATIONS = ['GRAVADO', 'EXONERADO', 'INAFECTO'] as const;
export type TaxAffectation = (typeof TAX_AFFECTATIONS)[number];

/** Unidad de venta: por unidad o a granel (kilo). */
export const UNITS = ['UND', 'KG'] as const;
export type Unit = (typeof UNITS)[number];

export const PAYMENT_METHODS = ['CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD', 'FIADO'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  YAPE: 'Yape',
  PLIN: 'Plin',
  TRANSFER: 'Transferencia',
  CARD: 'Tarjeta',
  FIADO: 'Fiado',
};

/** Métodos que se cobran con el QR interoperable de TAYPI. */
export const QR_METHODS: readonly PaymentMethod[] = ['YAPE', 'PLIN'];

/**
 * Cómo se confirmó un pago digital:
 * - QR: TAYPI confirmó el pago del QR dinámico.
 * - MANUAL: el vendedor vio la notificación de Yape/Plin (por ejemplo, sin
 *   internet o con el QR fijo del mostrador). Queda marcado para conciliar.
 */
export type DigitalConfirmation = 'QR' | 'MANUAL';

export const DOC_TYPES = ['TICKET', 'TICKET_POS', 'BOLETA', 'FACTURA'] as const;
/**
 * - TICKET: nota de venta interna, sin valor tributario.
 * - TICKET_POS: comprobante electrónico del SEE-Consumidor Final (Nuevo RUS).
 * - BOLETA / FACTURA: comprobantes electrónicos emitidos vía PSE.
 */
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  TICKET: 'Nota de venta',
  TICKET_POS: 'Ticket POS electrónico',
  BOLETA: 'Boleta electrónica',
  FACTURA: 'Factura electrónica',
};

export type SunatStatus = 'NO_APLICA' | 'PENDIENTE' | 'ACEPTADO' | 'RECHAZADO' | 'ERROR';

export type SaleStatus = 'COMPLETED' | 'VOIDED';

/** Tipo de documento de identidad (catálogo 06 de SUNAT). */
export type IdentityDocType = 'DNI' | 'RUC' | 'CE' | 'NONE';

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
}

export interface Product {
  id: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  priceCents: Cents;
  costCents: Cents | null;
  stock: number;
  minStock: number;
  unit: Unit;
  taxAffectation: TaxAffectation;
  imageUrl: string | null;
  active: boolean;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  docType: IdentityDocType;
  docNumber: string | null;
  creditLimitCents: Cents;
  balanceCents: Cents;
  /** Fecha del fiado pendiente más antiguo o del último abono, lo que sea más reciente. */
  oldestDebtAt: string | null;
  lastPaymentAt: string | null;
  active: boolean;
  updatedAt: string;
}

export interface SaleItemInput {
  productId: string;
  quantity: number;
  unitPriceCents: Cents;
}

export interface PaymentInput {
  method: PaymentMethod;
  /** Monto que cubre este método (sin contar el vuelto). */
  amountCents: Cents;
  /** Solo efectivo: lo que el cliente entregó. */
  tenderedCents?: Cents;
  /** Solo Yape/Plin: cómo se confirmó. */
  confirmation?: DigitalConfirmation;
  /** Solo Yape/Plin por QR: id del cobro TAYPI ya pagado. */
  chargeId?: string;
  reference?: string;
}

export interface SaleInput {
  /** UUID generado en el teléfono: permite reintentar sin duplicar ventas. */
  id: string;
  createdAt: string;
  items: SaleItemInput[];
  payments: PaymentInput[];
  discountCents: Cents;
  customerId: string | null;
  docType: DocType;
  /** Datos del comprador para boletas > S/ 700 o facturas. */
  buyer?: { docType: IdentityDocType; docNumber: string; name: string; address?: string };
  /** Token de autorización del Admin (descuentos > 10 % o fiado sobre el límite). */
  authorizationToken?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  unit: Unit;
  unitPriceCents: Cents;
  totalCents: Cents;
  taxAffectation: TaxAffectation;
  igvCents: Cents;
}

export interface Payment {
  method: PaymentMethod;
  amountCents: Cents;
  tenderedCents: Cents | null;
  changeCents: Cents;
  confirmation: DigitalConfirmation | null;
  chargeId: string | null;
}

export interface Sale {
  id: string;
  number: number;
  sellerId: string;
  sellerName: string;
  customerId: string | null;
  customerName: string | null;
  status: SaleStatus;
  docType: DocType;
  serie: string | null;
  correlativo: number | null;
  sunatStatus: SunatStatus;
  sunatQr: string | null;
  items: SaleItem[];
  payments: Payment[];
  subtotalCents: Cents;
  discountCents: Cents;
  gravadaCents: Cents;
  exoneradaCents: Cents;
  inafectaCents: Cents;
  igvCents: Cents;
  totalCents: Cents;
  changeCents: Cents;
  buyerDocType: IdentityDocType | null;
  buyerDocNumber: string | null;
  buyerName: string | null;
  createdAt: string;
}

export type CreditMovementKind = 'FIADO' | 'ABONO';

export interface CreditMovement {
  id: string;
  customerId: string;
  kind: CreditMovementKind;
  amountCents: Cents;
  saleId: string | null;
  method: PaymentMethod | null;
  userName: string;
  note: string | null;
  createdAt: string;
}

export interface AbonoInput {
  id: string;
  customerId: string;
  amountCents: Cents;
  method: Exclude<PaymentMethod, 'FIADO'>;
  confirmation?: DigitalConfirmation;
  chargeId?: string;
  createdAt: string;
}

export interface AbonoReceipt {
  id: string;
  customerId: string;
  customerName: string;
  amountCents: Cents;
  method: PaymentMethod;
  previousBalanceCents: Cents;
  balanceCents: Cents;
  userName: string;
  createdAt: string;
}

export const ALERT_TYPES = [
  'STOCK_BAJO',
  'LIMITE_CREDITO',
  'CAJA_BAJA',
  'DEUDA_VENCIDA',
  'SIN_MOVIMIENTO',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  targetRoles: Role[];
  entityId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Notification {
  id: string;
  fromName: string;
  title: string;
  body: string;
  targetRoles: Role[];
  createdAt: string;
  readAt: string | null;
}

export interface Recommendation {
  kind: 'REPONER' | 'COBRAR' | 'PROMOCION' | 'LIQUIDAR' | 'CAJA';
  message: string;
  entityId: string | null;
  targetRoles: Role[];
}

export interface BusinessSettings {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubigeo: string | null;
  phone: string | null;
  taxRegime: TaxRegime;
  currency: 'PEN';
  igvRate: number;
  cashLowThresholdCents: Cents;
  defaultCreditLimitCents: Cents;
  overdueDays: number;
  staleProductDays: number;
  creditAlertRatio: number;
  yapePlinEnabled: boolean;
  receiptFooter: string | null;
}

/** Charge (cobro) del QR interoperable. */
export type ChargeStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED' | 'FAILED';

export interface QrCharge {
  id: string;
  amountCents: Cents;
  status: ChargeStatus;
  qrPayload: string;
  qrImageUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  wallet: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}
