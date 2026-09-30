import { existsSync } from 'node:fs';
import type { Config } from './config.js';

/** Solo los últimos 4 caracteres; nunca se imprime una llave completa. */
export function mask(value: string | undefined): string {
  if (!value) return 'falta';
  if (/x{6,}/i.test(value)) return 'es la de ejemplo del .env.example';
  if (value.length < 12) return 'definida';
  return `…${value.slice(-4)}`;
}

/**
 * Resumen de qué credenciales cargó el servidor, para el log de arranque.
 * Solo lee la configuración; no cambia cómo se cobra ni cómo se inicia sesión.
 */
export function credentialsSummary(cfg: Config, cwd = process.cwd()): string[] {
  const files = ['.env', '.env.local'].filter((f) => existsSync(`${cwd}/${f}`));
  const lines = [`Archivos leídos: ${files.length ? files.join(' + ') : 'ninguno'} (.env.local manda sobre .env)`];

  const taypiKeys = cfg.TAYPI_PUBLIC_KEY || cfg.TAYPI_SECRET_KEY;
  lines.push(
    `TAYPI (${cfg.TAYPI_BASE_URL}): llave pública ${mask(cfg.TAYPI_PUBLIC_KEY)} · ` +
      `llave secreta ${mask(cfg.TAYPI_SECRET_KEY)} · webhook ${mask(cfg.TAYPI_WEBHOOK_SECRET)}`,
  );
  if (cfg.PAYMENTS_PROVIDER === 'mock' && taypiKeys) {
    lines.push('  Ojo: hay llaves de TAYPI pero PAYMENTS_PROVIDER=mock; los QR son de prueba.');
  }

  lines.push(
    `Nubefact: ruta ${cfg.NUBEFACT_URL ? 'definida' : 'falta'} · token ${mask(cfg.NUBEFACT_TOKEN)}`,
  );
  if (cfg.PSE_PROVIDER !== 'nubefact' && cfg.NUBEFACT_TOKEN) {
    lines.push(`  Ojo: hay token de Nubefact pero PSE_PROVIDER=${cfg.PSE_PROVIDER}; no se envía nada a SUNAT.`);
  }

  const listo =
    cfg.PAYMENTS_PROVIDER === 'taypi' || cfg.PSE_PROVIDER === 'nubefact'
      ? 'Credenciales cargadas'
      : 'Sin credenciales reales en uso (modo prueba)';
  return [`${listo} — Pagos QR: ${cfg.PAYMENTS_PROVIDER} · PSE: ${cfg.PSE_PROVIDER}`, ...lines];
}
