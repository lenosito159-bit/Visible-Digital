import { createHmac } from 'node:crypto';
import { Taypi, TaypiError } from 'taypi.pe';
import type { ChargeStatus } from '@perupos/shared';
import { HttpError } from '../../http/errors.js';
import type { CreateChargeParams, ProviderCharge, QrProvider, WebhookUpdate } from './provider.js';

type Json = Record<string, unknown>;

/**
 * Integración con TAYPI usando su SDK oficial (`taypi.pe`). Un solo QR
 * interoperable lo pueden pagar Yape, Plin y las apps bancarias de la CCE.
 *
 * El SDK tipa las respuestas como Record<string, unknown>, así que los campos
 * se leen de forma defensiva. Si TAYPI cambia nombres, basta con ajustar
 * `pick()` aquí. Verifica en el sandbox antes de pasar a producción.
 */
export class TaypiQrProvider implements QrProvider {
  readonly name = 'taypi';
  private client: Taypi;
  private webhookSecret: string | undefined;

  private debug: boolean;
  private logged = new Set<string>();

  constructor(opts: { publicKey: string; secretKey: string; webhookSecret?: string; baseUrl: string; debug?: boolean }) {
    this.client = new Taypi(opts.publicKey, opts.secretKey, { baseUrl: opts.baseUrl });
    this.webhookSecret = opts.webhookSecret;
    this.debug = !!opts.debug;
  }

  /**
   * Registra la respuesta cruda la primera vez que se ve cada tipo de llamada
   * (o siempre con TAYPI_DEBUG=true). Sirve para confirmar los nombres reales de
   * los campos en la primera prueba con credenciales y ajustar pick() si hace falta.
   * Las respuestas de pago no contienen llaves; aun así, no se registran cabeceras.
   */
  private logRaw(kind: string, raw: unknown, parsed?: ProviderCharge): void {
    if (!this.debug && this.logged.has(kind)) return;
    this.logged.add(kind);
    const summary = parsed
      ? { id: parsed.providerPaymentId, status: parsed.status, hasQrPayload: !!parsed.qrPayload, hasQrImage: !!parsed.qrImageUrl, wallet: parsed.wallet, expiresAt: parsed.expiresAt }
      : undefined;
    console.info(`[TAYPI] respuesta cruda de ${kind}:`, JSON.stringify(raw));
    if (summary) console.info(`[TAYPI] interpretado como:`, JSON.stringify(summary));
  }

  async createCharge(params: CreateChargeParams): Promise<ProviderCharge> {
    const data: Json = await this.call(() =>
      this.client.createPayment(
        {
          amount: (params.amountCents / 100).toFixed(2),
          reference: params.reference,
          description: params.description,
          metadata: { source: 'perupos' },
        },
        params.idempotencyKey,
      ),
    );
    return this.parse('createPayment', data);
  }

  async getCharge(providerPaymentId: string): Promise<ProviderCharge> {
    return this.parse('getPayment', await this.call(() => this.client.getPayment(providerPaymentId)));
  }

  async cancelCharge(providerPaymentId: string, idempotencyKey: string): Promise<ProviderCharge> {
    return this.parse('cancelPayment', await this.call(() => this.client.cancelPayment(providerPaymentId, idempotencyKey)));
  }

  private parse(kind: string, data: Json): ProviderCharge {
    try {
      const charge = toCharge(data);
      this.logRaw(kind, data, charge);
      return charge;
    } catch (err) {
      this.logRaw(kind, data);
      throw err;
    }
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookUpdate | null {
    const signature = headers['taypi-signature'];
    if (!this.webhookSecret || typeof signature !== 'string') return null;
    if (!this.client.verifyWebhook(rawBody, signature, this.webhookSecret)) return null;
    const event = JSON.parse(rawBody) as Json;
    this.logRaw('webhook', event);
    const data = (typeof event.data === 'object' && event.data ? event.data : event) as Json;
    const charge = toCharge(data);
    // Algunos webhooks indican el estado en el tipo de evento ("payment.completed").
    const type = typeof event.type === 'string' ? event.type : typeof event.event === 'string' ? event.event : '';
    const status = charge.status === 'PENDING' && type ? mapStatus(type.split('.').pop() ?? '') : charge.status;
    return {
      providerPaymentId: charge.providerPaymentId,
      status,
      paidAt: charge.paidAt ?? (status === 'PAID' ? new Date() : null),
      wallet: charge.wallet,
      raw: event,
    };
  }

  /**
   * Solo para pruebas: arma y firma un webhook como lo haría TAYPI, para
   * probar la verificación de firma y el registro del pago sin escanear el QR.
   * El FORMATO del evento es una suposición (el SDK no lo documenta): si el
   * webhook real llega distinto, el log "[TAYPI] respuesta cruda de webhook" lo mostrará.
   */
  signTestWebhook(providerPaymentId: string, status: string, wallet: string): { body: string; signature: string } | null {
    if (!this.webhookSecret) return null;
    const body = JSON.stringify({
      type: `payment.${status}`,
      data: { id: providerPaymentId, status, wallet, paid_at: status === 'completed' ? new Date().toISOString() : null },
    });
    return { body, signature: 'sha256=' + createHmac('sha256', this.webhookSecret).update(body).digest('hex') };
  }

  private async call(fn: () => Promise<Json>): Promise<Json> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof TaypiError) {
        // El mensaje de TAYPI ya viene en español ("El monto mínimo es S/ 1.00").
        const status = err.httpCode >= 400 && err.httpCode < 500 ? 400 : 502;
        throw new HttpError(status, `Yape/Plin: ${err.message}`, `TAYPI_${err.errorCode}`);
      }
      throw err;
    }
  }
}

function pick(data: Json, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = key.split('.').reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Json)[part] : undefined),
      data,
    );
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asDate(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapStatus(status: string): ChargeStatus {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'paid':
    case 'succeeded':
    case 'approved':
      return 'PAID';
    case 'expired':
      return 'EXPIRED';
    case 'cancelled':
    case 'canceled':
      return 'CANCELLED';
    case 'failed':
    case 'rejected':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function toCharge(data: Json): ProviderCharge {
  const id = pick(data, 'id', 'payment_id', 'uuid');
  if (typeof id !== 'string') throw new HttpError(502, 'TAYPI no devolvió el id del pago.', 'TAYPI_RESPUESTA');
  const qrPayload = pick(data, 'qr_string', 'qr_code', 'qr_data', 'qr.payload', 'qr.data', 'qr');
  const qrImage = pick(data, 'qr_image', 'qr_image_url', 'qr_url', 'qr.image');
  const wallet = pick(data, 'wallet', 'payment_method', 'source', 'paid_with');
  return {
    providerPaymentId: id,
    status: mapStatus(String(pick(data, 'status') ?? 'pending')),
    qrPayload: typeof qrPayload === 'string' ? qrPayload : null,
    qrImageUrl: typeof qrImage === 'string' ? qrImage : null,
    checkoutUrl: typeof pick(data, 'checkout_url') === 'string' ? (pick(data, 'checkout_url') as string) : null,
    expiresAt: asDate(pick(data, 'expires_at', 'expiration', 'qr_expires_at')),
    paidAt: asDate(pick(data, 'paid_at', 'completed_at')),
    wallet: typeof wallet === 'string' ? wallet : null,
    raw: data,
  };
}
