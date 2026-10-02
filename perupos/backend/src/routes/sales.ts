import express, { Router } from 'express';
import { z } from 'zod';
import { buildReceiptText, can } from '@perupos/shared';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { currentUser, requireAuth, requirePermission } from '../http/auth.js';
import { badRequest, forbidden, notFound, parse } from '../http/errors.js';
import { saleInputSchema } from '../http/schemas.js';
import { evaluateAlerts } from '../services/alerts.js';
import { applyWebhook, cancelQrCharge, createQrCharge, refreshQrCharge } from '../services/payments/charges.js';
import { MockQrProvider } from '../services/payments/mock.js';
import { TaypiQrProvider } from '../services/payments/taypi.js';
import { toCharge } from '../services/mappers.js';
import { qrProvider } from '../services/payments/provider.js';
import { emitPendingDocuments } from '../services/pse/emitter.js';
import { pseProvider } from '../services/pse/provider.js';
import { createSale, getSale, listSales, voidSale } from '../services/sales.js';
import { getSettings } from '../services/settings.js';
import { one } from '../db/pool.js';

export const salesRouter = Router();

/** Tareas que no deben demorar la respuesta al vendedor. */
export function afterSale(): void {
  if (config.NODE_ENV === 'test') return;
  void emitPendingDocuments().catch((err) => console.warn('PSE:', err.message));
  void evaluateAlerts().catch((err) => console.warn('Alertas:', err.message));
}

// El webhook de TAYPI va antes de express.json(): la firma se calcula sobre el cuerpo crudo.
salesRouter.post('/webhooks/taypi', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  const ok = await applyWebhook(raw, req.headers);
  if (!ok) {
    res.status(403).json({ error: 'Firma inválida' });
    return;
  }
  res.json({ received: true });
});

salesRouter.use(requireAuth);

salesRouter.post('/sales', requirePermission('sales.create'), async (req, res) => {
  const { sale, created } = await createSale(currentUser(req), parse(saleInputSchema, req.body));
  if (created) afterSale();
  res.status(created ? 201 : 200).json(sale);
});

salesRouter.get('/sales', requirePermission('sales.read.own', 'sales.read.all'), async (req, res) => {
  const user = currentUser(req);
  const q = parse(
    z.object({
      from: z.string().optional(),
      to: z.string().optional(),
      before: z.coerce.number().int().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      sellerId: z.uuid().optional(),
    }),
    req.query,
  );
  // El vendedor solo ve sus propias ventas.
  const sellerId = can(user.role, 'sales.read.all') ? q.sellerId : user.id;
  res.json(await listSales(pool, { ...q, sellerId }));
});

salesRouter.get('/sales/:id', requirePermission('sales.read.own', 'sales.read.all'), async (req, res) => {
  const user = currentUser(req);
  const sale = await getSale(pool, req.params.id as string);
  if (!sale) throw notFound('No se encontró la venta.');
  if (!can(user.role, 'sales.read.all') && sale.sellerId !== user.id) throw forbidden();
  res.json(sale);
});

/** Ticket en texto para ticketera térmica o WhatsApp. */
salesRouter.get('/sales/:id/receipt', requirePermission('sales.read.own', 'sales.read.all'), async (req, res) => {
  const user = currentUser(req);
  const sale = await getSale(pool, req.params.id as string);
  if (!sale) throw notFound('No se encontró la venta.');
  if (!can(user.role, 'sales.read.all') && sale.sellerId !== user.id) throw forbidden();
  const width = [32, 42, 48].includes(Number(req.query.width)) ? (Number(req.query.width) as 32 | 42 | 48) : 32;
  res.type('text/plain; charset=utf-8').send(buildReceiptText(sale, await getSettings(pool), width));
});

