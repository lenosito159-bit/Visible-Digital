import type { QrCharge } from '@perupos/shared';
import { formatSoles } from '@perupos/shared';
import { config } from '../../config.js';
import { one, pool, type Db } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../http/errors.js';
import { toCharge } from '../mappers.js';
import { getSettings } from '../settings.js';
import { qrProvider, type ProviderCharge } from './provider.js';

/** Monto mínimo que acepta TAYPI por QR. */
export const MIN_QR_CENTS = 100;

export async function createQrCharge(params: {
  amountCents: number;
  reference: string;
  userId: string;
}): Promise<QrCharge> {
  const settings = await getSettings(pool);
  if (!settings.yapePlinEnabled) {
    throw badRequest('El cobro con QR de Yape/Plin no está activado. Pídele al Administrador que lo active.', 'QR_DESACTIVADO');
  }
  if (params.amountCents < MIN_QR_CENTS) {
    throw badRequest(`El monto mínimo para Yape/Plin por QR es ${formatSoles(MIN_QR_CENTS)}.`, 'MONTO_MINIMO');
  }
  const provider = qrProvider();
  // Cada intento de QR para la misma venta tiene su propia llave: si se
  // regenera, se crea un QR nuevo; si solo se reintenta la red, no se duplica.
  const attempt = await one<{ n: number }>(pool, 'SELECT count(*) AS n FROM qr_charges WHERE reference = $1', [
    params.reference,
  ]);
  const idempotencyKey = `${params.reference}-${(attempt?.n ?? 0) + 1}`;
  const charge = await provider.createCharge({
    amountCents: params.amountCents,
    reference: params.reference,
    description: `${settings.nombreComercial || settings.razonSocial} - venta`,
    idempotencyKey,
  });
  if (!charge.qrPayload && !charge.qrImageUrl) {
    throw badRequest('El proveedor no devolvió un QR. Intenta de nuevo.', 'SIN_QR');
  }
  // Nuestro temporizador es de 2 minutos (o lo que diga el proveedor, si es menos).
  const ttlEnd = new Date(Date.now() + config.QR_TTL_SECONDS * 1000);
  const expiresAt = charge.expiresAt && charge.expiresAt < ttlEnd ? charge.expiresAt : ttlEnd;
  const row = await one(
    pool,
    `INSERT INTO qr_charges (provider, provider_payment_id, reference, amount_cents, status, qr_payload,
       qr_image_url, checkout_url, expires_at, created_by, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (provider, provider_payment_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      provider.name,
      charge.providerPaymentId,
      params.reference,
      params.amountCents,
      charge.status,
      charge.qrPayload ?? '',
      charge.qrImageUrl,
      charge.checkoutUrl,
      expiresAt,
      params.userId,
      JSON.stringify(charge.raw ?? null),
    ],
  );
  return toCharge(row!);
}

async function applyProviderState(db: Db, id: string, charge: ProviderCharge): Promise<Record<string, any>> {
  const row = await one(
    db,
    `UPDATE qr_charges
        SET status = CASE WHEN status = 'PAID' THEN status ELSE $2 END,
            paid_at = COALESCE(paid_at, $3),
            wallet = COALESCE($4, wallet)
      WHERE id = $1
      RETURNING *`,
    [id, charge.status, charge.paidAt, charge.wallet],
  );
  return row!;
}

/**
 * Estado actual del cobro. Si sigue pendiente se consulta al proveedor
 * (por si el webhook aún no llegó). Pasado el tiempo, se marca vencido.
 */
export async function refreshQrCharge(id: string): Promise<QrCharge> {
  let row = await one(pool, 'SELECT * FROM qr_charges WHERE id = $1', [id]);
  if (!row) throw notFound('No se encontró el cobro.');
  if (row.status === 'PENDING') {
    const state = await qrProvider().getCharge(row.provider_payment_id);
    row = await applyProviderState(pool, id, state);
    if (row.status === 'PENDING' && new Date(row.expires_at) < new Date()) {
      await cancelQrCharge(id);
      row = (await one(pool, 'SELECT * FROM qr_charges WHERE id = $1', [id]))!;
    }
  }
  return toCharge(row);
}

/** Anula el QR en el proveedor para que nadie lo pague después de regenerarlo. */
export async function cancelQrCharge(id: string): Promise<QrCharge> {
  const row = await one(pool, 'SELECT * FROM qr_charges WHERE id = $1', [id]);
  if (!row) throw notFound('No se encontró el cobro.');
  if (row.status !== 'PENDING') return toCharge(row);
  const provider = qrProvider();
  let state: ProviderCharge;
  try {
    state = await provider.cancelCharge(row.provider_payment_id, `cancel-${id}`);
  } catch {
    // Si no se pudo anular (por ejemplo, porque ya se pagó), se consulta su estado real.
    state = await provider.getCharge(row.provider_payment_id);
  }
  const expired = state.status === 'PENDING' || state.status === 'CANCELLED' ? { ...state, status: 'EXPIRED' as const } : state;
  return toCharge(await applyProviderState(pool, id, expired));
}

export async function applyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<boolean> {
  const provider = qrProvider();
  const update = provider.parseWebhook(rawBody, headers);
  if (!update) return false;
  const row = await one(pool, 'SELECT id FROM qr_charges WHERE provider = $1 AND provider_payment_id = $2', [
    provider.name,
    update.providerPaymentId,
  ]);
  if (row) {
    await applyProviderState(pool, row.id, {
      providerPaymentId: update.providerPaymentId,
      status: update.status,
      paidAt: update.paidAt,
      wallet: update.wallet,
      qrPayload: null,
      qrImageUrl: null,
      checkoutUrl: null,
      expiresAt: null,
      raw: update.raw,
    });
  }
  return true;
}

/**
 * Marca un cobro pagado como usado por una venta o abono. Evita que el mismo
 * pago de Yape se registre dos veces.
 */
export async function consumeCharge(db: Db, chargeId: string, amountCents: number): Promise<{ wallet: string | null }> {
  const row = await one(db, 'SELECT * FROM qr_charges WHERE id = $1 FOR UPDATE', [chargeId]);
  if (!row) throw badRequest('No se encontró el pago por QR.', 'QR_NO_EXISTE');
  if (row.status !== 'PAID') throw badRequest('El pago por QR aún no está confirmado.', 'QR_NO_PAGADO');
  if (row.amount_cents !== amountCents) {
    throw badRequest(
      `El QR se pagó por ${formatSoles(row.amount_cents)}, no por ${formatSoles(amountCents)}.`,
      'QR_MONTO_DISTINTO',
    );
  }
  if (row.consumed_at) throw conflict('Este pago por QR ya se usó en otra operación.', 'QR_YA_USADO');
  await db.query('UPDATE qr_charges SET consumed_at = now() WHERE id = $1', [chargeId]);
  return { wallet: row.wallet };
}
