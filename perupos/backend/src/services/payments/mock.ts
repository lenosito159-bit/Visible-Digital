import { randomUUID } from 'node:crypto';
import type { ChargeStatus } from '@perupos/shared';
import { config } from '../../config.js';
import type { CreateChargeParams, ProviderCharge, QrProvider, WebhookUpdate } from './provider.js';

interface MockCharge {
  id: string;
  amountCents: number;
  status: ChargeStatus;
  createdAt: number;
  paidAt: Date | null;
}

/**
 * Proveedor de prueba: genera QRs que no cobran de verdad. Sirve para
 * practicar el flujo sin credenciales. Para "pagar" un QR usa
 * POST /payments/qr/:id/simulate o define MOCK_AUTOPAY_SECONDS.
 */
export class MockQrProvider implements QrProvider {
  readonly name = 'mock';
  private charges = new Map<string, MockCharge>();
  private byKey = new Map<string, string>();

  async createCharge(params: CreateChargeParams): Promise<ProviderCharge> {
    const existing = this.byKey.get(params.idempotencyKey);
    if (existing) return this.getCharge(existing);
    const charge: MockCharge = {
      id: `mock_${randomUUID()}`,
      amountCents: params.amountCents,
      status: 'PENDING',
      createdAt: Date.now(),
      paidAt: null,
    };
    this.charges.set(charge.id, charge);
    this.byKey.set(params.idempotencyKey, charge.id);
    return this.view(charge);
  }

  async getCharge(id: string): Promise<ProviderCharge> {
    const charge = this.charges.get(id);
    if (!charge) {
      // El servidor se reinició y el mock perdió su memoria: el QR ya no es pagable.
      return { ...this.emptyView(id), status: 'EXPIRED' };
    }
    const autopay = config.MOCK_AUTOPAY_SECONDS;
    if (charge.status === 'PENDING' && autopay > 0 && Date.now() - charge.createdAt >= autopay * 1000) {
      charge.status = 'PAID';
      charge.paidAt = new Date();
    }
    return this.view(charge);
  }

  async cancelCharge(id: string): Promise<ProviderCharge> {
    const charge = this.charges.get(id);
    if (charge && charge.status === 'PENDING') charge.status = 'CANCELLED';
    return charge ? this.view(charge) : { ...this.emptyView(id), status: 'CANCELLED' };
  }

  /** Simula que el cliente pagó desde Yape o Plin. */
  simulatePayment(id: string, wallet = 'YAPE'): boolean {
    const charge = this.charges.get(id);
    if (!charge || charge.status !== 'PENDING') return false;
    charge.status = 'PAID';
    charge.paidAt = new Date();
    this.wallets.set(id, wallet);
    return true;
  }

  private wallets = new Map<string, string>();

  parseWebhook(): WebhookUpdate | null {
    return null;
  }

  private view(c: MockCharge): ProviderCharge {
    return {
      providerPaymentId: c.id,
      status: c.status,
      qrPayload: `PERUPOS-PRUEBA|${c.id}|${(c.amountCents / 100).toFixed(2)}|PEN`,
      qrImageUrl: null,
      checkoutUrl: null,
      expiresAt: null,
      paidAt: c.paidAt,
      wallet: this.wallets.get(c.id) ?? (c.status === 'PAID' ? 'YAPE' : null),
      raw: { mock: true },
    };
  }

  private emptyView(id: string): ProviderCharge {
    return {
      providerPaymentId: id,
      status: 'PENDING',
      qrPayload: null,
      qrImageUrl: null,
      checkoutUrl: null,
      expiresAt: null,
      paidAt: null,
      wallet: null,
      raw: { mock: true },
    };
  }
}
