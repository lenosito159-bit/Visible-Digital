import { describe, expect, it } from 'vitest';
import {
  allocate,
  allowedDocTypes,
  amountInWords,
  buildAbonoReceiptText,
  buildReceiptText,
  can,
  checkCredit,
  checkPayments,
  computeTaxes,
  customerGreetingName,
  fechaPe,
  paydayInfo,
  qrAmount,
  rebalanceAmounts,
  REMINDER_TEMPLATES,
  buildCashCloseText,
  debtReminderMessage,
  discountNeedsAdmin,
  formatSoles,
  isValidEan13,
  isValidRuc,
  normalizePeruMobile,
  parseSoles,
  quickCashOptions,
  suggestNextAmount,
  validateBuyer,
  whatsappLink,
  type BusinessSettings,
  type Sale,
} from '../src/index.js';

describe('dinero', () => {
  it('formatea soles con separador de miles', () => {
    expect(formatSoles(5000)).toBe('S/ 50.00');
    expect(formatSoles(123456)).toBe('S/ 1,234.56');
    expect(formatSoles(-250)).toBe('-S/ 2.50');
  });

  it('entiende lo que escribe el vendedor', () => {
    expect(parseSoles('12')).toBe(1200);
    expect(parseSoles('12.5')).toBe(1250);
    expect(parseSoles('12,50')).toBe(1250);
    expect(parseSoles('S/ 3.20')).toBe(320);
    expect(parseSoles('abc')).toBeNull();
    expect(parseSoles('1.234')).toBeNull();
  });

  it('reparte sin perder céntimos', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts.sort()).toEqual([33, 33, 34]);
  });

  it('escribe el importe en letras', () => {
    expect(amountInWords(5000)).toBe('CINCUENTA CON 00/100 SOLES');
    expect(amountInWords(123456)).toBe('MIL DOSCIENTOS TREINTA Y CUATRO CON 56/100 SOLES');
    expect(amountInWords(10050)).toBe('CIEN CON 50/100 SOLES');
    expect(amountInWords(2100000)).toBe('VEINTIUN MIL CON 00/100 SOLES');
  });
});

describe('IGV', () => {
  it('extrae el 18 % del precio al público', () => {
    const t = computeTaxes([{ totalCents: 11800, taxAffectation: 'GRAVADO' }], 0, 'RMT');
    expect(t.gravadaCents).toBe(10000);
    expect(t.igvCents).toBe(1800);
    expect(t.totalCents).toBe(11800);
  });

  it('no aplica IGV a exonerados ni en el Nuevo RUS', () => {
    const mixed = computeTaxes(
      [
        { totalCents: 590, taxAffectation: 'GRAVADO' },
        { totalCents: 300, taxAffectation: 'EXONERADO' },
      ],
      0,
      'GENERAL',
    );
    expect(mixed.exoneradaCents).toBe(300);
    expect(mixed.gravadaCents + mixed.igvCents + mixed.exoneradaCents).toBe(890);

    const nrus = computeTaxes([{ totalCents: 11800, taxAffectation: 'GRAVADO' }], 0, 'NRUS');
    expect(nrus.igvCents).toBe(0);
    expect(nrus.totalCents).toBe(11800);
  });

  it('reparte el descuento entre las líneas', () => {
    const t = computeTaxes(
      [
        { totalCents: 1000, taxAffectation: 'GRAVADO' },
        { totalCents: 1000, taxAffectation: 'GRAVADO' },
      ],
      200,
      'RMT',
    );
    expect(t.totalCents).toBe(1800);
    expect(t.lines.map((l) => l.totalCents)).toEqual([900, 900]);
    expect(t.gravadaCents + t.igvCents).toBe(1800);
  });
});

