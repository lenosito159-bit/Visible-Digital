import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, customer, pool, product, randomUUID, resetDb, saleInput, tokens } from './helpers.js';

/**
 * Casos reales de bodega peruana: pagos mixtos, fiado parcial, yapeos de
 * más, abonos por Yape/Plin, reuso de pagos y cierre de caja.
 */
let t: Awaited<ReturnType<typeof tokens>>;
let items50: { productId: string; quantity: number; unitPriceCents: number }[];
let items32: typeof items50;
let items80: typeof items50;

beforeAll(async () => {
  await resetDb();
  t = await tokens();
  const [pilsen, inca, coca, primor, leche, pan] = await Promise.all(
    ['Pilsen', 'Inca Kola 1.5', 'Coca-Cola', 'Primor', 'Gloria', 'Pan'].map(product),
  );
  // Pilsen ×4 (30.00) + Inca Kola 1.5 L ×2 (14.00) + Coca-Cola ×2 (6.00) = S/ 50.00
  items50 = [
    { productId: pilsen.id, quantity: 4, unitPriceCents: 750 },
    { productId: inca.id, quantity: 2, unitPriceCents: 700 },
    { productId: coca.id, quantity: 2, unitPriceCents: 300 },
  ];
  // Pilsen ×8 (60.00) + Inca Kola 1.5 L ×2 + Coca-Cola ×2 = S/ 80.00
  items80 = [{ ...items50[0]!, quantity: 8 }, items50[1]!, items50[2]!];
  // Primor ×2 (21.80) + Leche ×2 (9.00) + Pan ×4 (1.20) = S/ 32.00
  items32 = [
    { productId: primor.id, quantity: 2, unitPriceCents: 1090 },
    { productId: leche.id, quantity: 2, unitPriceCents: 450 },
    { productId: pan.id, quantity: 4, unitPriceCents: 30 },
  ];
  await api.post('/cash/open', t.vendedor, { openingCents: 10000 });
});

afterAll(async () => {
  await pool.end();
});

async function paidCharge(amountCents: number, reference: string, wallet: 'YAPE' | 'PLIN' = 'YAPE'): Promise<string> {
  const charge = await api.post('/payments/qr', t.vendedor, { amountCents, reference });
  expect(charge.status).toBe(201);
  await api.post(`/payments/qr/${charge.body.id}/simulate`, t.vendedor, { wallet });
  return charge.body.id;
}

const balance = async (id: string) => (await api.get(`/customers/${id}`, t.admin)).body.customer.balanceCents as number;

