import type { Cents, TaxAffectation, TaxRegime } from './types.js';

export const DEFAULT_IGV_RATE = 0.18;

/** 1250 => "S/ 12.50"; 123456 => "S/ 1,234.56". */
export function formatSoles(cents: Cents): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const soles = Math.floor(abs / 100);
  const centimos = String(abs % 100).padStart(2, '0');
  const miles = String(soles).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}S/ ${miles}.${centimos}`;
}

/** 1250 => "12.50" (sin símbolo, para campos de texto y PSE). */
export function centsToDecimal(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

/**
 * Convierte lo que escribe el vendedor a céntimos. Acepta "12", "12.5",
 * "12,50" y "S/ 12.50". Devuelve null si no es un monto válido.
 */
export function parseSoles(text: string): Cents | null {
  const clean = text.replace(/s\/\s*/i, '').replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  const [entero = '0', decimales = ''] = clean.split('.');
  return Number(entero) * 100 + Number(decimales.padEnd(2, '0'));
}

/** Total de una línea: precio unitario × cantidad (la cantidad puede ser kilos). */
export function lineTotal(unitPriceCents: Cents, quantity: number): Cents {
  return Math.round(unitPriceCents * quantity);
}

/**
 * Reparte un monto entre varias partes en proporción a sus pesos sin perder
 * céntimos (método del mayor residuo). Se usa para repartir descuentos.
 */
export function allocate(amount: Cents, weights: number[]): Cents[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0 || amount === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / totalWeight);
  const floors = raw.map(Math.floor);
  let rest = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { index } of order) {
    if (rest <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    rest--;
  }
  return floors;
}

export interface TaxLineInput {
  totalCents: Cents;
  taxAffectation: TaxAffectation;
}

export interface TaxBreakdown {
  subtotalCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
  gravadaCents: Cents;
  exoneradaCents: Cents;
  inafectaCents: Cents;
  igvCents: Cents;
  /** Por línea, en el mismo orden de entrada, ya con el descuento aplicado. */
  lines: { totalCents: Cents; baseCents: Cents; igvCents: Cents }[];
}

/**
 * Calcula el desglose tributario de una venta. En Perú el precio al público
 * incluye IGV, así que el IGV se extrae del total: base = total / 1.18.
 *
 * En el Nuevo RUS no se discrimina IGV: el comprobante solo muestra el total.
 */
export function computeTaxes(
  lines: TaxLineInput[],
  discountCents: Cents,
  regime: TaxRegime,
  igvRate: number = DEFAULT_IGV_RATE,
): TaxBreakdown {
  const subtotalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const discount = Math.min(Math.max(0, Math.round(discountCents)), subtotalCents);
  const discounts = allocate(
    discount,
    lines.map((l) => l.totalCents),
  );

  const result: TaxBreakdown = {
    subtotalCents,
    discountCents: discount,
    totalCents: subtotalCents - discount,
    gravadaCents: 0,
    exoneradaCents: 0,
    inafectaCents: 0,
    igvCents: 0,
    lines: [],
  };

  lines.forEach((line, i) => {
    const total = line.totalCents - (discounts[i] ?? 0);
    if (regime === 'NRUS') {
      result.lines.push({ totalCents: total, baseCents: total, igvCents: 0 });
      return;
    }
    if (line.taxAffectation === 'GRAVADO') {
      const base = Math.round(total / (1 + igvRate));
      const igv = total - base;
      result.gravadaCents += base;
      result.igvCents += igv;
      result.lines.push({ totalCents: total, baseCents: base, igvCents: igv });
    } else {
      if (line.taxAffectation === 'EXONERADO') result.exoneradaCents += total;
      else result.inafectaCents += total;
      result.lines.push({ totalCents: total, baseCents: total, igvCents: 0 });
    }
  });

  return result;
}

const UNIDADES = [
  '', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ',
  'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO',
  'DIECINUEVE', 'VEINTE', 'VEINTIUNO', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO',
  'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE',
];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = [
  '', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS',
  'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS',
];

function menorQueMil(n: number): string {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  let texto = CENTENAS[c] ?? '';
  if (resto > 0) {
    let parte: string;
    if (resto < 30) parte = UNIDADES[resto] ?? '';
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      parte = (DECENAS[d] ?? '') + (u > 0 ? ` Y ${UNIDADES[u]}` : '');
    }
    texto = texto ? `${texto} ${parte}` : parte;
  }
  return texto;
}

function enteroEnLetras(n: number): string {
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1_000_000);
  const miles = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millones > 0) partes.push(millones === 1 ? 'UN MILLÓN' : `${menorQueMil(millones)} MILLONES`);
  if (miles > 0) partes.push(miles === 1 ? 'MIL' : `${menorQueMil(miles)} MIL`);
  if (resto > 0) partes.push(menorQueMil(resto));
  return partes.join(' ').replace(/UNO (MIL|MILLONES)/g, 'UN $1');
}

/** 5000 => "CINCUENTA CON 00/100 SOLES" (importe en letras del comprobante). */
export function amountInWords(cents: Cents): string {
  const soles = Math.floor(Math.abs(cents) / 100);
  const centimos = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${enteroEnLetras(soles)} CON ${centimos}/100 SOLES`;
}
