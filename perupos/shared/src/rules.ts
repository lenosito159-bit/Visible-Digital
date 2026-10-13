import { formatSoles } from './money.js';
import type { Cents, DocType, IdentityDocType, Role, TaxRegime } from './types.js';
import { isValidCe, isValidDni, isValidRuc } from './validators.js';

/** Porcentaje máximo de descuento que puede dar un vendedor sin autorización. */
export const SELLER_MAX_DISCOUNT_PERCENT = 10;

/** SUNAT exige identificar al comprador en boletas mayores a S/ 700. */
export const BOLETA_ID_THRESHOLD_CENTS = 70000;

export function discountPercent(discountCents: Cents, subtotalCents: Cents): number {
  if (subtotalCents <= 0) return 0;
  return (discountCents / subtotalCents) * 100;
}

/** true si el descuento necesita que un Administrador lo autorice. */
export function discountNeedsAdmin(role: Role, discountCents: Cents, subtotalCents: Cents): boolean {
  if (role === 'ADMIN') return false;
  return discountPercent(discountCents, subtotalCents) > SELLER_MAX_DISCOUNT_PERCENT + 1e-9;
}

export interface CreditCheck {
  /** Deuda que tendría el cliente después de este fiado. */
  newBalanceCents: Cents;
  availableCents: Cents;
  /** Uso del límite de 0 a 1 (o más si lo supera). */
  usage: number;
  exceedsLimit: boolean;
  /** Llegó al umbral de alerta (90 % por defecto). */
  nearLimit: boolean;
}

export function checkCredit(
  balanceCents: Cents,
  limitCents: Cents,
  newFiadoCents: Cents,
  alertRatio = 0.9,
): CreditCheck {
  const newBalance = balanceCents + newFiadoCents;
  const usage = limitCents > 0 ? newBalance / limitCents : newBalance > 0 ? Infinity : 0;
  return {
    newBalanceCents: newBalance,
    availableCents: Math.max(0, limitCents - balanceCents),
    usage,
    exceedsLimit: newBalance > limitCents,
    nearLimit: usage >= alertRatio,
  };
}

/**
 * Comprobantes que puede emitir el negocio según su régimen.
 * - Nuevo RUS: no puede emitir facturas. Emite ticket POS (SEE-CF) o nota de venta.
 * - RER, RMT y General: boletas y facturas electrónicas.
 */
export function allowedDocTypes(regime: TaxRegime): DocType[] {
  if (regime === 'NRUS') return ['TICKET', 'TICKET_POS'];
  return ['TICKET', 'BOLETA', 'FACTURA'];
}

export function defaultDocType(regime: TaxRegime): DocType {
  return regime === 'NRUS' ? 'TICKET_POS' : 'BOLETA';
}

/** Comprobantes que se envían a SUNAT a través de un PSE. */
export function isElectronic(docType: DocType): boolean {
  return docType !== 'TICKET';
}

export interface BuyerInput {
  docType: IdentityDocType;
  docNumber: string;
  name: string;
}

/** Valida los datos del comprador según el comprobante. Devuelve el error o null. */
export function validateBuyer(
  docType: DocType,
  totalCents: Cents,
  buyer: BuyerInput | undefined,
): string | null {
  if (docType === 'FACTURA') {
    if (!buyer || buyer.docType !== 'RUC' || !isValidRuc(buyer.docNumber)) {
      return 'La factura necesita un RUC válido del cliente.';
    }
    if (!buyer.name.trim()) return 'Escribe la razón social del cliente.';
    return null;
  }
  const needsId = docType === 'BOLETA' && totalCents > BOLETA_ID_THRESHOLD_CENTS;
  if (!buyer || buyer.docType === 'NONE') {
    return needsId
      ? `Las boletas mayores a ${formatSoles(BOLETA_ID_THRESHOLD_CENTS)} necesitan DNI del cliente.`
      : null;
  }
  const validators: Record<Exclude<IdentityDocType, 'NONE'>, (v: string) => boolean> = {
    DNI: isValidDni,
    RUC: isValidRuc,
    CE: isValidCe,
  };
  if (!validators[buyer.docType](buyer.docNumber)) return `El ${buyer.docType} no es válido.`;
  if (!buyer.name.trim()) return 'Escribe el nombre del cliente.';
  return null;
}

/** Días transcurridos entre dos fechas ISO (redondeado hacia abajo). */
export function daysBetween(fromIso: string, to: Date = new Date()): number {
  return Math.floor((to.getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
