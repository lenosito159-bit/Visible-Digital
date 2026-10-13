import { z } from 'zod';
import { DOC_TYPES, PAYMENT_METHODS, ROLES, TAX_AFFECTATIONS, TAX_REGIMES, UNITS } from '@perupos/shared';

export const cents = z.number().int('Monto en céntimos').min(0);
export const positiveCents = z.number().int('Monto en céntimos').positive('El monto debe ser mayor a cero');
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida');
const identityDoc = z.enum(['DNI', 'RUC', 'CE', 'NONE']);

export const saleInputSchema = z.object({
  id: z.uuid(),
  createdAt: isoDate,
  items: z
    .array(
      z.object({
        productId: z.uuid(),
        quantity: z.number().positive().max(100000),
        unitPriceCents: cents,
      }),
    )
    .min(1, 'El carrito está vacío')
    .max(200),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amountCents: positiveCents,
        tenderedCents: cents.optional(),
        confirmation: z.enum(['QR', 'MANUAL']).optional(),
        chargeId: z.uuid().optional(),
        reference: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(6),
  discountCents: cents.default(0),
  customerId: z.uuid().nullable().default(null),
  docType: z.enum(DOC_TYPES),
  buyer: z
    .object({
      docType: identityDoc,
      docNumber: z.string().max(20),
      name: z.string().max(200),
      address: z.string().max(300).optional(),
    })
    .optional(),
  authorizationToken: z.string().optional(),
});

export const abonoInputSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  amountCents: positiveCents,
  method: z.enum(['CASH', 'YAPE', 'PLIN', 'TRANSFER', 'CARD']),
  confirmation: z.enum(['QR', 'MANUAL']).optional(),
  chargeId: z.uuid().optional(),
  reference: z.string().max(40).optional(),
  createdAt: isoDate,
});

export const customerInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, 'Escribe el nombre del cliente').max(120),
  phone: z.string().trim().max(20).nullable().optional(),
  photoUrl: z.string().max(500).nullable().optional(),
  docType: identityDoc.default('NONE'),
  docNumber: z.string().trim().max(20).nullable().optional(),
  creditLimitCents: cents.optional(),
  trato: z.enum(['DON', 'DONA']).nullable().optional(),
  reputation: z.enum(['CUMPLIDO', 'MOROSO']).nullable().optional(),
});

export const productQuickSchema = z.object({
  id: z.uuid().optional(),
  barcode: z.string().trim().min(4).max(64).nullable().optional(),
  name: z.string().trim().min(2, 'Escribe el nombre del producto').max(120),
  categoryId: z.uuid().nullable().optional(),
  priceCents: positiveCents,
  unit: z.enum(UNITS).default('UND'),
});

export const productEditSchema = z.object({
  barcode: z.string().trim().min(4).max(64).nullable().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  categoryId: z.uuid().nullable().optional(),
  priceCents: positiveCents.optional(),
  costCents: cents.nullable().optional(),
  stock: z.number().min(-100000).max(1000000).optional(),
  minStock: z.number().min(0).max(1000000).optional(),
  unit: z.enum(UNITS).optional(),
  taxAffectation: z.enum(TAX_AFFECTATIONS).optional(),
  active: z.boolean().optional(),
});

export const settingsSchema = z.object({
  ruc: z.string().regex(/^\d{11}$/, 'El RUC tiene 11 dígitos'),
  razonSocial: z.string().trim().min(2).max(200),
  nombreComercial: z.string().trim().max(200).default(''),
  direccion: z.string().trim().min(5).max(300),
  ubigeo: z.string().regex(/^\d{6}$/).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  taxRegime: z.enum(TAX_REGIMES),
  cashLowThresholdCents: cents,
  defaultCreditLimitCents: cents,
  overdueDays: z.number().int().min(1).max(365),
  staleProductDays: z.number().int().min(1).max(365),
  creditAlertRatio: z.number().min(0.5).max(1),
  yapePlinEnabled: z.boolean(),
  receiptFooter: z.string().max(200).nullable().optional(),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,30}$/, 'Usuario: 3 a 30 letras o números, sin espacios'),
  role: z.enum(ROLES),
  secret: z.string().min(4, 'El PIN o contraseña debe tener al menos 4 caracteres').max(72),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  secret: z.string().min(4).max(72).optional(),
});