describe('pagos mixtos', () => {
  it('ejemplo real: S/ 50 = S/ 30 efectivo (paga con S/ 50) + S/ 20 Yape', () => {
    const check = checkPayments(5000, [
      { method: 'CASH', amountCents: 3000, tenderedCents: 5000 },
      { method: 'YAPE', amountCents: 2000, confirmation: 'QR', chargeId: 'ch_1' },
    ]);
    expect(check.ok).toBe(true);
    expect(check.changeCents).toBe(2000);
    expect(check.remainingCents).toBe(0);
  });

  it('pide confirmar el Yape antes de registrar', () => {
    const payments = [
      { method: 'CASH' as const, amountCents: 3000 },
      { method: 'YAPE' as const, amountCents: 2000 },
    ];
    const preview = checkPayments(5000, payments, { hasCustomer: false, final: false });
    expect(preview.ok).toBe(true);
    expect(preview.qrPendingCents).toBe(2000);
    expect(checkPayments(5000, payments).ok).toBe(false);
  });

  it('detecta montos que no cuadran', () => {
    expect(checkPayments(5000, [{ method: 'CASH', amountCents: 4000 }]).errors[0]).toContain('Faltan S/ 10.00');
    expect(checkPayments(5000, [{ method: 'CASH', amountCents: 3000, tenderedCents: 2000 }]).ok).toBe(false);
    expect(checkPayments(5000, [{ method: 'CARD', amountCents: 5000, tenderedCents: 6000 }]).ok).toBe(false);
  });

  it('vuelto correcto cuando el efectivo excede su parte: da 30 para una parte de 20', () => {
    const check = checkPayments(5000, [
      { method: 'CASH', amountCents: 2000, tenderedCents: 3000 },
      { method: 'YAPE', amountCents: 3000, confirmation: 'MANUAL' },
    ]);
    expect(check.ok).toBe(true);
    expect(check.changeCents).toBe(1000);
  });

  it('fiado parcial: "lleva 80, me da 30 y los 50 apúntamelos"', () => {
    const check = checkPayments(
      8000,
      [
        { method: 'CASH', amountCents: 3000 },
        { method: 'FIADO', amountCents: 5000 },
      ],
      { hasCustomer: true, final: true },
    );
    expect(check.ok).toBe(true);
    expect(check.changeCents).toBe(0);
  });

  it('triple: 10 en efectivo + 20 Yape + 20 fiado', () => {
    const check = checkPayments(
      5000,
      [
        { method: 'CASH', amountCents: 1000, tenderedCents: 2000 },
        { method: 'YAPE', amountCents: 2000, confirmation: 'QR', chargeId: 'c1' },
        { method: 'FIADO', amountCents: 2000 },
      ],
      { hasCustomer: true, final: true },
    );
    expect(check.ok).toBe(true);
    expect(check.changeCents).toBe(1000);
  });

  it('yapeó de más: "te yapeo 40, dame el vuelto" en una cuenta de 32', () => {
    const payment = { method: 'YAPE' as const, amountCents: 3200, tenderedCents: 4000 };
    const pending = checkPayments(3200, [payment], { hasCustomer: false, final: false });
    expect(pending.qrPendingCents).toBe(4000);
    expect(qrAmount(payment)).toBe(4000);
    const check = checkPayments(3200, [{ ...payment, confirmation: 'QR', chargeId: 'c' }]);
    expect(check.ok).toBe(true);
    expect(check.changeCents).toBe(800);
    expect(check.digitalChangeCents).toBe(800);
    expect(checkPayments(3200, [{ method: 'YAPE', amountCents: 3200, tenderedCents: 3000, confirmation: 'MANUAL' }]).ok).toBe(false);
  });

  it('reparte el resto al último método', () => {
    // 2 métodos: el otro se ajusta.
    expect(rebalanceAmounts(5000, [2000, 5000], 0)).toEqual([2000, 3000]);
    expect(rebalanceAmounts(5000, [5000, 3000], 1)).toEqual([2000, 3000]);
    // 3 métodos: "10 en efectivo, 20 Yape y el resto apúntamelo".
    expect(rebalanceAmounts(5000, [1000, 4000, 0], 1)).toEqual([1000, 4000, 0]);
    expect(rebalanceAmounts(5000, [1000, 2000, 0], 1)).toEqual([1000, 2000, 2000]);
    // Editar el último no mueve a los demás; nunca negativos.
    expect(rebalanceAmounts(5000, [1000, 2000, 9000], 2)).toEqual([1000, 2000, 9000]);
    expect(rebalanceAmounts(5000, [6000, 0], 0)).toEqual([6000, 0]);
  });

  it('el fiado necesita cliente', () => {
    expect(checkPayments(5000, [{ method: 'FIADO', amountCents: 5000 }]).ok).toBe(false);
    expect(checkPayments(5000, [{ method: 'FIADO', amountCents: 5000 }], { hasCustomer: true, final: true }).ok).toBe(true);
  });

  it('propone el saldo y montos de billetes', () => {
    expect(suggestNextAmount(5000, [{ method: 'CASH', amountCents: 3000 }])).toBe(2000);
    expect(quickCashOptions(1730)).toEqual([1730, 1800, 2000, 5000, 10000]);
  });
});