describe('pagos mixtos de bodega', () => {
  it('"te doy 20 en efectivo, pero te paso 30" en una parte de 20: el vuelto es 10, no 30', async () => {
    const sale = saleInput({ items: items50, payments: [] });
    const chargeId = await paidCharge(3000, sale.id);
    sale.payments = [
      { method: 'CASH', amountCents: 2000, tenderedCents: 3000 },
      { method: 'YAPE', amountCents: 3000, confirmation: 'QR', chargeId },
    ];
    const res = await api.post('/sales', t.vendedor, sale);
    expect(res.status).toBe(201);
    expect(res.body.changeCents).toBe(1000);
  });

  it('fiado parcial: "lleva 80, me da 30 y los 50 apúntamelos"', async () => {
    const juan = await customer('Juan');
    const before = await balance(juan.id);
    const res = await api.post('/sales', t.vendedor, saleInput({
      items: items80,
      payments: [
        { method: 'CASH', amountCents: 3000 },
        { method: 'FIADO', amountCents: 5000 },
      ],
      customerId: juan.id,
    }));
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(8000);
    expect(await balance(juan.id)).toBe(before + 5000);
  });

  it('triple: "10 en efectivo, 20 te yapeo y 20 apúntamelo"', async () => {
    const pedro = await customer('Pedro');
    const sale = saleInput({ items: items50, payments: [], customerId: pedro.id });
    const chargeId = await paidCharge(2000, sale.id);
    sale.payments = [
      { method: 'CASH', amountCents: 1000, tenderedCents: 2000 },
      { method: 'YAPE', amountCents: 2000, confirmation: 'QR', chargeId },
      { method: 'FIADO', amountCents: 2000 },
    ];
    const res = await api.post('/sales', t.vendedor, sale);
    expect(res.status).toBe(201);
    expect(res.body.payments.map((p: { method: string; amountCents: number }) => `${p.method}:${p.amountCents}`)).toEqual([
      'CASH:1000',
      'YAPE:2000',
      'FIADO:2000',
    ]);
    expect(res.body.changeCents).toBe(1000);
    expect(await balance(pedro.id)).toBe(2000);
  });

  it('"te yapeo 40, dame el vuelto": QR por 40, vuelto de 8 en efectivo', async () => {
    const sale = saleInput({ items: items32, payments: [] });
    // Un QR por el monto justo (32) no sirve para un pago de 40.
    const exact = await paidCharge(3200, sale.id);
    sale.payments = [{ method: 'YAPE', amountCents: 3200, tenderedCents: 4000, confirmation: 'QR', chargeId: exact }];
    expect((await api.post('/sales', t.vendedor, sale)).body.code).toBe('QR_MONTO_DISTINTO');

    const chargeId = await paidCharge(4000, sale.id);
    sale.payments = [{ method: 'YAPE', amountCents: 3200, tenderedCents: 4000, confirmation: 'QR', chargeId }];
    const res = await api.post('/sales', t.vendedor, sale);
    expect(res.status).toBe(201);
    expect(res.body.changeCents).toBe(800);
    expect(res.body.payments[0]).toMatchObject({ method: 'YAPE', amountCents: 3200, tenderedCents: 4000, changeCents: 800 });
    const receipt = await api.get(`/sales/${sale.id}/receipt`, t.vendedor);
    expect(receipt.text).toMatch(/Recibido\s+S\/ 40\.00/);
    expect(receipt.text).toMatch(/VUELTO\s+S\/ 8\.00/);
  });

  it('el mismo QR sirve para Yape y Plin: si pagan con Plin, se anota Plin', async () => {
    const sale = saleInput({ items: items32, payments: [] });
    const chargeId = await paidCharge(3200, sale.id, 'PLIN');
    sale.payments = [{ method: 'YAPE', amountCents: 3200, confirmation: 'QR', chargeId }];
    const res = await api.post('/sales', t.vendedor, sale);
    expect(res.body.payments[0].method).toBe('PLIN');
  });
});

