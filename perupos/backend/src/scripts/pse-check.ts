/**
 * Envía UNA boleta de prueba al PSE configurado (Nubefact) y muestra la respuesta.
 * Úsalo con tu cuenta DEMO de Nubefact. Pide la serie y el número a propósito,
 * para no gastar la numeración real por accidente.
 *
 *   npm run pse:check -w @perupos/backend -- --serie BBB1 --numero 1 --dry-run   (solo muestra el JSON)
 *   npm run pse:check -w @perupos/backend -- --serie BBB1 --numero 1
 */
import type { Sale } from '@perupos/shared';
import { computeTaxes } from '@perupos/shared';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { NubefactPse } from '../services/pse/nubefact.js';
import { getSettings } from '../services/settings.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const serie = arg('serie');
  const numero = Number(arg('numero'));
  if (!serie || !numero) throw new Error('Indica --serie (ej. BBB1) y --numero (ej. 1) de tu cuenta demo.');
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun && !(config.NUBEFACT_URL && config.NUBEFACT_TOKEN)) throw new Error('Faltan NUBEFACT_URL y NUBEFACT_TOKEN en backend/.env');
  const business = await getSettings(pool);

  // Venta de ejemplo: Aceite Primor ×2 (gravado) + Papa amarilla 1.5 kg (exonerada).
  const lines = [
    { productId: 'ACEITE-PRIMOR', name: 'Aceite vegetal Primor 900 ml', quantity: 2, unit: 'UND' as const, unitPriceCents: 1090, taxAffectation: 'GRAVADO' as const },
    { productId: 'PAPA-AMARILLA', name: 'Papa amarilla', quantity: 1.5, unit: 'KG' as const, unitPriceCents: 450, taxAffectation: 'EXONERADO' as const },
  ].map((l) => ({ ...l, totalCents: Math.round(l.unitPriceCents * l.quantity) }));
  const taxes = computeTaxes(lines, 0, business.taxRegime, business.igvRate);
  const sale = {
    id: 'prueba',
    number: 0,
    serie,
    correlativo: numero,
    docType: 'BOLETA',
    createdAt: new Date().toISOString(),
    items: lines.map((l, i) => ({ ...l, igvCents: taxes.lines[i]!.igvCents })),
    discountCents: 0,
    gravadaCents: taxes.gravadaCents,
    exoneradaCents: taxes.exoneradaCents,
    inafectaCents: taxes.inafectaCents,
    igvCents: taxes.igvCents,
    totalCents: taxes.totalCents,
    buyerDocType: null,
    buyerDocNumber: null,
    buyerName: null,
  } as unknown as Sale;

  const pse = new NubefactPse(config.NUBEFACT_URL ?? 'https://api.nubefact.com/api/v1/RUTA', config.NUBEFACT_TOKEN ?? 'TOKEN');
  const document = pse.buildDocument(sale, 2);
  console.log('JSON que se envía a Nubefact:\n', JSON.stringify(document, null, 2));
  if (dryRun) return;
  const result = await pse.emit(sale, business);
  console.log('\nRespuesta:', JSON.stringify(result, null, 2));
}

main()
  .catch((err) => {
    console.error('\nFalló:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
