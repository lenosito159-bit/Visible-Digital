/**
 * Primera prueba con credenciales reales de TAYPI (usa el SANDBOX).
 * Crea un cobro de S/ 1.00, muestra la respuesta cruda y qué campos entendió
 * PeruPOS (id, QR, estado, vencimiento), consulta su estado y lo anula.
 *
 *   npm run taypi:check -w @perupos/backend
 *   npm run taypi:check -w @perupos/backend -- --no-cancel   (para pagarlo con Yape/Plin de prueba)
 *
 * Si "hasQrPayload" y "hasQrImage" salen en false, TAYPI usa otro nombre de campo
 * para el QR: revisa la respuesta cruda y ajusta pick() en services/payments/taypi.ts.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { TaypiQrProvider } from '../services/payments/taypi.js';

async function main() {
  if (!config.TAYPI_PUBLIC_KEY || !config.TAYPI_SECRET_KEY) {
    throw new Error('Faltan TAYPI_PUBLIC_KEY y TAYPI_SECRET_KEY en backend/.env');
  }
  if (config.TAYPI_BASE_URL === 'https://app.taypi.pe' && !process.argv.includes('--produccion')) {
    throw new Error('TAYPI_BASE_URL apunta a PRODUCCIÓN. Usa el sandbox o agrega --produccion si de verdad quieres cobrar S/ 1.00.');
  }
  const provider = new TaypiQrProvider({
    publicKey: config.TAYPI_PUBLIC_KEY,
    secretKey: config.TAYPI_SECRET_KEY,
    webhookSecret: config.TAYPI_WEBHOOK_SECRET,
    baseUrl: config.TAYPI_BASE_URL,
    debug: true,
  });
  const reference = `perupos-check-${randomUUID()}`;
  console.log(`Entorno: ${config.TAYPI_BASE_URL}\nCreando cobro de S/ 1.00 (${reference})…`);
  const charge = await provider.createCharge({ amountCents: 100, reference, description: 'Prueba PeruPOS', idempotencyKey: reference });
  console.log('\nResultado:', {
    id: charge.providerPaymentId,
    status: charge.status,
    hasQrPayload: !!charge.qrPayload,
    hasQrImage: !!charge.qrImageUrl,
    checkoutUrl: charge.checkoutUrl,
    expiresAt: charge.expiresAt,
  });
  const again = await provider.getCharge(charge.providerPaymentId);
  console.log('Consulta de estado:', again.status);
  if (!process.argv.includes('--no-cancel')) {
    const cancelled = await provider.cancelCharge(charge.providerPaymentId, `cancel-${reference}`);
    console.log('Anulado:', cancelled.status);
  } else {
    console.log('\nNo se anuló: págalo desde la app de prueba y mira llegar el webhook en el servidor.');
  }
  console.log(config.TAYPI_WEBHOOK_SECRET ? '\nWebhook: secreto configurado.' : '\nWebhook: FALTA TAYPI_WEBHOOK_SECRET.');
}

main().catch((err) => {
  console.error('\nFalló:', err.message);
  process.exitCode = 1;
});
