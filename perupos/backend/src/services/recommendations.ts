import { formatSoles, type Payday, type Recommendation } from '@perupos/shared';
import { DAY_NAMES, type Heatmap, type ProductStat } from './reports.js';

export interface RecommendationInput {
  top: ProductStat[];
  slow: ProductStat[];
  overdue: { id: string; name: string; balanceCents: number; days: number }[];
  heatmap: Heatmap;
  cashInDrawerCents: number | null;
  cashLowThresholdCents: number;
  staleDays: number;
  /** Si hoy es quincena o fin de mes, y cuántos clientes deben en total. */
  payday?: Payday;
  debtors?: { count: number; totalCents: number };
}

/** Días de venta que debería cubrir el stock de un producto estrella. */
const COVER_DAYS = 7;

const PARTS_OF_DAY = [
  { name: 'en la mañana', from: 6, to: 12 },
  { name: 'por la tarde', from: 12, to: 18 },
  { name: 'por la noche', from: 18, to: 23 },
];

function roundUpTo(n: number, step: number): number {
  return Math.ceil(n / step) * step;
}

function units(n: number, unit: string): string {
  if (unit === 'KG') return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
  return `${Math.round(n)} ${Math.round(n) === 1 ? 'unidad' : 'unidades'}`;
}

/**
 * Sugerencias simples, en lenguaje de bodega, a partir de los datos.
 * Cada una responde a: ¿esto ayuda a vender más o perder menos plata?
 */
export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const recs: Recommendation[] = [];

  // 1. Reponer lo que más se vende antes de que se acabe.
  input.top.forEach((p, rank) => {
    const weekNeed = p.avgDailyUnits * COVER_DAYS;
    const threshold = Math.max(p.minStock, p.avgDailyUnits * 3);
    if (p.stock > threshold || weekNeed <= 0) return;
    const suggested = Math.max(roundUpTo(weekNeed * 2 - p.stock, p.unit === 'KG' ? 1 : 5), p.unit === 'KG' ? 1 : 5);
    const who = rank === 0 ? 'es tu producto más vendido' : 'está entre tus productos más vendidos';
    recs.push({
      kind: 'REPONER',
      message:
        `${p.name} ${who}. Quedan ${units(Math.max(0, p.stock), p.unit)}. ` +
        `Considera reponer ${units(suggested, p.unit)} más.`,
      entityId: p.productId,
      targetRoles: ['ADMIN', 'VENDEDOR'],
    });
  });

  // 2. Quincena y fin de mes: es cuando la gente tiene plata para pagar.
  if (input.payday && input.debtors && input.debtors.count > 0) {
    recs.push({
      kind: 'COBRAR',
      message: `${input.payday.label} ${input.debtors.count} ${input.debtors.count === 1 ? 'cliente te debe' : 'clientes te deben'} ${formatSoles(input.debtors.totalCents)}. Manda los recordatorios por WhatsApp.`,
      entityId: null,
      targetRoles: ['ADMIN', 'VENDEDOR'],
    });
  }

  // 3. Cobrar deudas vencidas, empezando por la más grande.
  [...input.overdue]
    .sort((a, b) => b.balanceCents - a.balanceCents)
    .slice(0, 3)
    .forEach((c) => {
      recs.push({
        kind: 'COBRAR',
        message: `${c.name} tiene una deuda de ${formatSoles(c.balanceCents)} desde hace ${c.days} días. Envía un recordatorio.`,
        entityId: c.id,
        targetRoles: ['ADMIN', 'VENDEDOR'],
      });
    });

  // 4. Promoción en el horario más flojo.
  const slots: { day: number; part: string; total: number }[] = [];
  input.heatmap.matrix.forEach((hours, day) => {
    for (const part of PARTS_OF_DAY) {
      const total = hours.slice(part.from, part.to).reduce((a, b) => a + b, 0);
      slots.push({ day, part: part.name, total });
    }
  });
  const openSlots = slots.filter((s) => s.total > 0);
  if (openSlots.length >= 6) {
    const weakest = openSlots.reduce((min, s) => (s.total < min.total ? s : min));
    const average = openSlots.reduce((a, s) => a + s.total, 0) / openSlots.length;
    if (weakest.total < average * 0.5) {
      recs.push({
        kind: 'PROMOCION',
        message: `Tus ventas de los ${DAY_NAMES[weakest.day]!.replace(/o$/, 'os')} ${weakest.part} son las más bajas. Considera una promoción.`,
        entityId: null,
        targetRoles: ['ADMIN'],
      });
    }
  }

  // 5. Plata inmovilizada en productos que no salen.
  input.slow
    .filter((p) => p.unitsSold === 0 && (p.daysSinceLastSale ?? 0) >= input.staleDays && p.stockValueCents >= 1000)
    .slice(0, 2)
    .forEach((p) => {
      recs.push({
        kind: 'LIQUIDAR',
        message: `${p.name} no se vende hace ${p.daysSinceLastSale} días y tienes ${formatSoles(p.stockValueCents)} en stock. Considera una oferta o no volver a comprarlo.`,
        entityId: p.productId,
        targetRoles: ['ADMIN'],
      });
    });

  // 6. Sencillo para dar vuelto.
  if (input.cashInDrawerCents !== null && input.cashInDrawerCents < input.cashLowThresholdCents) {
    recs.push({
      kind: 'CAJA',
      message: `Solo hay ${formatSoles(input.cashInDrawerCents)} en caja. Cambia billetes por sencillo para dar vuelto sin perder ventas.`,
      entityId: null,
      targetRoles: ['ADMIN', 'VENDEDOR'],
    });
  }

  return recs;
}
