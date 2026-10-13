import type { ChargeStatus } from '@perupos/shared';
import { config } from '../../config.js';
import { MockQrProvider } from './mock.js';
import { TaypiQrProvider } from './taypi.js';

export interface CreateChargeParams {
  amountCents: number;
  reference: string;
  description: string;
  /** Protege contra cobros duplicados si la red falla y se reintenta. */
  idempotencyKey: string;
}

export interface ProviderCharge {
  providerPaymentId: string;
  status: ChargeStatus;
  /** Texto del QR (EMVCo) para dibujarlo en el teléfono. */
  qrPayload: string | null;
  /** Imagen del QR generada por el proveedor, si la entrega. */
  qrImageUrl: string | null;
  checkoutUrl: string | null;
  expiresAt: Date | null;
  paidAt: Date | null;
  /** Billetera con la que pagó el cliente (Yape, Plin, BCP...), si se sabe. */
  wallet: string | null;
  raw: unknown;
}

export interface WebhookUpdate {
  providerPaymentId: string;
  status: ChargeStatus;
  paidAt: Date | null;
  wallet: string | null;
  raw: unknown;
}

/** Proveedor de cobros con QR interoperable (un solo QR para Yape, Plin y bancos). */
export interface QrProvider {
  readonly name: string;
  createCharge(params: CreateChargeParams): Promise<ProviderCharge>;
  getCharge(providerPaymentId: string): Promise<ProviderCharge>;
  cancelCharge(providerPaymentId: string, idempotencyKey: string): Promise<ProviderCharge>;
  /** Verifica la firma y traduce el webhook. Devuelve null si la firma no es válida. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookUpdate | null;
}

let instance: QrProvider | null = null;

export function qrProvider(): QrProvider {
  if (!instance) {
    instance =
      config.PAYMENTS_PROVIDER === 'taypi'
        ? new TaypiQrProvider({
            publicKey: config.TAYPI_PUBLIC_KEY!,
            secretKey: config.TAYPI_SECRET_KEY!,
            webhookSecret: config.TAYPI_WEBHOOK_SECRET,
            baseUrl: config.TAYPI_BASE_URL,
            debug: config.TAYPI_DEBUG,
          })
        : new MockQrProvider();
  }
  return instance;
}

/** Solo para tests: reemplaza el proveedor. */
export function setQrProvider(provider: QrProvider | null): void {
  instance = provider;
}