describe('abonos por Yape y Plin', () => {
  it('abono parcial con Plin por QR: queda con el método correcto y el saldo', async () => {
    const maria = await customer('María');
    const before = await balance(maria.id);
    const id = randomUUID();
    const chargeId = await paidCharge(2000, id, 'PLIN');
    const res = await api.post('/abonos', t.vendedor, {
      id,
      customerId: maria.id,
      amountCents: 2000,
      method: 'YAPE',
      confirmation: 'QR',
      chargeId,
      createdAt: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.method).toBe('PLIN');
    expect(res.body.previousBalanceCents).toBe(before);
    expect(res.body.balanceCents).toBe(before - 2000);
    const ledger = (await api.get(`/customers/${maria.id}`, t.vendedor)).body.ledger;
    expect(ledger[0]).toMatchObject({ kind: 'ABONO', method: 'PLIN', amountCents: 2000 });
  });
});

describe('un pago no se puede usar dos veces', () => {
  it('un QR pagado usado en una venta no sirve para un abono de otro cliente', async () => {
    const sale = saleInput({ items: items32, payments: [] });
    const chargeId = await paidCharge(3200, sale.id);
    sale.payments = [{ method: 'YAPE', amountCents: 3200, confirmation: 'QR', chargeId }];
    expect((await api.post('/sales', t.vendedor, sale)).status).toBe(201);

    // Juan debe más de S/ 32, así el único motivo de rechazo es el QR ya usado.
    const juan = await customer('Juan');
    const abono = await api.post('/abonos', t.vendedor, {
      id: randomUUID(),
      customerId: juan.id,
      amountCents: 3200,
      method: 'YAPE',
      confirmation: 'QR',
      chargeId,
      createdAt: new Date().toISOString(),
    });
    expect(abono.status).toBe(409);
    expect(abono.body.code).toBe('QR_YA_USADO');
  });

  it('un QR de abono no sirve para un segundo abono', async () => {
    const carmen = await customer('Carmen');
    const id = randomUUID();
    const chargeId = await paidCharge(500, id);
    const body = { customerId: carmen.id, amountCents: 500, method: 'YAPE', confirmation: 'QR', chargeId, createdAt: new Date().toISOString() };
    expect((await api.post('/abonos', t.vendedor, { ...body, id })).status).toBe(201);
    expect((await api.post('/abonos', t.vendedor, { ...body, id: randomUUID() })).body.code).toBe('QR_YA_USADO');
  });

  it('el N° de operación de un Yape manual no se repite entre ventas ni abonos', async () => {
    const first = saleInput({ items: items32, payments: [{ method: 'YAPE', amountCents: 3200, confirmation: 'MANUAL', reference: '0012 3456' }] });
    const ok = await api.post('/sales', t.vendedor, first);
    expect(ok.status).toBe(201);
    expect(ok.body.payments[0].reference).toBe('00123456');

    const again = saleInput({ items: items32, payments: [{ method: 'YAPE', amountCents: 3200, confirmation: 'MANUAL', reference: '00123456' }] });
    const dup = await api.post('/sales', t.vendedor, again);
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('OPERACION_YA_USADA');
    // La venta rechazada no dejó rastros (ni stock ni cobro).
    expect((await api.get(`/sales/${again.id}`, t.admin)).status).toBe(404);

    const carmen = await customer('Carmen');
    const abono = await api.post('/abonos', t.vendedor, {
      id: randomUUID(),
      customerId: carmen.id,
      amountCents: 100,
      method: 'YAPE',
      confirmation: 'MANUAL',
      reference: '0012-3456',
      createdAt: new Date().toISOString(),
    });
    expect(abono.body.code).toBe('OPERACION_YA_USADA');

    // El mismo número en Plin es otra operación (otra app).
    const plin = saleInput({ items: items32, payments: [{ method: 'PLIN', amountCents: 3200, confirmation: 'MANUAL', reference: '00123456' }] });
    expect((await api.post('/sales', t.vendedor, plin)).status).toBe(201);
  });
});

describe('clientes', () => {
  it('Don/Doña y "siempre paga / le cuesta pagar" los marca el vendedor', async () => {
    const pedro = await customer('Pedro');
    const res = await api.patch(`/customers/${pedro.id}`, t.vendedor, { reputation: 'CUMPLIDO', trato: 'DON' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reputation: 'CUMPLIDO', trato: 'DON' });
    const cleared = await api.patch(`/customers/${pedro.id}`, t.vendedor, { reputation: null });
    expect(cleared.body.reputation).toBeNull();
    expect(cleared.body.trato).toBe('DON');
    const pull = await api.get('/sync/pull', t.vendedor);
    expect(pull.body.customers.find((c: { id: string }) => c.id === pedro.id).trato).toBe('DON');
  });
});

describe('cierre de caja', () => {
  it('desglosa por método, descuenta el vuelto de los yapeos y suma lo yapeado al administrador', async () => {
    const cash = (await api.get('/cash/current', t.vendedor)).body;
    // Efectivo asignado en el turno: 20 + 30 + 10 = 60. Yapeo de más: 8 de vuelto.
    expect(cash.byMethod.CASH).toBe(6000);
    expect(cash.byMethod.YAPE).toBe(3000 + 2000 + 3200 + 3200 + 3200);
    expect(cash.byMethod.PLIN).toBe(3200 + 3200);
    expect(cash.byMethod.FIADO).toBe(5000 + 2000);
    expect(cash.abonosByMethod.PLIN).toBe(2000);
    expect(cash.digitalChangeCents).toBe(800);
    expect(cash.expectedCents).toBe(10000 + 6000 - 800);

    // Faltan S/ 20 en el cajón, pero el vendedor se los yapeó al administrador.
    const closed = await api.post('/cash/close', t.vendedor, { countedCents: 13200, transferredCents: 2000 });
    expect(closed.status).toBe(200);
    expect(closed.body.differenceCents).toBe(0);
    expect(closed.body.transferredCents).toBe(2000);
    const closures = await api.get('/cash/closures', t.agente);
    expect(closures.body[0].sessionId).toBe(cash.sessionId);
  });
});