salesRouter.post('/sales/:id/void', requirePermission('sales.void'), async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().min(5, 'Escribe el motivo de la anulación').max(200) }), req.body);
  const sale = await voidSale(currentUser(req), req.params.id as string, reason);
  // Si el comprobante electrónico ya fue aceptado, se comunica la baja al PSE.
  const provider = pseProvider();
  if (provider && sale.sunatStatus === 'ACEPTADO') {
    const result = await provider.void(sale, await getSettings(pool), reason);
    await pool.query("UPDATE sales SET sunat_response = sunat_response || jsonb_build_object('anulacion', $2::jsonb) WHERE id = $1", [
      sale.id,
      JSON.stringify({ status: result.status, message: result.message }),
    ]);
  }
  afterSale();
  res.json(sale);
});

// ---- Cobro con QR interoperable (Yape / Plin) ----

salesRouter.post('/payments/qr', requirePermission('sales.create', 'credit.abono'), async (req, res) => {
  const body = parse(
    z.object({ amountCents: z.number().int().positive(), reference: z.uuid() }),
    req.body,
  );
  res.status(201).json(await createQrCharge({ ...body, userId: currentUser(req).id }));
});

salesRouter.get('/payments/qr/:id', requirePermission('sales.create', 'credit.abono'), async (req, res) => {
  res.json(await refreshQrCharge(req.params.id as string));
});

salesRouter.post('/payments/qr/:id/cancel', requirePermission('sales.create', 'credit.abono'), async (req, res) => {
  res.json(await cancelQrCharge(req.params.id as string));
});

/**
 * Prueba de webhook sin escanear el QR. Con TAYPI arma un evento firmado con
 * TAYPI_WEBHOOK_SECRET y lo pasa por el MISMO camino que el webhook real
 * (verificación de firma incluida). Con el proveedor de prueba, marca el QR como pagado.
 * Desactivado con NODE_ENV=production salvo TAYPI_TEST_ENDPOINT=true: permite marcar
 * un QR como pagado sin que nadie haya pagado.
 */
salesRouter.post('/webhooks/taypi/test', express.json(), requirePermission('settings.edit'), async (req, res) => {
  const enabled = config.TAYPI_TEST_ENDPOINT ?? config.NODE_ENV !== 'production';
  if (!enabled) throw notFound('Ruta no disponible en producción.');
  const body = parse(
    z.object({
      chargeId: z.uuid(),
      status: z.enum(['completed', 'expired', 'cancelled']).default('completed'),
      wallet: z.enum(['YAPE', 'PLIN']).default('YAPE'),
    }),
    req.body ?? {},
  );
  const row = await one(pool, 'SELECT * FROM qr_charges WHERE id = $1', [body.chargeId]);
  if (!row) throw notFound('No se encontró el cobro.');
  const provider = qrProvider();
  if (provider instanceof MockQrProvider) {
    if (body.status === 'completed') provider.simulatePayment(row.provider_payment_id, body.wallet);
    res.json({ via: 'mock', charge: await refreshQrCharge(body.chargeId) });
    return;
  }
  if (!(provider instanceof TaypiQrProvider)) throw badRequest('Proveedor no soportado.');
  const signed = provider.signTestWebhook(row.provider_payment_id, body.status, body.wallet);
  if (!signed) throw badRequest('Configura TAYPI_WEBHOOK_SECRET para probar el webhook.');
  const accepted = await applyWebhook(signed.body, { 'taypi-signature': signed.signature });
  const updated = await one(pool, 'SELECT * FROM qr_charges WHERE id = $1', [body.chargeId]);
  res.json({ via: 'webhook-firmado', accepted, charge: toCharge(updated!) });
});

/** Solo en modo de prueba: simula que el cliente pagó el QR desde su app. */
salesRouter.post('/payments/qr/:id/simulate', requirePermission('sales.create', 'credit.abono'), async (req, res) => {
  const provider = qrProvider();
  if (!(provider instanceof MockQrProvider)) throw badRequest('Solo disponible en modo de prueba.');
  const row = await one(pool, 'SELECT provider_payment_id FROM qr_charges WHERE id = $1', [req.params.id]);
  if (!row) throw notFound();
  const { wallet } = parse(z.object({ wallet: z.enum(['YAPE', 'PLIN']).default('YAPE') }), req.body ?? {});
  provider.simulatePayment(row.provider_payment_id, wallet);
  res.json(await refreshQrCharge(req.params.id as string));
});
