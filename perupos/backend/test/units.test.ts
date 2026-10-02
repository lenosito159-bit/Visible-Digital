import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Sale } from '@perupos/shared';
import { TaypiQrProvider, mapStatus } from '../src/services/payments/taypi.js';
import { NubefactPse } from '../src/services/pse/nubefact.js';
import { buildRecommendations } from '../src/services/recommendations.js';
import type { ProductStat } from '../src/services/reports.js';

describe('TAYPI', () => {
  const provider = new TaypiQrProvider({
    publicKey: 'taypi_pk_test_x',
    secretKey: 'taypi_sk_test_x',
    webhookSecret: 'whsec_test',
    baseUrl: 'https://sandbox.taypi.pe',
  });

  it('verifica la firma HMAC del webhook', () => {
    const body = JSON.stringify({ type: 'payment.completed', data: { id: 'pay_123', status: 'completed', wallet: 'PLIN' } });
    const signature = 'sha256=' + createHmac('sha256', 'whsec_test').update(body).digest('hex');
    const update = provider.parseWebhook(body, { 'taypi-signature': signature });
    expect(update).toMatchObject({ providerPaymentId: 'pay_123', status: 'PAID', wallet: 'PLIN' });
    expect(provider.parseWebhook(body, { 'taypi-signature': 'sha256=falsa' })).toBeNull();
    expect(provider.parseWebhook(body, {})).toBeNull();
  });

  it('traduce los estados del pago', () => {
    expect(mapStatus('completed')).toBe('PAID');
    expect(mapStatus('expired')).toBe('EXPIRED');
    expect(mapStatus('canceled')).toBe('CANCELLED');
    expect(mapStatus('pending')).toBe('PENDING');
  });
});

describe('Nubefact', () => {
  it('arma la boleta con totales que cuadran', () => {
    const sale = {
      serie: 'B001',
      correlativo: 7,
      docType: 'BOLETA',
      createdAt: '2026-09-30T17:00:00Z',
      items: [
        { productId: 'a', name: 'Aceite', quantity: 2, unit: 'UND', unitPriceCents: 1090, totalCents: 2180, taxAffectation: 'GRAVADO', igvCents: 318 },
        { productId: 'b', name: 'Papa', quantity: 1.5, unit: 'KG', unitPriceCents: 450, totalCents: 675, taxAffectation: 'EXONERADO', igvCents: 0 },
      ],
      discountCents: 0,
      gravadaCents: 1862,
      exoneradaCents: 675,
      inafectaCents: 0,
      igvCents: 318,
      totalCents: 2855,
      buyerDocType: null,
      buyerDocNumber: null,
      buyerName: null,
    } as unknown as Sale;
    const doc = new NubefactPse('https://api.nubefact.com/api/v1/x', 't').buildDocument(sale, 2);
    expect(doc.fecha_de_emision).toBe('30-09-2026');
    expect(doc.cliente_denominacion).toBe('CLIENTES VARIOS');
    expect(doc.items[1].unidad_de_medida).toBe('KGM');
    expect(doc.items[1].tipo_de_igv).toBe(8);
    const sum = doc.items.reduce((a: number, i: { total: number }) => a + i.total, 0);
    expect(sum).toBeCloseTo(doc.total, 2);
  });
});

describe('recomendaciones', () => {
  const stat = (over: Partial<ProductStat>): ProductStat => ({
    productId: 'p',
    name: 'Arroz',
    unitsSold: 0,
    revenueCents: 0,
    stock: 0,
    minStock: 0,
    unit: 'UND',
    avgDailyUnits: 0,
    daysSinceLastSale: 0,
    stockValueCents: 0,
    ...over,
  });
  const emptyMap = { matrix: Array.from({ length: 7 }, () => Array<number>(24).fill(0)), weeks: 4 };

  it('sugiere reponer el más vendido y cobrar al deudor', () => {
    const recs = buildRecommendations({
      top: [stat({ name: 'Arroz', unitsSold: 60, avgDailyUnits: 2, stock: 5, minStock: 10 })],
      slow: [],
      overdue: [{ id: 'c', name: 'Juan Pérez', balanceCents: 4500, days: 40 }],
      heatmap: emptyMap,
      cashInDrawerCents: null,
      cashLowThresholdCents: 5000,
      staleDays: 15,
    });
    expect(recs[0]!.message).toBe('Arroz es tu producto más vendido. Quedan 5 unidades. Considera reponer 25 unidades más.');
    expect(recs[1]!.message).toBe('Juan Pérez tiene una deuda de S/ 45.00 desde hace 40 días. Envía un recordatorio.');
  });

  it('detecta el horario más flojo', () => {
    const matrix = Array.from({ length: 7 }, () => Array<number>(24).fill(1000));
    for (let h = 12; h < 18; h++) matrix[1]![h] = 50;
    const recs = buildRecommendations({
      top: [], slow: [], overdue: [], heatmap: { matrix, weeks: 4 }, cashInDrawerCents: 2000, cashLowThresholdCents: 5000, staleDays: 15,
    });
    expect(recs.map((r) => r.message)).toContain('Tus ventas de los martes por la tarde son las más bajas. Considera una promoción.');
    expect(recs.some((r) => r.kind === 'CAJA')).toBe(true);
  });
});

describe('push', () => {
  it('cada alerta sale por su canal de Android y en lotes de 100', async () => {
    const { buildPushBatches } = await import('../src/services/push.js');
    const { PUSH_CHANNELS, ALERT_TYPES } = await import('@perupos/shared');
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[${i}]`);
    const batches = buildPushBatches(tokens, { title: 'Stock bajo', body: 'Quedan 3', channelId: PUSH_CHANNELS.STOCK_BAJO.id });
    expect(batches.map((b) => b.length)).toEqual([100, 50]);
    expect(batches[0]![0]).toMatchObject({ channelId: 'stock-bajo', sound: 'default', priority: 'high' });
    // Un mensaje del agente sin canal va a "mensajes".
    expect(buildPushBatches(['t'], { title: 'x', body: 'y' })[0]![0]!.channelId).toBe('mensajes');
    // Todas las alertas tienen canal.
    for (const type of ALERT_TYPES) expect(PUSH_CHANNELS[type].id).toBeTruthy();
  });
});