describe('reglas', () => {
  it('permisos por rol', () => {
    expect(can('VENDEDOR', 'sales.create')).toBe(true);
    expect(can('VENDEDOR', 'products.edit')).toBe(false);
    expect(can('VENDEDOR', 'sales.void')).toBe(false);
    expect(can('AGENTE', 'sales.create')).toBe(false);
    expect(can('AGENTE', 'inventory.edit')).toBe(false);
    expect(can('AGENTE', 'notifications.send')).toBe(true);
    expect(can('ADMIN', 'banking.edit')).toBe(true);
  });

  it('descuento mayor a 10 % necesita al Admin', () => {
    expect(discountNeedsAdmin('VENDEDOR', 100, 1000)).toBe(false);
    expect(discountNeedsAdmin('VENDEDOR', 101, 1000)).toBe(true);
    expect(discountNeedsAdmin('ADMIN', 500, 1000)).toBe(false);
  });

  it('límite de crédito', () => {
    const c = checkCredit(4000, 5000, 1500);
    expect(c.exceedsLimit).toBe(true);
    expect(checkCredit(4000, 5000, 500).nearLimit).toBe(true);
    expect(checkCredit(1000, 5000, 500).nearLimit).toBe(false);
  });

  it('comprobantes según régimen y comprador', () => {
    expect(allowedDocTypes('NRUS')).not.toContain('FACTURA');
    expect(validateBuyer('BOLETA', 50000, undefined)).toBeNull();
    expect(validateBuyer('BOLETA', 80000, undefined)).toContain('DNI');
    expect(validateBuyer('BOLETA', 80000, { docType: 'DNI', docNumber: '45678912', name: 'Ana' })).toBeNull();
    expect(validateBuyer('FACTURA', 1000, { docType: 'DNI', docNumber: '45678912', name: 'Ana' })).toContain('RUC');
    expect(validateBuyer('FACTURA', 1000, { docType: 'RUC', docNumber: '20100070970', name: 'Supermercados' })).toBeNull();
  });
});

describe('validadores', () => {
  it('RUC con dígito verificador', () => {
    expect(isValidRuc('20100070970')).toBe(true);
    expect(isValidRuc('20100070971')).toBe(false);
    expect(isValidRuc('12345678901')).toBe(false);
  });

  it('EAN-13', () => {
    expect(isValidEan13('7750182000154')).toBe(true);
    expect(isValidEan13('7750182000155')).toBe(false);
  });

  it('celulares peruanos', () => {
    expect(normalizePeruMobile('987 654 321')).toBe('51987654321');
    expect(normalizePeruMobile('+51 987-654-321')).toBe('51987654321');
    expect(normalizePeruMobile('014567890')).toBeNull();
    expect(whatsappLink('987654321', 'Hola')).toBe('https://wa.me/51987654321?text=Hola');
  });

  it('recordatorio de deuda en tono respetuoso', () => {
    const msg = debtReminderMessage({
      customerName: 'Juan Pérez',
      trato: 'DON',
      balanceCents: 4500,
      businessName: 'Bodega Rosita',
      since: '2026-09-12T17:00:00Z',
    });
    expect(msg).toBe('Don Juan, le recuerdo su cuenta: S/ 45.00 desde el 12 de setiembre. Cuando pueda, aquí lo espero. Gracias, Bodega Rosita.');
    for (const template of REMINDER_TEMPLATES) {
      const text = debtReminderMessage({ customerName: 'Rosa Quispe', trato: 'DONA', balanceCents: 2000, businessName: 'Bodega', template });
      expect(text).toContain('Doña Rosa');
      expect(text).toContain('S/ 20.00');
      expect(text).not.toMatch(/deuda morosa|cobranza|intereses|crédito|transacci/i);
    }
  });

  it('nunca adivina Don/Doña por el nombre', () => {
    expect(customerGreetingName('María López')).toBe('María');
    expect(customerGreetingName('Señora Carmen (la del 3er piso)')).toBe('Señora Carmen');
    expect(customerGreetingName('Don Lucho')).toBe('Don Lucho');
    expect(customerGreetingName('Rosa', 'DONA')).toBe('Doña Rosa');
    const neutral = debtReminderMessage({ customerName: 'Alex', balanceCents: 1000, businessName: 'B' });
    expect(neutral).toContain('pase nomás por la tienda');
  });

  it('fechas con "setiembre" y días de pago', () => {
    expect(fechaPe('2026-09-01T12:00:00Z')).toBe('1 de setiembre');
    // 00:30 en Lima del 15 de setiembre = 05:30 UTC.
    expect(paydayInfo(new Date('2026-09-15T05:30:00Z'))?.kind).toBe('QUINCENA');
    expect(paydayInfo(new Date('2026-09-30T15:00:00Z'))?.kind).toBe('FIN_DE_MES');
    expect(paydayInfo(new Date('2026-10-01T15:00:00Z'))?.kind).toBe('FIN_DE_MES');
    expect(paydayInfo(new Date('2026-09-20T15:00:00Z'))).toBeNull();
  });
});

