import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, customer, pool, product, randomUUID, resetDb, saleInput, tokens } from './helpers.js';
import { evaluateAlerts } from '../src/services/alerts.js';
import { emitPendingDocuments } from '../src/services/pse/emitter.js';

let t: Awaited<ReturnType<typeof tokens>>;

beforeAll(async () => {
  await resetDb();
  t = await tokens();
});

afterAll(async () => {
  await pool.end();
});

describe('roles y permisos', () => {
  it('el vendedor no ve reportes financieros ni configuración', async () => {
    expect((await api.get('/agent/dashboard', t.vendedor)).status).toBe(403);
    expect((await api.get('/bank-accounts', t.vendedor)).status).toBe(403);
    expect((await api.get('/users', t.vendedor)).status).toBe(403);
  });

  it('el agente financiero no vende ni toca inventario', async () => {
    const arroz = await product('Arroz');
    const res = await api.post('/sales', t.agente, saleInput({
      items: [{ productId: arroz.id, quantity: 1, unitPriceCents: arroz.price_cents }],
      payments: [{ method: 'CASH', amountCents: arroz.price_cents }],
    }));
    expect(res.status).toBe(403);
    expect((await api.patch(`/products/${arroz.id}`, t.agente, { stock: 100 })).status).toBe(403);
    expect((await api.get('/agent/dashboard', t.agente)).status).toBe(200);
  });

  it('el login avisa si se eligió otro rol', async () => {
    const res = await api.post('/auth/login', '', { username: 'carlos', secret: '1111', role: 'ADMIN' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ROL_DISTINTO');
  });

  it('bloquea el usuario tras 5 PIN incorrectos', async () => {
    await api.post('/users', t.admin, { name: 'Prueba', username: 'prueba', role: 'VENDEDOR', secret: '4321' });
    for (let i = 0; i < 5; i++) await api.post('/auth/login', '', { username: 'prueba', secret: '0000' });
    const res = await api.post('/auth/login', '', { username: 'prueba', secret: '4321' });
    expect(res.status).toBe(429);
  });
});

describe('venta con pago mixto', () => {
  it('efectivo + Yape por QR interoperable, con vuelto e IGV', async () => {
    const aceite = await product('Primor');
    const sale = saleInput({
      items: [{ productId: aceite.id, quantity: 5, unitPriceCents: 1090 }],
      payments: [],
      docType: 'BOLETA',
    });
    const charge = await api.post('/payments/qr', t.vendedor, { amountCents: 2000, reference: sale.id });
    expect(charge.status).toBe(201);
    expect(charge.body.qrPayload).toBeTruthy();
    const expiresIn = new Date(charge.body.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(100_000);
    expect(expiresIn).toBeLessThanOrEqual(120_000);

    // Aún no pagado: la venta se rechaza.
    sale.payments = [
      { method: 'CASH', amountCents: 3450, tenderedCents: 5000 },
      { method: 'YAPE', amountCents: 2000, confirmation: 'QR', chargeId: charge.body.id },
    ];
    expect((await api.post('/sales', t.vendedor, sale)).body.code).toBe('QR_NO_PAGADO');

    await api.post(`/payments/qr/${charge.body.id}/simulate`, t.vendedor, { wallet: 'YAPE' });
    const res = await api.post('/sales', t.vendedor, sale);
    expect(res.status).toBe(201);
    expect(res.body.totalCents).toBe(5450);
    expect(res.body.changeCents).toBe(1550);
    expect(res.body.igvCents).toBe(831);
    expect(res.body.serie).toBe('B001');
    expect(res.body.payments.map((p: { method: string }) => p.method)).toEqual(['CASH', 'YAPE']);

    // El mismo pago de Yape no se puede usar en otra venta.
    const again = saleInput({
      items: [{ productId: aceite.id, quantity: 1, unitPriceCents: 1090 }],
      payments: [
        { method: 'CASH', amountCents: 90 },
        { method: 'YAPE', amountCents: 1000, confirmation: 'QR', chargeId: charge.body.id },
      ],
    });
    expect((await api.post('/sales', t.vendedor, again)).body.code).toBe('QR_MONTO_DISTINTO');
  });

  it('no permite reutilizar un QR ya usado', async () => {
    const leche = await product('Gloria');
    const first = saleInput({ items: [{ productId: leche.id, quantity: 1, unitPriceCents: 450 }], payments: [] });
    const charge = await api.post('/payments/qr', t.vendedor, { amountCents: 450, reference: first.id });
    await api.post(`/payments/qr/${charge.body.id}/simulate`, t.vendedor, {});
    first.payments = [{ method: 'PLIN', amountCents: 450, confirmation: 'QR', chargeId: charge.body.id }];
    expect((await api.post('/sales', t.vendedor, first)).status).toBe(201);
    const second = { ...first, id: randomUUID() };
    expect((await api.post('/sales', t.vendedor, second)).body.code).toBe('QR_YA_USADO');
  });

  it('rechaza QR por menos de S/ 1.00 y montos que no cuadran', async () => {
    expect((await api.post('/payments/qr', t.vendedor, { amountCents: 50, reference: randomUUID() })).body.code).toBe('MONTO_MINIMO');
    const pan = await product('Pan');
    const res = await api.post('/sales', t.vendedor, saleInput({
      items: [{ productId: pan.id, quantity: 10, unitPriceCents: 30 }],
      payments: [{ method: 'CASH', amountCents: 200 }],
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Faltan S/ 1.00');
  });

  it('es idempotente: reenviar la venta no la duplica ni descuenta stock dos veces', async () => {
    const inca = await product('Inca Kola 500');
    const sale = saleInput({
      items: [{ productId: inca.id, quantity: 2, unitPriceCents: 300 }],
      payments: [{ method: 'CASH', amountCents: 600, tenderedCents: 1000 }],
    });
    const a = await api.post('/sales', t.vendedor, sale);
    const b = await api.post('/sales', t.vendedor, sale);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.number).toBe(a.body.number);
    expect(Number((await product('Inca Kola 500')).stock)).toBe(Number(inca.stock) - 2);
  });

  it('vende a granel por kilo y no cobra IGV a lo exonerado', async () => {
    const papa = await product('Papa');
    const res = await api.post('/sales', t.vendedor, saleInput({
      items: [{ productId: papa.id, quantity: 1.5, unitPriceCents: 450 }],
      payments: [{ method: 'CASH', amountCents: 675 }],
    }));
    expect(res.status).toBe(201);
    expect(res.body.exoneradaCents).toBe(675);
    expect(res.body.igvCents).toBe(0);
  });
});

describe('precios y descuentos', () => {
  it('el vendedor no puede cambiar precios', async () => {
    const atun = await product('Atún');
    const res = await api.post('/sales', t.vendedor, saleInput({
      items: [{ productId: atun.id, quantity: 1, unitPriceCents: 100 }],
      payments: [{ method: 'CASH', amountCents: 100 }],
    }));
    expect(res.status).toBe(403);
  });

  it('acepta el precio anterior en ventas hechas sin internet', async () => {
    const sal = await product('Sal');
    await api.patch(`/products/${sal.id}`, t.admin, { priceCents: 250 });
    const res = await api.post('/sales', t.vendedor, saleInput({
      items: [{ productId: sal.id, quantity: 1, unitPriceCents: 200 }],
      payments: [{ method: 'CASH', amountCents: 200 }],
    }));
    expect(res.status).toBe(201);
  });

  it('descuento > 10 % necesita autorización del Admin para esa venta', async () => {
    const cafe = await product('Café');
    const sale = saleInput({
      items: [{ productId: cafe.id, quantity: 1, unitPriceCents: 990 }],
      payments: [{ method: 'CASH', amountCents: 790 }],
      discountCents: 200,
    });
    const denied = await api.post('/sales', t.vendedor, sale);
    expect(denied.body.code).toBe('REQUIERE_AUTORIZACION');

    // Un vendedor no puede autorizarse a sí mismo.
    expect((await api.post('/auth/authorize', t.vendedor, { username: 'carlos', secret: '1111', purpose: 'DISCOUNT', saleId: sale.id })).status).toBe(403);

    const auth = await api.post('/auth/authorize', t.vendedor, { username: 'admin', secret: '1234', purpose: 'DISCOUNT', saleId: sale.id });
    expect(auth.status).toBe(200);
    // El token solo sirve para esa venta.
    const other = { ...sale, id: randomUUID(), authorizationToken: auth.body.authorizationToken };
    expect((await api.post('/sales', t.vendedor, other)).body.code).toBe('REQUIERE_AUTORIZACION');
    const ok = await api.post('/sales', t.vendedor, { ...sale, authorizationToken: auth.body.authorizationToken });
    expect(ok.status).toBe(201);
    expect(ok.body.discountCents).toBe(200);

    const small = saleInput({
      items: [{ productId: cafe.id, quantity: 1, unitPriceCents: 990 }],
      payments: [{ method: 'CASH', amountCents: 900 }],
      discountCents: 90,
    });
    expect((await api.post('/sales', t.vendedor, small)).status).toBe(201);
  });
});

describe('fiado y abonos', () => {
  it('bloquea el fiado sobre el límite salvo autorización del Admin', async () => {
    const maria = await customer('María');
    const aceite = await product('Primor');
    const sale = saleInput({
      items: [{ productId: aceite.id, quantity: 1, unitPriceCents: 1090 }],
      payments: [{ method: 'FIADO', amountCents: 1090 }],
      customerId: maria.id,
    });
    const denied = await api.post('/sales', t.vendedor, sale);
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe('LIMITE_CREDITO');
    expect(denied.body.error).toContain('S/ 46.00');

    const auth = await api.post('/auth/authorize', t.vendedor, { username: 'admin', secret: '1234', purpose: 'CREDIT', saleId: sale.id });
    const ok = await api.post('/sales', t.vendedor, { ...sale, authorizationToken: auth.body.authorizationToken });
    expect(ok.status).toBe(201);

    const detail = await api.get(`/customers/${maria.id}`, t.vendedor);
    expect(detail.body.customer.balanceCents).toBe(4600 + 1090);
    expect(detail.body.ledger[0].kind).toBe('FIADO');
  });

  it('fiado dentro del límite + abono con constancia de saldo', async () => {
    const pedro = await customer('Pedro');
    const leche = await product('Gloria');
    const sale = saleInput({
      items: [{ productId: leche.id, quantity: 4, unitPriceCents: 450 }],
      payments: [{ method: 'CASH', amountCents: 800 }, { method: 'FIADO', amountCents: 1000 }],
      customerId: pedro.id,
    });
    expect((await api.post('/sales', t.vendedor, sale)).status).toBe(201);

    const abono = { id: randomUUID(), customerId: pedro.id, amountCents: 600, method: 'CASH', createdAt: new Date().toISOString() };
    const res = await api.post('/abonos', t.vendedor, abono);
    expect(res.status).toBe(201);
    expect(res.body.previousBalanceCents).toBe(1000);
    expect(res.body.balanceCents).toBe(400);
    // Reenviar el abono no lo duplica.
    expect((await api.post('/abonos', t.vendedor, abono)).body.balanceCents).toBe(400);

    const tooMuch = await api.post('/abonos', t.vendedor, { ...abono, id: randomUUID(), amountCents: 5000 });
    expect(tooMuch.body.code).toBe('ABONO_MAYOR');
  });

  it('lista deudas por monto y filtra las vencidas', async () => {
    const byAmount = await api.get('/customers?withDebt=1&sort=amount', t.vendedor);
    const balances = byAmount.body.map((c: { balanceCents: number }) => c.balanceCents);
    expect(balances).toEqual([...balances].sort((a, b) => b - a));
    const overdue = await api.get('/customers?overdue=1', t.vendedor);
    expect(overdue.body.map((c: { name: string }) => c.name)).toEqual(['Juan Pérez']);
  });

  it('solo el Admin cambia el límite de crédito', async () => {
    const juan = await customer('Juan');
    expect((await api.patch(`/customers/${juan.id}`, t.vendedor, { creditLimitCents: 99999 })).status).toBe(403);
    const res = await api.patch(`/customers/${juan.id}`, t.admin, { creditLimitCents: 15000 });
    expect(res.body.creditLimitCents).toBe(15000);
  });
});

describe('anulación', () => {
  it('solo el Admin anula; se devuelve el stock y se revierte el fiado', async () => {
    const carmen = await customer('Carmen');
    const huevos = await product('Huevos');
    const sale = saleInput({
      items: [{ productId: huevos.id, quantity: 10, unitPriceCents: 60 }],
      payments: [{ method: 'FIADO', amountCents: 600 }],
      customerId: carmen.id,
    });
    await api.post('/sales', t.vendedor, sale);
    expect((await api.post(`/sales/${sale.id}/void`, t.vendedor, { reason: 'Error de digitación' })).status).toBe(403);
    const res = await api.post(`/sales/${sale.id}/void`, t.admin, { reason: 'Error de digitación' });
    expect(res.body.status).toBe('VOIDED');
    expect(Number((await product('Huevos')).stock)).toBe(Number(huevos.stock));
    expect((await api.get(`/customers/${carmen.id}`, t.admin)).body.customer.balanceCents).toBe(2350);
  });
});

describe('sincronización offline', () => {
  it('sube cliente nuevo + venta fiada + abono hechos sin internet, e ignora reenvíos', async () => {
    const pan = await product('Pan');
    const customerId = randomUUID();
    const payload = {
      customers: [{ id: customerId, name: 'Vecina Rosa', phone: '987000111' }],
      sales: [
        saleInput({
          items: [{ productId: pan.id, quantity: 10, unitPriceCents: 30 }],
          payments: [{ method: 'FIADO', amountCents: 300 }],
          customerId,
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        }),
        // Un precio inventado: falla sin afectar a los demás.
        saleInput({ items: [{ productId: pan.id, quantity: 1, unitPriceCents: 1 }], payments: [{ method: 'CASH', amountCents: 1 }] }),
      ],
      abonos: [{ id: randomUUID(), customerId, amountCents: 100, method: 'YAPE', confirmation: 'MANUAL', createdAt: new Date().toISOString() }],
    };
    const res = await api.post('/sync/push', t.vendedor, payload);
    const results = res.body.results;
    expect(results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, false, true]);
    expect(results[2].permanent).toBe(true);
    expect(results[3].data.balanceCents).toBe(200);

    const retry = await api.post('/sync/push', t.vendedor, payload);
    expect(retry.body.results[1].data.number).toBe(results[1].data.number);
    expect((await api.get(`/customers/${customerId}`, t.vendedor)).body.customer.balanceCents).toBe(200);
  });

  it('pull devuelve solo lo que cambió', async () => {
    const full = await api.get('/sync/pull', t.vendedor);
    expect(full.body.products).toHaveLength(20);
    expect(full.body.settings.ruc).toBe('20123456786');
    const since = full.body.serverTime;
    const aceite = await product('Primor');
    await api.patch(`/products/${aceite.id}`, t.admin, { minStock: 7 });
    const delta = await api.get(`/sync/pull?since=${encodeURIComponent(since)}`, t.vendedor);
    expect(delta.body.products.map((p: { name: string }) => p.name)).toEqual([aceite.name]);
  });
});

describe('alertas, agente y caja', () => {
  it('abre la alerta de stock bajo y la cierra al reponer', async () => {
    await evaluateAlerts();
    let alerts = (await api.get('/alerts', t.vendedor)).body;
    expect(alerts.some((a: { type: string; title: string }) => a.type === 'STOCK_BAJO' && a.title.includes('Arroz'))).toBe(true);
    // El vendedor no ve alertas solo para el Admin.
    expect(alerts.some((a: { type: string }) => a.type === 'LIMITE_CREDITO')).toBe(false);

    const arroz = await product('Arroz');
    await api.post(`/products/${arroz.id}/restock`, t.admin, { quantity: 50 });
    await evaluateAlerts();
    alerts = (await api.get('/alerts', t.admin)).body;
    expect(alerts.some((a: { type: string; title: string }) => a.type === 'STOCK_BAJO' && a.title.includes('Arroz'))).toBe(false);
  });

  it('el agente envía una recomendación al Admin y al Vendedor', async () => {
    const res = await api.post('/notifications', t.agente, {
      title: 'Reponer arroz',
      body: 'Quedan 5 kg y es tu producto más vendido.',
      targetRoles: ['ADMIN', 'VENDEDOR'],
    });
    expect(res.status).toBe(201);
    const inbox = await api.get('/notifications', t.vendedor);
    expect(inbox.body[0].title).toBe('Reponer arroz');
    expect(inbox.body[0].fromName).toBe('Lucía Torres');
  });

  it('cuadre de caja: apertura + efectivo de ventas + abonos - retiros', async () => {
    await api.post('/cash/open', t.vendedor, { openingCents: 5000 });
    const pan = await product('Pan');
    await api.post('/sales', t.vendedor, saleInput({
      items: [{ productId: pan.id, quantity: 10, unitPriceCents: 30 }],
      payments: [{ method: 'CASH', amountCents: 300, tenderedCents: 1000 }],
    }));
    await api.post('/cash/movements', t.vendedor, { kind: 'OUT', amountCents: 2000, reason: 'Pago al proveedor de pan' });
    const current = await api.get('/cash/current', t.vendedor);
    expect(current.body.expectedCents).toBe(5000 + 300 - 2000);

    await evaluateAlerts();
    const alerts = (await api.get('/alerts', t.agente)).body;
    expect(alerts.some((a: { type: string }) => a.type === 'CAJA_BAJA')).toBe(true);

    const closed = await api.post('/cash/close', t.vendedor, { countedCents: 3200 });
    expect(closed.body.differenceCents).toBe(-100);
  });

  it('tablero del agente con proyección, top y mapa de calor', async () => {
    const res = await api.get('/agent/dashboard', t.agente);
    expect(res.status).toBe(200);
    expect(res.body.summary.salesCount).toBeGreaterThan(0);
    expect(res.body.projection.nextDays).toHaveLength(7);
    expect(res.body.heatmap.matrix).toHaveLength(7);
    expect(res.body.cashflow.week).toHaveLength(8);
    expect(res.body.topProducts.length).toBeGreaterThan(0);
  });
});

describe('comprobantes', () => {
  it('emite las boletas pendientes con el PSE', async () => {
    const accepted = await emitPendingDocuments();
    expect(accepted).toBeGreaterThan(0);
    const row = (await pool.query("SELECT sunat_status, sunat_qr FROM sales WHERE serie = 'B001' LIMIT 1")).rows[0];
    expect(row.sunat_status).toBe('ACEPTADO');
    expect(row.sunat_qr).toMatch(/^20123456786\|03\|B001\|1\|8\.31\|54\.50\|/);
  });

  it('exige RUC válido para factura y DNI para boletas > S/ 700', async () => {
    const aceite = await product('Primor');
    const factura = saleInput({
      items: [{ productId: aceite.id, quantity: 1, unitPriceCents: 1090 }],
      payments: [{ method: 'CASH', amountCents: 1090 }],
      docType: 'FACTURA',
      buyer: { docType: 'RUC', docNumber: '20100070971', name: 'X' },
    });
    expect((await api.post('/sales', t.vendedor, factura)).body.code).toBe('COMPRADOR_INVALIDO');
    factura.buyer = { docType: 'RUC', docNumber: '20100070970', name: 'Cliente SAC' };
    const ok = await api.post('/sales', t.vendedor, factura);
    expect(ok.body.serie).toBe('F001');

    const big = saleInput({
      items: [{ productId: aceite.id, quantity: 70, unitPriceCents: 1090 }],
      payments: [{ method: 'CASH', amountCents: 76300 }],
      docType: 'BOLETA',
    });
    expect((await api.post('/sales', t.vendedor, big)).body.code).toBe('COMPRADOR_INVALIDO');
  });

  it('exporta el registro de ventas para el SIRE', async () => {
    const now = new Date(Date.now() - 5 * 3_600_000);
    const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect((await api.get(`/reports/sire?period=${period}`, t.vendedor)).status).toBe(403);
    const res = await api.get(`/reports/sire?period=${period}`, t.admin);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain(`LE20123456786${period}0014040002`);
    const lines = res.text.trim().split('\r\n');
    expect(lines.length).toBe(Number(res.headers['x-sire-rows']));
    const boleta = lines.find((l) => l.includes('|03|B001|1|'))!;
    expect(boleta.split('|')).toHaveLength(40);
    expect(boleta).toContain('|46.19|0.00|8.31|');
  });

  it('el ticket en texto sale con desglose de pagos', async () => {
    const row = (await pool.query("SELECT id FROM sales WHERE serie = 'B001' AND correlativo = 1")).rows[0];
    const res = await api.get(`/sales/${row.id}/receipt`, t.admin);
    expect(res.text).toContain('RUC 20123456786');
    expect(res.text).toMatch(/Yape\s+S\/ 20\.00/);
  });
});