describe('comprobante', () => {
  const business: BusinessSettings = {
    ruc: '10456789124',
    razonSocial: 'QUISPE MAMANI ROSA',
    nombreComercial: 'Bodega Rosita',
    direccion: 'Jr. Los Olivos 123, San Juan de Lurigancho, Lima',
    ubigeo: '150132',
    phone: '987654321',
    taxRegime: 'RMT',
    currency: 'PEN',
    igvRate: 0.18,
    cashLowThresholdCents: 5000,
    defaultCreditLimitCents: 5000,
    overdueDays: 30,
    staleProductDays: 15,
    creditAlertRatio: 0.9,
    yapePlinEnabled: true,
    receiptFooter: null,
  };
  const sale: Sale = {
    id: 'x',
    number: 12,
    sellerId: 'u',
    sellerName: 'Carlos',
    customerId: null,
    customerName: null,
    status: 'COMPLETED',
    docType: 'BOLETA',
    serie: 'B001',
    correlativo: 45,
    sunatStatus: 'ACEPTADO',
    sunatQr: null,
    items: [
      { productId: 'p', name: 'Arroz Costeño 5 kg', quantity: 2, unit: 'UND', unitPriceCents: 2500, totalCents: 5000, taxAffectation: 'GRAVADO', igvCents: 763 },
    ],
    payments: [
      { method: 'CASH', amountCents: 3000, tenderedCents: 5000, changeCents: 2000, confirmation: null, chargeId: null, reference: null },
      { method: 'YAPE', amountCents: 2000, tenderedCents: null, changeCents: 0, confirmation: 'QR', chargeId: 'c', reference: null },
    ],
    subtotalCents: 5000,
    discountCents: 0,
    gravadaCents: 4237,
    exoneradaCents: 0,
    inafectaCents: 0,
    igvCents: 763,
    totalCents: 5000,
    changeCents: 2000,
    buyerDocType: null,
    buyerDocNumber: null,
    buyerName: null,
    createdAt: '2026-09-30T17:30:00.000Z',
  };

  it('incluye RUC, desglose de pagos, IGV y vuelto', () => {
    const text = buildReceiptText(sale, business);
    expect(text).toContain('RUC 10456789124');
    expect(text).toContain('B001-00000045');
    expect(text).toContain('30/09/2026 12:30');
    expect(text).toMatch(/Efectivo\s+S\/ 30\.00/);
    expect(text).toMatch(/Yape\s+S\/ 20\.00/);
    expect(text).toMatch(/IGV 18%\s+S\/ 7\.63/);
    expect(text).toMatch(/VUELTO\s+S\/ 20\.00/);
    expect(text).toContain('CINCUENTA CON 00/100 SOLES');
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
  });

  it('en Nuevo RUS no discrimina IGV', () => {
    const text = buildReceiptText({ ...sale, docType: 'TICKET_POS', serie: 'T001' }, { ...business, taxRegime: 'NRUS' });
    expect(text).not.toContain('IGV');
    expect(text).toContain('Nuevo RUS');
  });

  it('resumen de cierre de caja con desglose por método', () => {
    const text = buildCashCloseText(
      {
        sessionId: 's', openedAt: '2026-09-30T12:00:00Z', openedBy: 'Carlos', openingCents: 10000, salesCount: 3,
        byMethod: { CASH: 5000, YAPE: 3000, PLIN: 2500, FIADO: 2000 }, abonosByMethod: { YAPE: 2000 },
        cashSalesCents: 5000, digitalChangeCents: 800, cashAbonosCents: 0, inCents: 0, outCents: 1000,
        expectedCents: 13200, closedAt: '2026-09-30T23:00:00Z', countedCents: 12000, transferredCents: 1000,
        differenceCents: -200, movements: [],
      },
      business,
    );
    expect(text).toMatch(/Yape\s+S\/ 30\.00/);
    expect(text).toMatch(/Plin\s+S\/ 25\.00/);
    expect(text).toMatch(/Fiado\s+S\/ 20\.00/);
    expect(text).toMatch(/Vuelto de yapeos\s+-S\/ 8\.00/);
    expect(text).toMatch(/FALTA\s+S\/ 2\.00/);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
  });

  it('constancia de abono con saldo', () => {
    const text = buildAbonoReceiptText(
      { id: 'a', customerId: 'c', customerName: 'Juan Pérez', amountCents: 2000, method: 'YAPE', previousBalanceCents: 4500, balanceCents: 2500, userName: 'Carlos', createdAt: '2026-09-30T17:30:00.000Z' },
      business,
    );
    expect(text).toMatch(/SALDO PENDIENTE\s+S\/ 25\.00/);
  });
});
